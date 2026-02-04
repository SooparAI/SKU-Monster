import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  getUserBalance,
  addToUserBalance,
  deductFromUserBalance,
  createTransaction,
  updateTransactionStatus,
  getUserTransactions,
  getTransactionByPaymentId,
  createOrder,
  updateOrder,
  getOrderById,
  getUserOrders,
  createOrderItems,
  updateOrderItem,
  getOrderItems,
  saveScrapedImages,
  SKU_PRICE,
} from "./db";
import {
  runScrapeJob,
  parseSkusFromText,
} from "./scrapers/scraperService";
import { getActiveStores } from "./scrapers/storeConfigs";
import { invokeLLM } from "./_core/llm";
import { TRPCError } from "@trpc/server";
import { createTopupCheckoutSession, getCheckoutSession } from "./stripe";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // Balance router
  balance: router({
    get: protectedProcedure.query(async ({ ctx }) => {
      const balance = await getUserBalance(ctx.user.id);
      return { balance, pricePerSku: SKU_PRICE };
    }),

    getTransactions: protectedProcedure.query(async ({ ctx }) => {
      return getUserTransactions(ctx.user.id);
    }),

    // Create a top-up transaction (to be completed by payment webhook)
    createTopup: protectedProcedure
      .input(
        z.object({
          amount: z.number().min(15),
          paymentMethod: z.enum(["stripe", "solana"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const transactionId = await createTransaction({
          userId: ctx.user.id,
          type: "topup",
          amount: input.amount.toFixed(2),
          paymentMethod: input.paymentMethod,
          status: "pending",
          description: `Top-up via ${input.paymentMethod}`,
        });
        return { transactionId };
      }),

    // Create Stripe checkout session for top-up
    createStripeCheckout: protectedProcedure
      .input(
        z.object({
          amount: z.number().min(15),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const origin = ctx.req.headers.origin || "http://localhost:3000";
        
        const { url, sessionId } = await createTopupCheckoutSession({
          userId: ctx.user.id,
          userEmail: ctx.user.email || "",
          userName: ctx.user.name || "",
          amount: input.amount,
          origin,
        });

        return { checkoutUrl: url, sessionId };
      }),

    // Verify checkout session completion
    verifyCheckout: protectedProcedure
      .input(z.object({ sessionId: z.string() }))
      .query(async ({ input }) => {
        try {
          const session = await getCheckoutSession(input.sessionId);
          return {
            status: session.payment_status,
            amount: session.amount_total ? session.amount_total / 100 : 0,
          };
        } catch {
          return { status: "unknown", amount: 0 };
        }
      }),

    // Complete a top-up (called after successful payment)
    completeTopup: protectedProcedure
      .input(
        z.object({
          transactionId: z.number(),
          paymentId: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        // In production, this would be called by a webhook
        // For now, we'll allow direct completion
        const transactions = await getUserTransactions(ctx.user.id);
        const transaction = transactions.find((t) => t.id === input.transactionId);

        if (!transaction) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
        }

        if (transaction.status !== "pending") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Transaction already processed" });
        }

        const amount = parseFloat(transaction.amount);
        const newBalance = await addToUserBalance(ctx.user.id, amount);
        await updateTransactionStatus(input.transactionId, "completed");

        return { newBalance };
      }),
  }),

  // Orders router
  orders: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getUserOrders(ctx.user.id);
    }),

    get: protectedProcedure
      .input(z.object({ orderId: z.number() }))
      .query(async ({ ctx, input }) => {
        const order = await getOrderById(input.orderId);
        if (!order || order.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        }

        const items = await getOrderItems(input.orderId);
        return { order, items };
      }),

    // Parse SKUs from text input using AI
    parseSkus: protectedProcedure
      .input(z.object({ text: z.string() }))
      .mutation(async ({ input }) => {
        // First try simple parsing
        let skus = parseSkusFromText(input.text);

        // If no SKUs found, use AI to extract them
        if (skus.length === 0 && input.text.trim().length > 0) {
          try {
            const response = await invokeLLM({
              messages: [
                {
                  role: "system",
                  content:
                    "You are a SKU/EAN/UPC code extractor. Extract all product codes (typically 8-14 digit numbers) from the user's input. Return ONLY a JSON array of strings containing the codes, nothing else. If no valid codes are found, return an empty array [].",
                },
                {
                  role: "user",
                  content: input.text,
                },
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: "sku_list",
                  strict: true,
                  schema: {
                    type: "object",
                    properties: {
                      skus: {
                        type: "array",
                        items: { type: "string" },
                      },
                    },
                    required: ["skus"],
                    additionalProperties: false,
                  },
                },
              },
            });

            const content = response.choices[0]?.message?.content as string | undefined;
            if (content) {
              const parsed = JSON.parse(content);
              skus = parsed.skus || [];
            }
          } catch (err) {
            console.error("AI SKU parsing failed:", err);
          }
        }

        const totalCost = skus.length * SKU_PRICE;
        return { skus, totalCost, pricePerSku: SKU_PRICE };
      }),

    // Create and process a scrape order
    create: protectedProcedure
      .input(
        z.object({
          skus: z.array(z.string()).min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const balance = await getUserBalance(ctx.user.id);
        const totalCost = input.skus.length * SKU_PRICE;

        // Calculate how many SKUs we can process
        const affordableSkus = Math.floor(balance / SKU_PRICE);
        if (affordableSkus === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Insufficient balance. You need at least $${SKU_PRICE} to process 1 SKU. Current balance: $${balance.toFixed(2)}`,
          });
        }

        // Process as many SKUs as the user can afford
        const skusToProcess = input.skus.slice(0, affordableSkus);
        const actualCost = skusToProcess.length * SKU_PRICE;
        const isPartial = skusToProcess.length < input.skus.length;

        // Create order
        const orderId = await createOrder({
          userId: ctx.user.id,
          status: "processing",
          totalSkus: input.skus.length,
          processedSkus: 0,
          totalCost: totalCost.toFixed(2),
          chargedAmount: actualCost.toFixed(2),
        });

        // Create order items
        await createOrderItems(
          input.skus.map((sku, index) => ({
            orderId,
            sku,
            status: index < skusToProcess.length ? "pending" : "skipped",
          }))
        );

        // Deduct balance
        await deductFromUserBalance(ctx.user.id, actualCost);

        // Create charge transaction
        await createTransaction({
          userId: ctx.user.id,
          type: "charge",
          amount: actualCost.toFixed(2),
          status: "completed",
          description: `Order #${orderId} - ${skusToProcess.length} SKUs`,
        });

        // Start scraping in background (don't await)
        processScrapeJob(orderId, skusToProcess).catch((err) => {
          console.error(`Scrape job ${orderId} failed:`, err);
        });

        return {
          orderId,
          skusToProcess: skusToProcess.length,
          skusSkipped: input.skus.length - skusToProcess.length,
          chargedAmount: actualCost,
          isPartial,
          message: isPartial
            ? `Processing ${skusToProcess.length} of ${input.skus.length} SKUs due to insufficient balance.`
            : `Processing ${skusToProcess.length} SKUs.`,
        };
      }),
  }),

  // Stores router
  stores: router({
    list: publicProcedure.query(() => {
      const stores = getActiveStores();
      return stores.map((s) => ({
        name: s.name,
        baseUrl: s.baseUrl,
        notes: s.notes,
      }));
    }),
  }),
});

// Background job processor
async function processScrapeJob(orderId: number, skus: string[]) {
  try {
    console.log(`Starting scrape job ${orderId} with ${skus.length} SKUs`);

    const result = await runScrapeJob(orderId, skus, (processed, total) => {
      // Update order progress
      updateOrder(orderId, { processedSkus: processed }).catch(console.error);
    });

    // Update order with results
    await updateOrder(orderId, {
      status: result.failedSkus === skus.length ? "failed" : result.failedSkus > 0 ? "partial" : "completed",
      processedSkus: result.processedSkus,
      zipFileUrl: result.zipUrl,
      zipFileKey: result.zipKey,
      completedAt: new Date(),
    });

    // Save scraped images to database
    const orderItemsList = await getOrderItems(orderId);
    for (const skuResult of result.results) {
      const orderItem = orderItemsList.find((item) => item.sku === skuResult.sku);
      if (orderItem) {
        await updateOrderItem(orderItem.id, {
          status: skuResult.status === "partial" ? "completed" : skuResult.status,
          imagesFound: skuResult.images.length,
          completedAt: new Date(),
        });

        await saveScrapedImages(
          skuResult.images.map((img) => ({
            orderItemId: orderItem.id,
            sku: skuResult.sku,
            sourceStore: img.storeName,
            sourceUrl: img.sourceUrl,
            imageUrl: img.imageUrl,
            s3Key: img.s3Key,
            s3Url: img.s3Url,
          }))
        );
      }
    }

    console.log(`Scrape job ${orderId} completed. Total images: ${result.totalImages}`);
  } catch (err) {
    console.error(`Scrape job ${orderId} error:`, err);
    await updateOrder(orderId, {
      status: "failed",
      completedAt: new Date(),
    });
  }
}

export type AppRouter = typeof appRouter;
