import puppeteer from 'puppeteer';

async function testNoProxy() {
  console.log("Testing WITHOUT proxy...");
  
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
  });
  
  const page = await browser.newPage();
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  try {
    console.log("Testing Sephora...");
    await page.goto('https://www.sephora.com/search?keyword=701666410164', { timeout: 30000, waitUntil: 'networkidle2' });
    const title = await page.title();
    console.log("Sephora title:", title);
    
    // Check for images
    const images = await page.$$eval('img', imgs => imgs.map(i => i.src).filter(s => s.includes('product') || s.includes('sephora')));
    console.log(`Found ${images.length} potential product images`);
    if (images.length > 0) {
      console.log("First 3 images:", images.slice(0, 3));
    }
    
    console.log("\nTesting FragranceNet...");
    await page.goto('https://www.fragrancenet.com/search/701666410164', { timeout: 30000, waitUntil: 'networkidle2' });
    const fnTitle = await page.title();
    console.log("FragranceNet title:", fnTitle);
    
    const fnImages = await page.$$eval('img', imgs => imgs.map(i => i.src).filter(s => s.includes('product') || s.includes('fragrance')));
    console.log(`Found ${fnImages.length} potential product images`);
    
  } catch (err) {
    console.error("Error:", err);
  }
  
  await browser.close();
  process.exit(0);
}

testNoProxy();
