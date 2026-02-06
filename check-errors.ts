import { drizzle } from "drizzle-orm/mysql2";
import { orders, orderItems } from "./drizzle/schema";
import { eq, desc } from "drizzle-orm";

async function checkErrors() {
  const db = drizzle(process.env.DATABASE_URL!);
  
  // Get recent failed orders
  const failedOrders = await db.select().from(orders).where(eq(orders.status, 'failed')).orderBy(desc(orders.id)).limit(5);
  
  for (const order of failedOrders) {
    console.log(`\nOrder #${order.id} - Status: ${order.status}`);
    console.log(`  Total SKUs: ${order.totalSkus}, Processed: ${order.processedSkus}`);
    
    const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    for (const item of items) {
      console.log(`  SKU: ${item.sku} - Status: ${item.status}`);
      if (item.errorMessage) {
        console.log(`    Error: ${item.errorMessage}`);
      }
    }
  }
  
  process.exit(0);
}

checkErrors().catch(console.error);
