// Test the programmatic scraper (no AI)
import { scrapeSku } from "./server/scrapers/scraperService";

const SKU = "701666410164"; // Amouage Honour

async function main() {
  console.log(`\n=== Testing PROGRAMMATIC scraper for SKU ${SKU} ===\n`);
  console.log("This scrapes ALL stores directly without AI lookup.\n");
  
  const startTime = Date.now();
  
  try {
    const result = await scrapeSku(SKU);
    
    const duration = Math.floor((Date.now() - startTime) / 1000);
    
    console.log("\n=== RESULT ===");
    console.log(`Status: ${result.status}`);
    console.log(`Duration: ${duration}s`);
    console.log(`Images found: ${result.images.length}`);
    console.log(`Errors: ${result.errors.length}`);
    
    if (result.images.length > 0) {
      console.log("\nImages:");
      for (const img of result.images) {
        console.log(`  - ${img.storeName}: ${img.s3Url || img.imageUrl}`);
      }
    }
    
    if (result.errors.length > 0) {
      console.log("\nErrors (first 5):");
      for (const err of result.errors.slice(0, 5)) {
        console.log(`  - ${err}`);
      }
    }
  } catch (err) {
    console.error("Test failed:", err);
  }
}

main();
