import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import { sdk } from "./sdk";
import { verifyToken, getUserById } from "../auth";
import cookie from "cookie";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  let user: User | null = null;

  // First try custom auth token
  const cookies = cookie.parse(opts.req.headers.cookie || "");
  const authToken = cookies["auth_token"];

  if (authToken) {
    try {
      const payload = await verifyToken(authToken);
      if (payload) {
        const dbUser = await getUserById(payload.userId);
        if (dbUser) {
          user = dbUser;
        }
      }
    } catch (error) {
      // Token invalid, try OAuth
      console.log("[Auth] Custom token invalid, trying OAuth");
    }
  }

  // If no custom auth, try OAuth
  if (!user) {
    try {
      user = await sdk.authenticateRequest(opts.req);
    } catch (error) {
      // Authentication is optional for public procedures.
      user = null;
    }
  }

  return {
    req: opts.req,
    res: opts.res,
    user,
  };
}
