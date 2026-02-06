import puppeteer from 'puppeteer';
import { getProxyForPuppeteer } from './server/scrapers/asocksProxy';

async function testProxyAuth() {
  console.log("Testing proxy authentication...");
  
  const proxy = await getProxyForPuppeteer();
  if (!proxy) {
    console.log("No proxy available");
    return;
  }
  
  console.log(`Proxy server: ${proxy.server}`);
  console.log(`Username: ${proxy.username}`);
  console.log(`Password: ${proxy.password.substring(0, 4)}...`);
  
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      `--proxy-server=${proxy.server}`,
    ],
  });
  
  const page = await browser.newPage();
  
  // Set up authentication
  await page.authenticate({
    username: proxy.username,
    password: proxy.password,
  });
  
  try {
    console.log("Navigating to httpbin.org to test proxy...");
    await page.goto('https://httpbin.org/ip', { timeout: 30000 });
    const content = await page.content();
    console.log("Response:", content.substring(0, 500));
    
    // Also test a real site
    console.log("\nTesting with Sephora...");
    await page.goto('https://www.sephora.com', { timeout: 30000 });
    const title = await page.title();
    console.log("Sephora title:", title);
  } catch (err) {
    console.error("Error:", err);
  }
  
  await browser.close();
  process.exit(0);
}

testProxyAuth();
