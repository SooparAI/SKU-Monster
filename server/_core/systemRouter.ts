import { z } from "zod";
import { notifyOwner } from "./notification";
import { adminProcedure, publicProcedure, router } from "./trpc";
import { getDb } from "../db";
import { users } from "../../drizzle/schema";
import { eq } from "drizzle-orm";

export const systemRouter = router({
  health: publicProcedure
    .input(
      z.object({
        timestamp: z.number().min(0, "timestamp cannot be negative"),
      })
    )
    .query(() => ({
      ok: true,
    })),

  notifyOwner: adminProcedure
    .input(
      z.object({
        title: z.string().min(1, "title is required"),
        content: z.string().min(1, "content is required"),
      })
    )
    .mutation(async ({ input }) => {
      const delivered = await notifyOwner(input);
      return {
        success: delivered,
      } as const;
    }),

  addCredit: adminProcedure
    .input(
      z.object({
        email: z.string().email("invalid email"),
        amountCents: z.number().positive("amount must be positive"),
      })
    )
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not connected");

      const userList = await db
        .select()
        .from(users)
        .where(eq(users.email, input.email))
        .limit(1);

      if (!userList || userList.length === 0) {
        throw new Error(`User not found: ${input.email}`);
      }

      const user = userList[0];
      const currentBalance = parseFloat((user.balance as unknown as string) || "0");
      const newBalance = currentBalance + input.amountCents / 100;

      await db
        .update(users)
        .set({ balance: newBalance.toString() })
        .where(eq(users.id, user.id));

      return {
        success: true,
        email: user.email,
        previousBalance: currentBalance,
        newBalance: newBalance,
        addedAmount: input.amountCents / 100,
      };
    }),
});
