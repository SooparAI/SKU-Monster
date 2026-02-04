import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, decimal, json } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extended with balance for the SKU scraper application.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  balance: decimal("balance", { precision: 10, scale: 2 }).default("0.00").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Transactions table for tracking payments and balance changes
 */
export const transactions = mysqlTable("transactions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  type: mysqlEnum("type", ["topup", "charge", "refund"]).notNull(),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: varchar("paymentMethod", { length: 32 }), // stripe, solana
  paymentId: varchar("paymentId", { length: 255 }), // external payment reference
  status: mysqlEnum("status", ["pending", "completed", "failed"]).default("pending").notNull(),
  description: text("description"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = typeof transactions.$inferInsert;

/**
 * Orders table for tracking scrape jobs
 */
export const orders = mysqlTable("orders", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  status: mysqlEnum("status", ["pending", "processing", "completed", "partial", "failed"]).default("pending").notNull(),
  totalSkus: int("totalSkus").default(0).notNull(),
  processedSkus: int("processedSkus").default(0).notNull(),
  totalCost: decimal("totalCost", { precision: 10, scale: 2 }).default("0.00").notNull(),
  chargedAmount: decimal("chargedAmount", { precision: 10, scale: 2 }).default("0.00").notNull(),
  zipFileUrl: text("zipFileUrl"),
  zipFileKey: varchar("zipFileKey", { length: 512 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type Order = typeof orders.$inferSelect;
export type InsertOrder = typeof orders.$inferInsert;

/**
 * Order items table for individual SKUs in an order
 */
export const orderItems = mysqlTable("orderItems", {
  id: int("id").autoincrement().primaryKey(),
  orderId: int("orderId").notNull(),
  sku: varchar("sku", { length: 64 }).notNull(),
  status: mysqlEnum("status", ["pending", "processing", "completed", "failed", "skipped"]).default("pending").notNull(),
  imagesFound: int("imagesFound").default(0).notNull(),
  errorMessage: text("errorMessage"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  completedAt: timestamp("completedAt"),
});

export type OrderItem = typeof orderItems.$inferSelect;
export type InsertOrderItem = typeof orderItems.$inferInsert;

/**
 * Scraped images table for tracking individual images
 */
export const scrapedImages = mysqlTable("scrapedImages", {
  id: int("id").autoincrement().primaryKey(),
  orderItemId: int("orderItemId").notNull(),
  sku: varchar("sku", { length: 64 }).notNull(),
  sourceStore: varchar("sourceStore", { length: 64 }).notNull(),
  sourceUrl: text("sourceUrl").notNull(),
  imageUrl: text("imageUrl").notNull(),
  s3Key: varchar("s3Key", { length: 512 }),
  s3Url: text("s3Url"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ScrapedImage = typeof scrapedImages.$inferSelect;
export type InsertScrapedImage = typeof scrapedImages.$inferInsert;

/**
 * Supported stores configuration
 */
export const stores = mysqlTable("stores", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 64 }).notNull().unique(),
  baseUrl: text("baseUrl").notNull(),
  searchUrlTemplate: text("searchUrlTemplate").notNull(),
  category: varchar("category", { length: 64 }).default("fragrance").notNull(),
  isActive: int("isActive").default(1).notNull(),
  selectors: json("selectors"), // CSS selectors for scraping
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Store = typeof stores.$inferSelect;
export type InsertStore = typeof stores.$inferInsert;
