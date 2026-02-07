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
  getStuckProcessingOrders,
  getFailedOrdersWithoutRefund,
  getScrapeLogsByOrder,
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
import { registerUser, loginUser, createToken, getUserById } from "./auth";
import { generateSolanaPayUrl, getWalletAddress, isSolanaConfigured, SOLANA_PRICE_TIERS } from "./solana";
import { nanoid } from "nanoid";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    
    // Custom registration
    register: publicProcedure
      .input(
        z.object({
          email: z.string().email(),
          password: z.string().min(8),
          name: z.string().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await registerUser(input);
        if (!result.success) {
          throw new TRPCError({ code: "BAD_REQUEST", message: result.error });
        }

        // Auto-login after registration
        const loginResult = await loginUser({
          email: input.email,
          password: input.password,
        });

        if (loginResult.success && loginResult.token) {
          const cookieOptions = getSessionCookieOptions(ctx.req);
          ctx.res.cookie("auth_token", loginResult.token, {
            ...cookieOptions,
            maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
          });
        }

        return { success: true, userId: result.userId };
      }),

    // Custom login
    login: publicProcedure
      .input(
        z.object({
          email: z.string().email(),
          password: z.string(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const result = await loginUser(input);
        if (!result.success) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: result.error });
        }

        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie("auth_token", result.token!, {
          ...cookieOptions,
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        });

        return { success: true, user: result.user };
      }),

    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      // Clear both OAuth and custom auth cookies
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      ctx.res.clearCookie("auth_token", { ...cookieOptions, maxAge: -1 });
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

    // Get Solana Pay configuration
    getSolanaConfig: protectedProcedure.query(() => {
      return {
        enabled: isSolanaConfigured(),
        walletAddress: getWalletAddress(),
        priceTiers: SOLANA_PRICE_TIERS,
      };
    }),

    // Generate Solana Pay URL for a specific amount
    createSolanaPayment: protectedProcedure
      .input(
        z.object({
          amount: z.number().min(15),
          credits: z.number().min(1),
        })
      )
      .mutation(async ({ ctx, input }) => {
        if (!isSolanaConfigured()) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Solana Pay not configured" });
        }

        // Create a unique reference for this payment
        const reference = nanoid(32);

        // Create pending transaction
        const transactionId = await createTransaction({
          userId: ctx.user.id,
          type: "topup",
          amount: input.amount.toFixed(2),
          paymentMethod: "solana",
          paymentId: reference,
          status: "pending",
          description: `Solana Pay top-up - ${input.credits} credits`,
        });

        // Generate Solana Pay URL
        const solanaPayUrl = generateSolanaPayUrl({
          amount: input.amount,
          reference,
          label: "Photo.1 Credits",
          message: `${input.credits} SKU credits`,
        });

        return {
          transactionId,
          reference,
          solanaPayUrl,
          walletAddress: getWalletAddress(),
          amount: input.amount,
          credits: input.credits,
        };
      }),

    // Confirm Solana payment (manual confirmation by admin or automated via webhook)
    confirmSolanaPayment: protectedProcedure
      .input(
        z.object({
          transactionId: z.number(),
          txSignature: z.string().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        const transactions = await getUserTransactions(ctx.user.id);
        const transaction = transactions.find((t) => t.id === input.transactionId);

        if (!transaction) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Transaction not found" });
        }

        if (transaction.status !== "pending") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Transaction already processed" });
        }

        // In production, you would verify the transaction on-chain here
        // For now, we'll allow manual confirmation
        const amount = parseFloat(transaction.amount);
        const newBalance = await addToUserBalance(ctx.user.id, amount);
        await updateTransactionStatus(input.transactionId, "completed");

        return { newBalance, message: "Payment confirmed! Credits added to your balance." };
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

    // Retry a failed order
    retry: protectedProcedure
      .input(z.object({ orderId: z.number() }))
      .mutation(async ({ ctx, input }) => {
        const order = await getOrderById(input.orderId);
        if (!order || order.userId !== ctx.user.id) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
        }

        if (order.status !== "failed" && order.status !== "processing" && order.status !== "pending") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Only failed, stuck, or pending orders can be retried" });
        }

        // Get the order items that need to be processed
        const items = await getOrderItems(input.orderId);
        const pendingItems = items.filter((item) => item.status === "pending" || item.status === "processing" || item.status === "failed");
        const skusToProcess = pendingItems.map((item) => item.sku);

        if (skusToProcess.length === 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "No SKUs to retry" });
        }

        // Reset order status
        await updateOrder(input.orderId, {
          status: "processing",
          processedSkus: 0,
        });

        // Reset order items (including failed ones)
        for (const item of pendingItems) {
          await updateOrderItem(item.id, {
            status: "pending",
            imagesFound: 0,
            errorMessage: null,
            completedAt: null,
          });
        }

        // Start scraping in background
        processScrapeJob(input.orderId, skusToProcess).catch((err) => {
          console.error(`Retry scrape job ${input.orderId} failed:`, err);
        });

        return {
          orderId: input.orderId,
          skusToProcess: skusToProcess.length,
          message: `Retrying ${skusToProcess.length} SKUs...`,
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

  // Admin router
  admin: router({
    // Backfill refunds for all failed orders that weren't refunded
    backfillRefunds: protectedProcedure.mutation(async ({ ctx }) => {
      if (ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin only' });
      }

      const unrefundedOrders = await getFailedOrdersWithoutRefund();
      let refundedCount = 0;
      let totalRefunded = 0;

      for (const order of unrefundedOrders) {
        try {
          const refundAmount = parseFloat(order.chargedAmount);
          if (refundAmount <= 0) continue;

          await addToUserBalance(order.userId, refundAmount);
          await createTransaction({
            userId: order.userId,
            type: 'refund',
            amount: refundAmount.toFixed(2),
            status: 'completed',
            description: `Backfill refund for failed Order #${order.id}`,
          });

          refundedCount++;
          totalRefunded += refundAmount;
          console.log(`[Admin Refund] Refunded $${refundAmount} for order #${order.id} to user ${order.userId}`);
        } catch (err) {
          console.error(`[Admin Refund] Failed to refund order #${order.id}:`, err);
        }
      }

      return {
        refundedCount,
        totalRefunded,
        message: `Refunded ${refundedCount} orders totaling $${totalRefunded.toFixed(2)}`,
      };
    }),

    // Manually trigger stuck order cleanup
    cleanupStuck: protectedProcedure.mutation(async ({ ctx }) => {
      if (ctx.user.role !== 'admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin only' });
      }

      const stuckOrders = await getStuckProcessingOrders(3 * 60 * 1000); // 3 min for manual trigger
      let cleanedCount = 0;

      for (const order of stuckOrders) {
        try {
          await updateOrder(order.id, { status: 'failed', completedAt: new Date() });
          const items = await getOrderItems(order.id);
          for (const item of items) {
            if (item.status === 'pending' || item.status === 'processing') {
              await updateOrderItem(item.id, {
                status: 'failed',
                errorMessage: 'Admin cleanup: stuck order',
                completedAt: new Date(),
              });
            }
          }
          await autoRefundOrder(order.id, order.totalSkus || 1);
          cleanedCount++;
        } catch (err) {
          console.error(`[Admin Cleanup] Failed for order #${order.id}:`, err);
        }
      }

      return {
        cleanedCount,
        message: `Cleaned up ${cleanedCount} stuck orders`,
      };
    }),

    // Get scrape logs for a specific order (for debugging production failures)
    getScrapeLogs: protectedProcedure
      .input(z.object({ orderId: z.number() }))
      .query(async ({ ctx, input }) => {
        if (ctx.user.role !== 'admin') {
          throw new TRPCError({ code: 'FORBIDDEN', message: 'Admin only' });
        }
        return getScrapeLogsByOrder(input.orderId);
      }),
  }),
});

// Retry a DB operation up to 3 times with exponential backoff
async function retryDbOp<T>(op: () => Promise<T>, label: string, retries = 3): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await op();
    } catch (err) {
      console.error(`[DB Retry] ${label} attempt ${attempt}/${retries} failed:`, err);
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
  throw new Error(`[DB Retry] ${label} exhausted all retries`);
}

// Background job processor with robust error handling
async function processScrapeJob(orderId: number, skus: string[]) {
  const JOB_HARD_TIMEOUT = 5 * 60 * 1000; // 5 minutes absolute max
  let jobTimedOut = false;
  
  // Hard timeout that forces the job to fail if it runs too long
  const hardTimer = setTimeout(async () => {
    jobTimedOut = true;
    console.error(`[Job ${orderId}] HARD TIMEOUT (${JOB_HARD_TIMEOUT / 1000}s) - forcing failure`);
    try {
      await retryDbOp(
        () => updateOrder(orderId, { status: "failed", completedAt: new Date() }),
        `Hard timeout update order ${orderId}`
      );
      const items = await getOrderItems(orderId);
      for (const item of items) {
        if (item.status === 'pending' || item.status === 'processing') {
          await updateOrderItem(item.id, {
            status: 'failed',
            errorMessage: 'Job timed out after 5 minutes',
            completedAt: new Date(),
          }).catch(console.error);
        }
      }
      await autoRefundOrder(orderId, skus.length);
    } catch (e) {
      console.error(`[Job ${orderId}] Hard timeout cleanup failed:`, e);
    }
  }, JOB_HARD_TIMEOUT);

  try {
    console.log(`Starting scrape job ${orderId} with ${skus.length} SKUs`);

    const result = await runScrapeJob(orderId, skus, (processed, total) => {
      console.log(`Order ${orderId}: Processed ${processed}/${total} SKUs`);
      updateOrder(orderId, { processedSkus: processed }).catch(console.error);
    });
    
    if (jobTimedOut) {
      console.log(`[Job ${orderId}] Completed after hard timeout - ignoring results`);
      return;
    }
    
    console.log(`runScrapeJob completed for order ${orderId}. Images: ${result.totalImages}, Failed: ${result.failedSkus}/${skus.length}`);

    // Determine final status
    const finalStatus = result.totalImages === 0 ? "failed" 
      : result.failedSkus === skus.length ? "failed" 
      : result.failedSkus > 0 ? "partial" 
      : "completed";

    // Update order with results (with retry)
    await retryDbOp(
      () => updateOrder(orderId, {
        status: finalStatus,
        processedSkus: result.processedSkus,
        zipFileUrl: result.zipUrl,
        zipFileKey: result.zipKey,
        completedAt: new Date(),
      }),
      `Update order ${orderId} status to ${finalStatus}`
    );

    // Save scraped images to database
    const orderItemsList = await getOrderItems(orderId);
    for (const skuResult of result.results) {
      const orderItem = orderItemsList.find((item) => item.sku === skuResult.sku);
      if (orderItem) {
        await retryDbOp(
          () => updateOrderItem(orderItem.id, {
            status: skuResult.images.length > 0 ? "completed" : "failed",
            imagesFound: skuResult.images.length,
            errorMessage: skuResult.errors.length > 0 ? skuResult.errors.join('; ') : null,
            completedAt: new Date(),
          }),
          `Update order item ${orderItem.id}`
        );

        if (skuResult.images.length > 0) {
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
          ).catch(err => console.error(`Failed to save images for ${skuResult.sku}:`, err));
        }
      }
    }

    console.log(`Scrape job ${orderId} completed: ${finalStatus}. Total images: ${result.totalImages}, Zip URL: ${result.zipUrl}`);

    // AUTO-REFUND: If ALL SKUs failed (0 images total), refund the user
    if (result.totalImages === 0) {
      await autoRefundOrder(orderId, skus.length);
    }
  } catch (err) {
    if (jobTimedOut) return; // Hard timeout already handled it
    
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`Scrape job ${orderId} error:`, errorMsg, err instanceof Error ? err.stack : '');
    
    // Update order status (with retry)
    await retryDbOp(
      () => updateOrder(orderId, { status: "failed", completedAt: new Date() }),
      `Fail order ${orderId}`
    ).catch(e => console.error(`CRITICAL: Could not mark order ${orderId} as failed:`, e));
    
    // Also update all pending/processing order items with the error
    try {
      const orderItemsList = await getOrderItems(orderId);
      for (const item of orderItemsList) {
        if (item.status === 'pending' || item.status === 'processing') {
          await updateOrderItem(item.id, {
            status: 'failed',
            errorMessage: `Job error: ${errorMsg}`,
            completedAt: new Date(),
          }).catch(console.error);
        }
      }
    } catch (updateErr) {
      console.error(`Failed to update order items for ${orderId}:`, updateErr);
    }

    // AUTO-REFUND: Entire job crashed, refund the user
    await autoRefundOrder(orderId, skus.length);
  } finally {
    clearTimeout(hardTimer);
  }
}

// ===== STUCK JOB CLEANUP =====
// Runs every 2 minutes to detect and auto-fail orders stuck in 'processing'
async function cleanupStuckOrders() {
  try {
    const stuckOrders = await getStuckProcessingOrders(5 * 60 * 1000); // 5 min threshold
    if (stuckOrders.length === 0) return;
    
    console.log(`[Stuck Cleanup] Found ${stuckOrders.length} stuck orders`);
    for (const order of stuckOrders) {
      console.log(`[Stuck Cleanup] Failing stuck order #${order.id} (created ${order.createdAt})`);
      
      await retryDbOp(
        () => updateOrder(order.id, { status: "failed", completedAt: new Date() }),
        `Fail stuck order ${order.id}`
      ).catch(e => console.error(`[Stuck Cleanup] Failed to update order ${order.id}:`, e));
      
      // Update stuck order items
      try {
        const items = await getOrderItems(order.id);
        for (const item of items) {
          if (item.status === 'pending' || item.status === 'processing') {
            await updateOrderItem(item.id, {
              status: 'failed',
              errorMessage: 'Order timed out (stuck in processing > 5 min)',
              completedAt: new Date(),
            }).catch(console.error);
          }
        }
      } catch (e) {
        console.error(`[Stuck Cleanup] Failed to update items for order ${order.id}:`, e);
      }
      
      // Auto-refund
      const skuCount = order.totalSkus || 1;
      await autoRefundOrder(order.id, skuCount);
    }
  } catch (err) {
    console.error('[Stuck Cleanup] Error:', err);
  }
}

// Start the stuck order cleanup interval (every 2 minutes)
setInterval(cleanupStuckOrders, 2 * 60 * 1000);
// Also run once on startup after a short delay
setTimeout(cleanupStuckOrders, 10000);

// Auto-refund a failed order by crediting the user's balance
async function autoRefundOrder(orderId: number, skuCount: number) {
  try {
    const order = await getOrderById(orderId);
    if (!order) {
      console.error(`[Refund] Order ${orderId} not found`);
      return;
    }

    const refundAmount = skuCount * SKU_PRICE;
    console.log(`[Refund] Auto-refunding $${refundAmount} for failed order ${orderId} (${skuCount} SKUs)`);

    // Credit the user's balance
    await addToUserBalance(order.userId, refundAmount);

    // Create refund transaction
    await createTransaction({
      userId: order.userId,
      type: "refund",
      amount: refundAmount.toFixed(2),
      status: "completed",
      description: `Auto-refund for failed Order #${orderId} - ${skuCount} SKUs (0 images found)`,
    });

    console.log(`[Refund] Successfully refunded $${refundAmount} to user ${order.userId} for order ${orderId}`);
  } catch (refundErr) {
    console.error(`[Refund] Failed to auto-refund order ${orderId}:`, refundErr);
  }
}

export type AppRouter = typeof appRouter;
