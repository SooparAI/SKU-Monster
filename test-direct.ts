import puppeteer from 'puppeteer';

async function testDirect() {
  console.log("Testing direct puppeteer (no proxy)...");
  
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });
  
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  try {
    console.log("Testing Jomashop...");
    await page.goto('https://www.jomashop.com/search?q=701666410164', { timeout: 30000, waitUntil: 'domcontentloaded' });
    const title = await page.title();
    console.log("Jomashop title:", title);
    
    console.log("\nTesting FragranceNet...");
    await page.goto('https://www.fragrancenet.com/search/701666410164', { timeout: 30000, waitUntil: 'domcontentloaded' });
    const fnTitle = await page.title();
    console.log("FragranceNet title:", fnTitle);
    
    // Get images
    const images = await page.$$eval('img', imgs => imgs.map(i => i.src).filter(s => s.includes('product') || s.includes('fragrance')).slice(0, 5));
    console.log("Found images:", images.length);
    
  } catch (err) {
    console.error("Error:", err);
  }
  
  await browser.close();
  process.exit(0);
}

testDirect();
