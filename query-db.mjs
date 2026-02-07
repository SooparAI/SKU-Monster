import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';

// Read env from server/_core/env.ts pattern
const dbUrl = process.env.DATABASE_URL;

async function main() {
  const conn = await mysql.createConnection({
    uri: dbUrl,
    ssl: { rejectUnauthorized: true }
  });
  
  const [orders] = await conn.execute('SELECT id, status, totalSkus, processedSkus, totalCost, chargedAmount, zipFileUrl, createdAt, completedAt FROM orders WHERE id >= 270018 ORDER BY id DESC');
  console.log('=== ORDERS >=270018 ===');
  for (const o of orders) {
    console.log(`Order #${o.id}: status=${o.status}, skus=${o.processedSkus}/${o.totalSkus}, cost=${o.totalCost}, charged=${o.chargedAmount}, zip=${o.zipFileUrl ? 'YES' : 'NO'}, created=${o.createdAt}, completed=${o.completedAt}`);
  }
  
  const [items] = await conn.execute('SELECT id, orderId, sku, status, imagesFound, errorMessage FROM orderItems WHERE orderId >= 270018 ORDER BY orderId DESC');
  console.log('\n=== ORDER ITEMS >=270018 ===');
  for (const i of items) {
    console.log(`  Item #${i.id}: order=${i.orderId}, sku=${i.sku}, status=${i.status}, images=${i.imagesFound}, error=${i.errorMessage || 'none'}`);
  }
  
  // Check user balance
  const [users] = await conn.execute('SELECT id, email, balance FROM users LIMIT 5');
  console.log('\n=== USERS ===');
  for (const u of users) {
    console.log(`  User #${u.id}: ${u.email}, balance=$${u.balance}`);
  }
  
  await conn.end();
}

main().catch(console.error);
