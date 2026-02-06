import { getDb } from "./server/db";
import { orders, orderItems } from "./drizzle/schema";
import { desc, eq } from "drizzle-orm";

async function main() {
  const db = await getDb();
  const allOrders = await db.select().from(orders).orderBy(desc(orders.id)).limit(10);
  for (const o of allOrders) {
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, o.id));
    console.log(`Order #${o.id} | Status: ${o.status} | SKUs: ${o.processedSkus}/${o.totalSkus} | Cost: $${o.totalCost}`);
    console.log(`  Zip: ${o.zipFileUrl ? o.zipFileUrl.substring(0, 100) : 'NONE'}`);
    console.log(`  Created: ${o.createdAt}`);
    for (const item of items) {
      console.log(`  SKU: ${item.sku} | Status: ${item.status} | Error: ${item.errorMessage || 'none'}`);
    }
    console.log('---');
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
