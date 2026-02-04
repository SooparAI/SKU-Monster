import { Router, raw } from "express";
import { constructWebhookEvent } from "../stripe";
import { addToUserBalance, createTransaction, updateTransactionStatus, getTransactionByPaymentId } from "../db";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export const stripeWebhookRouter = Router();

// Use raw body parser for webhook signature verification
stripeWebhookRouter.post(
  "/",
  raw({ type: "application/json" }),
  async (req, res) => {
    const signature = req.headers["stripe-signature"];

    if (!signature || typeof signature !== "string") {
      console.error("[Stripe Webhook] Missing signature");
      return res.status(400).json({ error: "Missing signature" });
    }

    let event;

    try {
      event = constructWebhookEvent(req.body, signature);
    } catch (err) {
      console.error("[Stripe Webhook] Signature verification failed:", err);
      return res.status(400).json({ error: "Invalid signature" });
    }

    // Handle test events
    if (event.id.startsWith("evt_test_")) {
      console.log("[Stripe Webhook] Test event detected, returning verification response");
      return res.json({ verified: true });
    }

    console.log(`[Stripe Webhook] Received event: ${event.type} (${event.id})`);

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          const session = event.data.object;
          
          // Extract metadata
          const userId = session.metadata?.user_id;
          const topupAmount = session.metadata?.topup_amount;
          const type = session.metadata?.type;

          if (type !== "balance_topup" || !userId || !topupAmount) {
            console.log("[Stripe Webhook] Not a balance topup or missing metadata");
            break;
          }

          const userIdNum = parseInt(userId);
          const amount = parseFloat(topupAmount);

          // Check if this payment was already processed
          const existingTx = await getTransactionByPaymentId(session.id);
          if (existingTx) {
            console.log(`[Stripe Webhook] Payment ${session.id} already processed`);
            break;
          }

          // Add balance to user
          const newBalance = await addToUserBalance(userIdNum, amount);

          // Create transaction record
          await createTransaction({
            userId: userIdNum,
            type: "topup",
            amount: amount.toFixed(2),
            paymentMethod: "stripe",
            paymentId: session.id,
            status: "completed",
            description: `Stripe payment - $${amount.toFixed(2)} top-up`,
          });

          console.log(
            `[Stripe Webhook] Added $${amount} to user ${userId}. New balance: $${newBalance}`
          );
          break;
        }

        case "payment_intent.succeeded": {
          console.log(`[Stripe Webhook] Payment intent succeeded: ${event.data.object.id}`);
          break;
        }

        case "payment_intent.payment_failed": {
          console.log(`[Stripe Webhook] Payment intent failed: ${event.data.object.id}`);
          break;
        }

        default:
          console.log(`[Stripe Webhook] Unhandled event type: ${event.type}`);
      }

      res.json({ received: true });
    } catch (err) {
      console.error("[Stripe Webhook] Error processing event:", err);
      res.status(500).json({ error: "Webhook handler failed" });
    }
  }
);
