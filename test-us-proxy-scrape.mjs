import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

const ASOCKS_API_KEY = '2f74d4c2d93ff6db9016142cb76ed56f';

async function getUSProxy() {
  // Fetch all pages to get US proxies
  const allProxies = [];
  let page = 1;
  let totalPages = 1;
  
  do {
    const response = await fetch(
      `https://api.asocks.com/v2/proxy/ports?apiKey=${ASOCKS_API_KEY}&page=${page}`
    );
    const data = await response.json();
    
    if (data.success && data.message?.proxies) {
      const activeProxies = data.message.proxies.filter(p => p.status === 1 || p.status === 2);
      allProxies.push(...activeProxies);
      
      if (data.message.pagination) {
        totalPages = data.message.pagination.pageCount;
      }
    }
    page++;
  } while (page <= totalPages);
  
  // Get first US proxy
  const usProxy = allProxies.find(p => p.countryCode === 'US');
  if (!usProxy) {
    throw new Error('No US proxy found');
  }
  
  console.log(`Using US proxy: ${usProxy.proxy}`);
  return {
    server: `http://${usProxy.proxy}`,
    username: usProxy.login,
    password: usProxy.password,
  };
}

async function testScrape() {
  console.log('Fetching US proxy...');
  const proxy = await getUSProxy();
  
  console.log('Launching browser with US proxy...');
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      `--proxy-server=${proxy.server}`,
    ],
  });
  
  const page = await browser.newPage();
  
  // Authenticate with proxy
  await page.authenticate({
    username: proxy.username,
    password: proxy.password,
  });
  
  // Set realistic headers
  await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
  
  try {
    // Test with Sephora (one of the sites that was blocking)
    console.log('Testing Sephora.com...');
    const response = await page.goto('https://www.sephora.com/search?keyword=3614225621932', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    
    console.log(`Response status: ${response?.status()}`);
    
    // Check if we got content
    const title = await page.title();
    console.log(`Page title: ${title}`);
    
    // Check for product images
    const images = await page.$$eval('img', imgs => 
      imgs.map(img => img.src).filter(src => src && src.includes('sephora'))
    );
    console.log(`Found ${images.length} Sephora images`);
    
    if (images.length > 0) {
      console.log('✅ SUCCESS! US proxy is working with Sephora');
    } else {
      console.log('⚠️ Page loaded but no product images found');
    }
    
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  } finally {
    await browser.close();
  }
}

testScrape();
