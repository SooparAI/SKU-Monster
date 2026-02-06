import puppeteer from 'puppeteer';

async function testPlain() {
  console.log("Testing with plain puppeteer (no extra, no stealth)...");
  
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
    console.log("Testing FragranceNet...");
    await page.goto('https://www.fragrancenet.com/search/701666410164', { timeout: 30000, waitUntil: 'networkidle2' });
    const title = await page.title();
    console.log("Title:", title);
    
    // Get images
    const images = await page.$$eval('img', imgs => imgs.map(i => i.src).filter(s => s.includes('product') || s.includes('fragrance')).slice(0, 5));
    console.log("Found images:", images.length);
    images.forEach(img => console.log("  -", img.substring(0, 80)));
    
  } catch (err) {
    console.error("Error:", err);
  }
  
  await browser.close();
  process.exit(0);
}

testPlain();
