import Stripe from "stripe";
import { ENV } from "./_core/env";

// Initialize Stripe with the secret key
export const stripe = new Stripe(ENV.stripeSecretKey || "", {
  apiVersion: "2026-01-28.clover",
});

// Product configuration for balance top-ups
export const TOPUP_PRODUCTS = {
  topup: {
    name: "SKU Monster Balance Top-Up",
    description: "Add funds to your SKU Monster account ($10 per SKU, ~3 HQ images)",
  },
};

// Create a checkout session for balance top-up
export async function createTopupCheckoutSession(params: {
  userId: number;
  userEmail: string;
  userName: string;
  amount: number; // Amount in dollars
  origin: string;
}): Promise<{ url: string; sessionId: string }> {
  const { userId, userEmail, userName, amount, origin } = params;

  // Convert dollars to cents for Stripe
  const amountInCents = Math.round(amount * 100);

  const session = await stripe.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: TOPUP_PRODUCTS.topup.name,
            description: `$${amount.toFixed(2)} balance top-up for SKU Monster ($10/SKU, ~3 HQ images)`,
          },
          unit_amount: amountInCents,
        },
        quantity: 1,
      },
    ],
    mode: "payment",
    success_url: `${origin}/topup?success=true&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/topup?canceled=true`,
    customer_email: userEmail,
    client_reference_id: userId.toString(),
    metadata: {
      user_id: userId.toString(),
      customer_email: userEmail,
      customer_name: userName,
      topup_amount: amount.toString(),
      type: "balance_topup",
    },
    allow_promotion_codes: true,
  });

  if (!session.url) {
    throw new Error("Failed to create checkout session");
  }

  return {
    url: session.url,
    sessionId: session.id,
  };
}

// Verify and construct webhook event
export function constructWebhookEvent(
  payload: Buffer,
  signature: string
): Stripe.Event {
  const webhookSecret = ENV.stripeWebhookSecret;
  if (!webhookSecret) {
    throw new Error("Stripe webhook secret not configured");
  }

  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}

// Get checkout session details
export async function getCheckoutSession(
  sessionId: string
): Promise<Stripe.Checkout.Session> {
  return stripe.checkout.sessions.retrieve(sessionId);
}
