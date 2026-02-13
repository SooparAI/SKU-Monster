#!/usr/bin/env node

import postgres from "postgres";

const DATABASE_URL =
  "postgresql://postgres:SpookedSkunk2026!@db.uhjlxjpqykhlukllnits.supabase.co:5432/postgres?sslmode=require";

const sql = postgres(DATABASE_URL, { ssl: true });

async function addCredit(email, amountCents) {
  try {
    console.log("Connecting to Supabase...");
    // Find user by email
    const users = await sql`
      SELECT id, email, balance FROM users WHERE email = ${email}
    `;

    if (!users || users.length === 0) {
      console.error(`❌ User not found: ${email}`);
      process.exit(1);
    }

    const user = users[0];
    const currentBalance = user.balance || 0;
    const newBalance = currentBalance + amountCents;

    // Update balance
    await sql`
      UPDATE users SET balance = ${newBalance} WHERE id = ${user.id}
    `;

    console.log(`✓ Added $${(amountCents / 100).toFixed(2)} credit to ${email}`);
    console.log(`  Previous balance: $${(currentBalance / 100).toFixed(2)}`);
    console.log(`  New balance: $${(newBalance / 100).toFixed(2)}`);

    process.exit(0);
  } catch (err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}

addCredit("sooryarp@gmail.com", 30000); // $300 in cents
