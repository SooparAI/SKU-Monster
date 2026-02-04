import { ENV } from "./_core/env";

// Solana Pay configuration
export const SOLANA_CONFIG = {
  walletAddress: ENV.solanaWalletAddress,
  // USDC token mint address on Solana mainnet
  usdcMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  // SOL price will be fetched dynamically, but we'll use USDC for stable pricing
};

// Price tiers in USD (same as Stripe)
export const SOLANA_PRICE_TIERS = [
  { credits: 5, price: 75, label: "5 SKUs" },
  { credits: 10, price: 150, label: "10 SKUs" },
  { credits: 25, price: 375, label: "25 SKUs" },
  { credits: 50, price: 750, label: "50 SKUs" },
  { credits: 100, price: 1500, label: "100 SKUs" },
];

/**
 * Generate a Solana Pay URL for USDC payment
 * Format: solana:<recipient>?amount=<amount>&spl-token=<token>&reference=<reference>&label=<label>&message=<message>
 */
export function generateSolanaPayUrl(params: {
  amount: number; // Amount in USD (will be converted to USDC 1:1)
  reference: string; // Unique reference for tracking
  label?: string;
  message?: string;
}): string {
  const { amount, reference, label = "Photo.1 Credits", message = "Balance top-up" } = params;
  
  if (!SOLANA_CONFIG.walletAddress) {
    throw new Error("Solana wallet address not configured");
  }

  // Build Solana Pay URL for USDC
  const url = new URL(`solana:${SOLANA_CONFIG.walletAddress}`);
  url.searchParams.set("amount", amount.toString());
  url.searchParams.set("spl-token", SOLANA_CONFIG.usdcMint);
  url.searchParams.set("reference", reference);
  url.searchParams.set("label", label);
  url.searchParams.set("message", message);

  return url.toString();
}

/**
 * Generate a simple SOL payment URL (for users who prefer SOL over USDC)
 * Note: SOL price fluctuates, so amount should be calculated at payment time
 */
export function generateSolPayUrl(params: {
  amountSol: number;
  reference: string;
  label?: string;
  message?: string;
}): string {
  const { amountSol, reference, label = "Photo.1 Credits", message = "Balance top-up" } = params;
  
  if (!SOLANA_CONFIG.walletAddress) {
    throw new Error("Solana wallet address not configured");
  }

  const url = new URL(`solana:${SOLANA_CONFIG.walletAddress}`);
  url.searchParams.set("amount", amountSol.toString());
  url.searchParams.set("reference", reference);
  url.searchParams.set("label", label);
  url.searchParams.set("message", message);

  return url.toString();
}

/**
 * Get the wallet address for display
 */
export function getWalletAddress(): string {
  return SOLANA_CONFIG.walletAddress;
}

/**
 * Validate that Solana is configured
 */
export function isSolanaConfigured(): boolean {
  return !!SOLANA_CONFIG.walletAddress && SOLANA_CONFIG.walletAddress.length > 30;
}
