import { describe, expect, it } from "vitest";
import { generateSolanaPayUrl, getWalletAddress, isSolanaConfigured, SOLANA_PRICE_TIERS } from "./solana";

describe("Solana Pay Integration", () => {
  it("should have the wallet address configured", () => {
    const walletAddress = getWalletAddress();
    expect(walletAddress).toBeTruthy();
    expect(walletAddress.length).toBeGreaterThan(30);
  });

  it("should report Solana as configured", () => {
    expect(isSolanaConfigured()).toBe(true);
  });

  it("should have valid price tiers", () => {
    expect(SOLANA_PRICE_TIERS.length).toBeGreaterThan(0);
    SOLANA_PRICE_TIERS.forEach(tier => {
      expect(tier.credits).toBeGreaterThan(0);
      expect(tier.price).toBeGreaterThan(0);
      expect(tier.label).toBeTruthy();
    });
  });

  it("should generate valid Solana Pay URL", () => {
    const url = generateSolanaPayUrl({
      amount: 75,
      reference: "test-reference-123",
      label: "Test Payment",
      message: "Test message",
    });

    expect(url).toContain("solana:");
    expect(url).toContain("amount=75");
    expect(url).toContain("reference=test-reference-123");
    expect(url).toContain("spl-token="); // USDC token
  });
});
