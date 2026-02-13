import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the database functions
vi.mock("./db", () => ({
  getUserBalance: vi.fn().mockResolvedValue(100),
  addToUserBalance: vi.fn().mockResolvedValue(150),
  deductFromUserBalance: vi.fn().mockResolvedValue({ success: true, newBalance: 85 }),
  createTransaction: vi.fn().mockResolvedValue(1),
  updateTransactionStatus: vi.fn().mockResolvedValue(undefined),
  getUserTransactions: vi.fn().mockResolvedValue([
    {
      id: 1,
      userId: 1,
      type: "topup",
      amount: "100.00",
      status: "completed",
      paymentMethod: "stripe",
      createdAt: new Date(),
    },
  ]),
  getTransactionByPaymentId: vi.fn().mockResolvedValue(null),
  createOrder: vi.fn().mockResolvedValue(1),
  updateOrder: vi.fn().mockResolvedValue(undefined),
  getOrderById: vi.fn().mockResolvedValue({
    id: 1,
    userId: 1,
    status: "completed",
    totalSkus: 1,
    processedSkus: 1,
    totalCost: "10.00",
    chargedAmount: "15.00",
    createdAt: new Date(),
  }),
  getUserOrders: vi.fn().mockResolvedValue([
    {
      id: 1,
      userId: 1,
      status: "completed",
      totalSkus: 1,
      processedSkus: 1,
      totalCost: "10.00",
      chargedAmount: "15.00",
      createdAt: new Date(),
    },
  ]),
  createOrderItems: vi.fn().mockResolvedValue(undefined),
  updateOrderItem: vi.fn().mockResolvedValue(undefined),
  getOrderItems: vi.fn().mockResolvedValue([
    {
      id: 1,
      orderId: 1,
      sku: "701666410164",
      status: "completed",
      imagesFound: 5,
    },
  ]),
  saveScrapedImages: vi.fn().mockResolvedValue(undefined),
  SKU_PRICE: 2,
}));

// Mock the scraper service
vi.mock("./scrapers/scraperService", () => ({
  runScrapeJob: vi.fn().mockResolvedValue({
    orderId: 1,
    results: [],
    zipKey: "test-key",
    zipUrl: "https://example.com/test.zip",
    totalImages: 0,
    processedSkus: 1,
    failedSkus: 0,
  }),
  parseSkusFromText: vi.fn().mockImplementation((text: string) => {
    const matches = text.match(/\d{8,14}/g);
    return matches ? Array.from(new Set(matches)) : [];
  }),
}));

// Mock the store configs
vi.mock("./scrapers/storeConfigs", () => ({
  getActiveStores: vi.fn().mockReturnValue([
    { name: "Test Store", baseUrl: "https://test.com", notes: "Test" },
  ]),
}));

// Mock the LLM
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{ message: { content: '{"skus": ["701666410164"]}' } }],
  }),
}));

// Mock Stripe
vi.mock("./stripe", () => ({
  createTopupCheckoutSession: vi.fn().mockResolvedValue({
    url: "https://checkout.stripe.com/test",
    sessionId: "cs_test_123",
  }),
  getCheckoutSession: vi.fn().mockResolvedValue({
    payment_status: "paid",
    amount_total: 10000,
  }),
}));

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-123",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: {
      protocol: "https",
      headers: {
        origin: "https://test.example.com",
      },
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("balance router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns user balance and price per SKU", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.balance.get();

    expect(result).toEqual({
      balance: 100,
      pricePerSku: 2,
    });
  });

  it("returns user transactions", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.balance.getTransactions();

    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("topup");
    expect(result[0].amount).toBe("100.00");
  });

  it("creates a Stripe checkout session", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.balance.createStripeCheckout({ amount: 100 });

    expect(result).toEqual({
      checkoutUrl: "https://checkout.stripe.com/test",
      sessionId: "cs_test_123",
    });
  });

  it("verifies checkout session status", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.balance.verifyCheckout({ sessionId: "cs_test_123" });

    expect(result).toEqual({
      status: "paid",
      amount: 100,
    });
  });
});

describe("orders router", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses SKUs from text input", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.orders.parseSkus({
      text: "701666410164\n3770006409028",
    });

    expect(result.skus).toContain("701666410164");
    expect(result.skus).toContain("3770006409028");
    expect(result.pricePerSku).toBe(2);
  });

  it("returns user orders list", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.orders.list();

    expect(result).toHaveLength(1);
    expect(result[0].status).toBe("completed");
  });

  it("returns order details with items", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.orders.get({ orderId: 1 });

    expect(result.order.id).toBe(1);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].sku).toBe("701666410164");
  });
});

describe("stores router", () => {
  it("returns list of supported stores", async () => {
    const ctx = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.stores.list();

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Test Store");
  });
});
