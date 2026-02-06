import { eq, desc, sql, and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  transactions,
  orders,
  orderItems,
  scrapedImages,
  stores,
  Transaction,
  Order,
  OrderItem,
  ScrapedImage,
  Store,
  InsertTransaction,
  InsertOrder,
  InsertOrderItem,
  InsertScrapedImage,
  InsertStore,
} from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// User functions - for OAuth users (legacy support)
export async function upsertUser(user: InsertUser): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    // For OAuth users, we need both openId and email
    if (!user.email) {
      throw new Error("User email is required for upsert");
    }

    const values: InsertUser = {
      email: user.email,
      openId: user.openId || null,
      name: user.name || null,
      loginMethod: user.loginMethod || "oauth",
      lastSignedIn: user.lastSignedIn || new Date(),
    };

    if (user.role !== undefined) {
      values.role = user.role;
    } else if (user.openId && user.openId === ENV.ownerOpenId) {
      values.role = "admin";
    }

    const updateSet: Record<string, unknown> = {
      name: values.name,
      lastSignedIn: new Date(),
    };

    if (user.openId) {
      updateSet.openId = user.openId;
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db
    .select()
    .from(users)
    .where(eq(users.openId, openId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserById(id: number) {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// Balance functions
export async function getUserBalance(userId: number): Promise<number> {
  const db = await getDb();
  if (!db) return 0;

  const result = await db
    .select({ balance: users.balance })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return result.length > 0 ? parseFloat(result[0].balance) : 0;
}

export async function updateUserBalance(
  userId: number,
  amount: number
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .update(users)
    .set({ balance: amount.toFixed(2) })
    .where(eq(users.id, userId));
}

export async function addToUserBalance(
  userId: number,
  amount: number
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const currentBalance = await getUserBalance(userId);
  const newBalance = currentBalance + amount;

  await updateUserBalance(userId, newBalance);
  return newBalance;
}

export async function deductFromUserBalance(
  userId: number,
  amount: number
): Promise<{ success: boolean; newBalance: number }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const currentBalance = await getUserBalance(userId);
  if (currentBalance < amount) {
    return { success: false, newBalance: currentBalance };
  }

  const newBalance = currentBalance - amount;
  await updateUserBalance(userId, newBalance);
  return { success: true, newBalance };
}

// Transaction functions
export async function createTransaction(
  data: InsertTransaction
): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(transactions).values(data);
  return result[0].insertId;
}

export async function updateTransactionStatus(
  id: number,
  status: "pending" | "completed" | "failed"
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(transactions).set({ status }).where(eq(transactions.id, id));
}

export async function getUserTransactions(userId: number): Promise<Transaction[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(transactions)
    .where(eq(transactions.userId, userId))
    .orderBy(desc(transactions.createdAt));
}

export async function getTransactionByPaymentId(
  paymentId: string
): Promise<Transaction | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(transactions)
    .where(eq(transactions.paymentId, paymentId))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Order functions
export async function createOrder(data: InsertOrder): Promise<number> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const result = await db.insert(orders).values(data);
  return result[0].insertId;
}

export async function updateOrder(
  id: number,
  data: Partial<Order>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(orders).set(data).where(eq(orders.id, id));
}

export async function getOrderById(id: number): Promise<Order | undefined> {
  const db = await getDb();
  if (!db) return undefined;

  const result = await db
    .select()
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getUserOrders(userId: number): Promise<Order[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt));
}

// Order item functions
export async function createOrderItems(
  items: InsertOrderItem[]
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (items.length > 0) {
    await db.insert(orderItems).values(items);
  }
}

export async function updateOrderItem(
  id: number,
  data: Partial<OrderItem>
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db.update(orderItems).set(data).where(eq(orderItems.id, id));
}

export async function getOrderItems(orderId: number): Promise<OrderItem[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
}

// Scraped images functions
export async function saveScrapedImages(
  images: InsertScrapedImage[]
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  if (images.length > 0) {
    await db.insert(scrapedImages).values(images);
  }
}

export async function getScrapedImagesByOrderItem(
  orderItemId: number
): Promise<ScrapedImage[]> {
  const db = await getDb();
  if (!db) return [];

  return db
    .select()
    .from(scrapedImages)
    .where(eq(scrapedImages.orderItemId, orderItemId));
}

// Store functions
export async function getActiveStores(): Promise<Store[]> {
  const db = await getDb();
  if (!db) return [];

  return db.select().from(stores).where(eq(stores.isActive, 1));
}

export async function upsertStore(data: InsertStore): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  await db
    .insert(stores)
    .values(data)
    .onDuplicateKeyUpdate({
      set: {
        baseUrl: data.baseUrl,
        searchUrlTemplate: data.searchUrlTemplate,
        category: data.category,
        isActive: data.isActive,
        selectors: data.selectors,
      },
    });
}

// Pricing constant
export const SKU_PRICE = 10; // $10 per SKU (~3 HQ images)
