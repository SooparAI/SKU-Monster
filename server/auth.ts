import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { ENV } from "./_core/env";
import { getDb } from "./db";
import { users } from "../drizzle/schema";
import { eq } from "drizzle-orm";

const SALT_ROUNDS = 10;

// Get JWT secret as Uint8Array
function getJwtSecret(): Uint8Array {
  const secret = ENV.cookieSecret || "default-secret-change-me";
  return new TextEncoder().encode(secret);
}

// Hash password
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, SALT_ROUNDS);
}

// Verify password
export async function verifyPassword(
  password: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

// Create JWT token
export async function createToken(userId: number, email: string): Promise<string> {
  const token = await new SignJWT({ userId, email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("7d")
    .sign(getJwtSecret());
  return token;
}

// Verify JWT token
export async function verifyToken(
  token: string
): Promise<{ userId: number; email: string } | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    return {
      userId: payload.userId as number,
      email: payload.email as string,
    };
  } catch {
    return null;
  }
}

// Register a new user
export async function registerUser(params: {
  email: string;
  password: string;
  name: string;
}): Promise<{ success: boolean; userId?: number; error?: string }> {
  const { email, password, name } = params;
  const db = await getDb();
  if (!db) {
    return { success: false, error: "Database not available" };
  }

  try {
    // Check if email already exists
    const existing = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.length > 0) {
      return { success: false, error: "Email already registered" };
    }

    // Hash password and create user
    const passwordHash = await hashPassword(password);
    const result = await db.insert(users).values({
      email,
      passwordHash,
      name,
      loginMethod: "email",
      balance: "0.00",
    });

    const userId = result[0].insertId;
    return { success: true, userId };
  } catch (error) {
    console.error("Registration error:", error);
    return { success: false, error: "Registration failed" };
  }
}

// Login user
export async function loginUser(params: {
  email: string;
  password: string;
}): Promise<{
  success: boolean;
  token?: string;
  user?: {
    id: number;
    email: string;
    name: string | null;
    balance: string;
  };
  error?: string;
  needsPasswordSetup?: boolean;
}> {
  const { email, password } = params;
  const db = await getDb();
  if (!db) {
    return { success: false, error: "Database not available" };
  }

  try {
    // Find user by email
    const result = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (result.length === 0) {
      return { success: false, error: "Invalid email or password" };
    }

    const user = result[0];

    // Check if user has a password (might be OAuth user)
    if (!user.passwordHash) {
      // OAuth user trying to login with password - set their password
      const passwordHash = await hashPassword(password);
      await db
        .update(users)
        .set({ passwordHash, loginMethod: "email", lastSignedIn: new Date() })
        .where(eq(users.id, user.id));
      
      // Create token and log them in
      const token = await createToken(user.id, user.email);
      return {
        success: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          balance: user.balance,
        },
      };
    }

    // Verify password
    const isValid = await verifyPassword(password, user.passwordHash);
    if (!isValid) {
      return { success: false, error: "Invalid email or password" };
    }

    // Update last signed in
    await db
      .update(users)
      .set({ lastSignedIn: new Date() })
      .where(eq(users.id, user.id));

    // Create token
    const token = await createToken(user.id, user.email);

    return {
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        balance: user.balance,
      },
    };
  } catch (error) {
    console.error("Login error:", error);
    return { success: false, error: "Login failed" };
  }
}

// Get user by ID
export async function getUserById(userId: number) {
  const db = await getDb();
  if (!db) return null;

  const result = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return result.length > 0 ? result[0] : null;
}
