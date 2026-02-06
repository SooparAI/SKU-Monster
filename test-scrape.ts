import { scrapeSku } from "./server/scrapers/scraperService";

async function testScrape() {
  console.log("Starting test scrape for SKU 701666410164...");
  try {
    const result = await scrapeSku("701666410164");
    console.log("\n=== RESULT ===");
    console.log(`Status: ${result.status}`);
    console.log(`Images found: ${result.images.length}`);
    console.log(`Errors: ${result.errors.length}`);
    if (result.errors.length > 0) {
      console.log("Error details:");
      result.errors.forEach(e => console.log(`  - ${e}`));
    }
    if (result.images.length > 0) {
      console.log("Images:");
      result.images.slice(0, 5).forEach(img => {
        console.log(`  - ${img.storeName}: ${img.s3Url || img.imageUrl}`);
      });
    }
  } catch (err) {
    console.error("Test scrape failed:", err);
  }
  process.exit(0);
}

testScrape();
