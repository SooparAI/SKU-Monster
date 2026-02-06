import { scrapeSku } from "./server/scrapers/scraperService";

async function main() {
  const startTime = Date.now();
  console.log("=== Testing OPTIMIZED scraper ===");
  console.log("SKU: 701666410164 (Amouage Honour)");
  console.log("Start time:", new Date().toISOString());
  
  const result = await scrapeSku("701666410164");
  
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  console.log("\n=== RESULTS ===");
  console.log(`Status: ${result.status}`);
  console.log(`Images: ${result.images.length}`);
  console.log(`Errors: ${result.errors.length}`);
  console.log(`Time: ${elapsed}s`);
  
  for (const img of result.images) {
    console.log(`  ${img.storeName}: ${img.width}x${img.height} - ${img.s3Url?.substring(0, 80)}...`);
  }
  
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
