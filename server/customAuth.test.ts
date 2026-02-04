import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the auth functions
vi.mock("./auth", () => ({
  registerUser: vi.fn().mockImplementation(async (params: { email: string; password: string; name: string }) => {
    if (params.email === "existing@test.com") {
      return { success: false, error: "Email already registered" };
    }
    return { success: true, userId: 1 };
  }),
  loginUser: vi.fn().mockImplementation(async (params: { email: string; password: string }) => {
    if (params.email === "test@test.com" && params.password === "password123") {
      return {
        success: true,
        token: "test-jwt-token",
        user: {
          id: 1,
          email: "test@test.com",
          name: "Test User",
          balance: "0.00",
        },
      };
    }
    return { success: false, error: "Invalid email or password" };
  }),
  createToken: vi.fn().mockResolvedValue("test-jwt-token"),
  getUserById: vi.fn().mockResolvedValue({
    id: 1,
    email: "test@test.com",
    name: "Test User",
    balance: "0.00",
  }),
}));

// Mock database functions
vi.mock("./db", () => ({
  getUserBalance: vi.fn().mockResolvedValue(100),
  addToUserBalance: vi.fn().mockResolvedValue(150),
  deductFromUserBalance: vi.fn().mockResolvedValue({ success: true, newBalance: 85 }),
  createTransaction: vi.fn().mockResolvedValue(1),
  updateTransactionStatus: vi.fn().mockResolvedValue(undefined),
  getUserTransactions: vi.fn().mockResolvedValue([]),
  getTransactionByPaymentId: vi.fn().mockResolvedValue(null),
  createOrder: vi.fn().mockResolvedValue(1),
  updateOrder: vi.fn().mockResolvedValue(undefined),
  getOrderById: vi.fn().mockResolvedValue(null),
  getUserOrders: vi.fn().mockResolvedValue([]),
  createOrderItems: vi.fn().mockResolvedValue(undefined),
  updateOrderItem: vi.fn().mockResolvedValue(undefined),
  getOrderItems: vi.fn().mockResolvedValue([]),
  saveScrapedImages: vi.fn().mockResolvedValue(undefined),
  SKU_PRICE: 15,
}));

// Mock scraper service
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
  parseSkusFromText: vi.fn().mockReturnValue([]),
}));

// Mock store configs
vi.mock("./scrapers/storeConfigs", () => ({
  getActiveStores: vi.fn().mockReturnValue([]),
}));

// Mock LLM
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{ message: { content: '{"skus": []}' } }],
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

function createPublicContext(): TrpcContext {
  const cookieSet: { name: string; value: string; options: Record<string, unknown> }[] = [];
  const cookieCleared: { name: string; options: Record<string, unknown> }[] = [];

  return {
    user: null,
    req: {
      protocol: "https",
      headers: {
        origin: "https://test.example.com",
      },
    } as TrpcContext["req"],
    res: {
      cookie: (name: string, value: string, options: Record<string, unknown>) => {
        cookieSet.push({ name, value, options });
      },
      clearCookie: (name: string, options: Record<string, unknown>) => {
        cookieCleared.push({ name, options });
      },
    } as unknown as TrpcContext["res"],
  };
}

describe("custom auth - register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("registers a new user successfully", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.register({
      email: "newuser@test.com",
      password: "password123",
      name: "New User",
    });

    expect(result.success).toBe(true);
    expect(result.userId).toBe(1);
  });

  it("fails to register with existing email", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.auth.register({
        email: "existing@test.com",
        password: "password123",
        name: "Existing User",
      })
    ).rejects.toThrow("Email already registered");
  });

  it("validates email format", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.auth.register({
        email: "invalid-email",
        password: "password123",
        name: "Test User",
      })
    ).rejects.toThrow();
  });

  it("validates password minimum length", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.auth.register({
        email: "test@test.com",
        password: "short",
        name: "Test User",
      })
    ).rejects.toThrow();
  });
});

describe("custom auth - login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("logs in with valid credentials", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.login({
      email: "test@test.com",
      password: "password123",
    });

    expect(result.success).toBe(true);
    expect(result.user).toBeDefined();
    expect(result.user?.email).toBe("test@test.com");
  });

  it("fails with invalid credentials", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    await expect(
      caller.auth.login({
        email: "test@test.com",
        password: "wrongpassword",
      })
    ).rejects.toThrow("Invalid email or password");
  });
});

describe("custom auth - logout", () => {
  it("clears auth cookies on logout", async () => {
    const ctx = createPublicContext();
    const caller = appRouter.createCaller(ctx);

    const result = await caller.auth.logout();

    expect(result.success).toBe(true);
  });
});
