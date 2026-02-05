import puppeteer, { Browser, Page } from "puppeteer";
import { StoreConfig, storeConfigs, getActiveStores, buildSearchUrl, isValidProductImage } from "./storeConfigs";
import { storagePut } from "../storage";
import { nanoid } from "nanoid";
import archiver from "archiver";
import { Writable } from "stream";
import puppeteerExtra from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import sharp from "sharp";
import { lookupProductBySku, ProductLookupResult } from "./perplexityLookup";
import { processImagesHQ, uploadHQImages } from "./hqImagePipeline";
import { getProxyForPuppeteer } from "./asocksProxy";

// Add stealth plugin to avoid bot detection
puppeteerExtra.use(StealthPlugin());

// Random user agents to rotate
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function randomDelay(min: number, max: number): Promise<void> {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
}

export interface ScrapedImageResult {
  sku: string;
  storeName: string;
  sourceUrl: string;
  imageUrl: string;
  s3Key?: string;
  s3Url?: string;
  width?: number;
  height?: number;
}

export interface SkuScrapeResult {
  sku: string;
  images: ScrapedImageResult[];
  errors: string[];
  status: "completed" | "partial" | "failed";
}

export interface ScrapeJobResult {
  orderId: number;
  results: SkuScrapeResult[];
  zipKey?: string;
  zipUrl?: string;
  totalImages: number;
  processedSkus: number;
  failedSkus: number;
}

// Browser instance management - create new browser for each scrape job to ensure proxy rotation
let browserInstance: Browser | null = null;
let browserUsingProxy: boolean = false;

async function getBrowser(useProxy: boolean = true): Promise<Browser> {
  // Always create new browser if proxy setting changed or browser not connected
  if (!browserInstance || !browserInstance.connected || browserUsingProxy !== useProxy) {
    // Close existing browser if any
    if (browserInstance && browserInstance.connected) {
      await browserInstance.close();
      browserInstance = null;
    }
    
    const launchArgs = [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-accelerated-2d-canvas",
      "--disable-gpu",
      "--window-size=1920x1080",
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
    ];

    // Add proxy if available and requested
    if (useProxy) {
      const proxy = await getProxyForPuppeteer();
      if (proxy) {
        launchArgs.push(`--proxy-server=${proxy.server}`);
        console.log(`[Browser] 🔒 Using Asocks proxy: ${proxy.server}`);
        browserUsingProxy = true;
      } else {
        console.log(`[Browser] ⚠️ No proxy available, running without proxy`);
        browserUsingProxy = false;
      }
    } else {
      browserUsingProxy = false;
    }

    // Use puppeteer-extra with stealth plugin for anti-detection
    browserInstance = await puppeteerExtra.launch({
      headless: true,
      args: launchArgs,
    }) as Browser;
    console.log(`[Browser] Launched new browser instance (proxy: ${browserUsingProxy})`);
  }
  return browserInstance;
}

async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

// Delay helper
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Universal image filter patterns - URLs containing these are NOT product images
const NON_PRODUCT_PATTERNS = [
  /logo/i, /icon/i, /payment/i, /banner/i, /sprite/i, /thumb/i, /placeholder/i,
  /loading/i, /lazy/i, /pixel/i, /tracking/i, /1x1/i, /badge/i, /flag/i,
  /visa/i, /mastercard/i, /amex/i, /paypal/i, /apple-pay/i, /google-pay/i,
  /tabby/i, /tamara/i, /klarna/i, /afterpay/i, /social/i, /facebook/i,
  /twitter/i, /instagram/i, /youtube/i, /tiktok/i, /pinterest/i, /linkedin/i,
  /whatsapp/i, /share/i, /rating/i, /star/i, /review/i, /avatar/i, /user/i,
  /profile/i, /cart/i, /checkout/i, /shipping/i, /delivery/i, /return/i,
  /guarantee/i, /trust/i, /secure/i, /ssl/i, /certificate/i, /arrow/i,
  /chevron/i, /close/i, /menu/i, /hamburger/i, /search/i, /magnify/i,
  /zoom-icon/i, /play-button/i, /video-icon/i, /\.svg$/i, /\.gif$/i,
  /data:image/i, /base64/i, /transparent/i, /spacer/i, /blank/i, /empty/i,
  /no-image/i, /coming-soon/i, /out-of-stock/i, /_xs\./i, /_sm\./i,
  /_tiny/i, /_small/i, /w=50/i, /w=100/i, /h=50/i, /h=100/i, /size=50/i, /size=100/i,
];

// Check if URL looks like a product image
function isProductImageUrl(url: string): boolean {
  if (!url) return false;
  const hasImageExtension = /\.(jpg|jpeg|png|webp)(\?|$)/i.test(url);
  const hasImagePath = /\/image[s]?\//i.test(url) || /\/product[s]?\//i.test(url) || /\/media\//i.test(url);
  if (!hasImageExtension && !hasImagePath) return false;
  for (const pattern of NON_PRODUCT_PATTERNS) {
    if (pattern.test(url)) return false;
  }
  return true;
}

// Check if product was found on the page
async function isProductFound(page: Page, store: StoreConfig): Promise<boolean> {
  try {
    // First check if no results selector exists
    const noResultsElement = await page.$(store.selectors.noResults);
    if (noResultsElement) {
      // Check if it's visible
      const isVisible = await page.evaluate(el => {
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      }, noResultsElement);
      if (isVisible) {
        return false;
      }
    }
    
    // Then check if product found selector exists
    const productFoundElement = await page.$(store.selectors.productFound);
    return productFoundElement !== null;
  } catch {
    return false;
  }
}

// Extract all potential product images from a page using multiple strategies
async function extractAllProductImages(page: Page, store: StoreConfig): Promise<string[]> {
  const allUrls: string[] = [];
  
  // Strategy 1: Use store-specific selector first
  try {
    const storeImages = await page.$$eval(
      store.selectors.productImage,
      (elements, highResAttr) => {
        return elements.map(el => {
          let url = '';
          if (highResAttr === 'srcset') {
            const srcset = el.getAttribute('srcset');
            if (srcset) {
              const entries = srcset.split(',').map(entry => {
                const parts = entry.trim().split(/\s+/);
                return { url: parts[0], width: parseInt(parts[1]?.replace('w', '') || '0', 10) };
              });
              entries.sort((a, b) => b.width - a.width);
              url = entries[0]?.url || '';
            }
          } else if (highResAttr === 'data-zoom-image') {
            url = el.getAttribute('data-zoom-image') || '';
          } else if (highResAttr === 'data-large_image') {
            url = el.getAttribute('data-large_image') || '';
          }
          if (!url) url = el.getAttribute('data-zoom-image') || '';
          if (!url) url = el.getAttribute('data-large_image') || '';
          if (!url) url = el.getAttribute('data-src') || '';
          if (!url) url = el.getAttribute('src') || '';
          return url;
        }).filter(url => url && (url.startsWith('http') || url.startsWith('//')));
      },
      store.imageConfig.highResAttribute
    );
    allUrls.push(...storeImages);
    console.log(`  Store selector found ${storeImages.length} images`);
  } catch (err) {
    console.log(`  Store selector failed: ${err}`);
  }
  
  // Strategy 2: Generic product image selectors
  const genericSelectors = [
    '.product-image img', '.product-gallery img', '.product-media img', '.pdp-image img',
    '.main-image img', '#main-image', '#product-image', '.gallery-image img', '.zoom-image img',
    '.woocommerce-product-gallery__image img', '.fotorama__stage__frame img',
    '.slick-slide img', '.swiper-slide img', '.carousel-item img',
    '[data-zoom-image]', '[data-large_image]', '[data-full-image]', '[data-original]',
    'picture source[srcset]', 'picture img',
    'img[width="500"]', 'img[width="600"]', 'img[width="700"]', 'img[width="800"]',
  ];
  
  for (const selector of genericSelectors) {
    try {
      const images = await page.$$eval(selector, (elements) => {
        return elements.map(el => {
          if (el.tagName === 'SOURCE') {
            const srcset = el.getAttribute('srcset');
            if (srcset) {
              const entries = srcset.split(',').map(entry => {
                const parts = entry.trim().split(/\s+/);
                return { url: parts[0], width: parseInt(parts[1]?.replace('w', '') || '0', 10) };
              });
              entries.sort((a, b) => b.width - a.width);
              return entries[0]?.url || '';
            }
          }
          let url = el.getAttribute('data-zoom-image') || '';
          if (!url) url = el.getAttribute('data-large_image') || '';
          if (!url) url = el.getAttribute('data-full-image') || '';
          if (!url) url = el.getAttribute('data-original') || '';
          if (!url) url = el.getAttribute('data-src') || '';
          if (!url) url = el.getAttribute('src') || '';
          return url;
        }).filter(url => url && (url.startsWith('http') || url.startsWith('//')));
      });
      if (images.length > 0) allUrls.push(...images);
    } catch { /* Selector not found */ }
  }
  
  // Strategy 3: Find all large images on the page
  try {
    const largeImages = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return imgs
        .filter(img => {
          const width = img.naturalWidth || parseInt(img.getAttribute('width') || '0', 10);
          const height = img.naturalHeight || parseInt(img.getAttribute('height') || '0', 10);
          if (width < 200 && height < 200) return false;
          const rect = img.getBoundingClientRect();
          if (rect.width < 150 && rect.height < 150) return false;
          return true;
        })
        .map(img => {
          let url = img.getAttribute('data-zoom-image') || '';
          if (!url) url = img.getAttribute('data-large_image') || '';
          if (!url) url = img.getAttribute('data-src') || '';
          if (!url) url = img.src || '';
          return url;
        })
        .filter(url => url && (url.startsWith('http') || url.startsWith('//')));
    });
    allUrls.push(...largeImages);
  } catch (err) {
    console.log(`  Large image scan failed: ${err}`);
  }
  
  // Normalize and deduplicate URLs
  const normalizedUrls = allUrls
    .map(url => url.startsWith('//') ? `https:${url}` : url)
    .map(url => upgradeImageUrl(url)) // Try to get higher resolution versions
    .filter(url => isProductImageUrl(url));
  
  const uniqueUrls = Array.from(new Set(normalizedUrls));
  console.log(`  Total unique product images found: ${uniqueUrls.length}`);
  
  // Limit to top 5 images per store to focus on main product images
  return uniqueUrls.slice(0, 5);
}

// Comprehensive CDN URL upgrade function to get highest quality images
function upgradeImageUrl(url: string): string {
  let upgraded = url;
  
  // === CLOUDINARY (used by many stores) ===
  // Pattern: /upload/w_300,h_300,c_fit/ or /upload/f_auto,q_auto:eco/
  if (upgraded.includes('cloudinary.com') || upgraded.includes('res.cloudinary.com')) {
    // Remove all transformation parameters to get original
    upgraded = upgraded.replace(/\/upload\/[^/]+\//, '/upload/');
    // Or maximize quality: replace with high quality params
    upgraded = upgraded.replace(/\/upload\//, '/upload/q_100,f_png/');
  }
  
  // === SHOPIFY CDN ===
  // Pattern: _100x100.jpg, _200x.jpg, _x200.jpg, _small.jpg, _medium.jpg
  if (upgraded.includes('cdn.shopify.com') || upgraded.includes('.myshopify.com')) {
    // Remove size suffix to get original
    upgraded = upgraded.replace(/_\d+x\d*\./, '.');
    upgraded = upgraded.replace(/_\d*x\d+\./, '.');
    upgraded = upgraded.replace(/_(pico|icon|thumb|small|compact|medium|large|grande|master|original)\./gi, '.');
    // Remove crop parameters
    upgraded = upgraded.replace(/_crop_[a-z]+\./gi, '.');
  }
  
  // === SCENE7 / ADOBE DYNAMIC MEDIA (Macy's, Nordstrom, Sephora, etc.) ===
  // Pattern: ?$XXX$ or ?wid=300&hei=300 or ?op_sharpen=1&wid=500
  if (upgraded.includes('scene7.com') || upgraded.includes('/is/image/')) {
    // Remove all query parameters to get full resolution
    upgraded = upgraded.split('?')[0];
    // Add max quality params
    upgraded += '?wid=2000&hei=2000&fmt=png-alpha&qlt=100';
  }
  
  // === AKAMAI IMAGE MANAGER ===
  // Pattern: ?imwidth=300 or ?im=Resize,width=300
  if (upgraded.includes('akamaized.net') || upgraded.includes('akamaiobjects.com')) {
    upgraded = upgraded.replace(/\?im(width|height)=\d+/gi, '');
    upgraded = upgraded.replace(/\?im=Resize[^&]*/gi, '');
    upgraded = upgraded.split('?')[0];
  }
  
  // === IMGIX ===
  // Pattern: ?w=300&h=300&fit=crop or ?auto=format,compress
  if (upgraded.includes('imgix.net') || upgraded.includes('.imgix.')) {
    upgraded = upgraded.split('?')[0];
    upgraded += '?q=100&auto=format';
  }
  
  // === FASTLY IMAGE OPTIMIZER ===
  // Pattern: ?width=300&height=300&quality=80
  if (upgraded.includes('fastly.net') || upgraded.includes('global.ssl.fastly.net')) {
    upgraded = upgraded.replace(/[?&](width|height|quality|fit|crop)=[^&]*/gi, '');
    if (!upgraded.includes('?')) upgraded += '?';
    upgraded += '&quality=100';
  }
  
  // === CONTENTFUL ===
  // Pattern: ?w=300&h=300&q=80&fm=webp
  if (upgraded.includes('ctfassets.net') || upgraded.includes('contentful.com')) {
    upgraded = upgraded.split('?')[0];
    upgraded += '?q=100&fm=png';
  }
  
  // === SANITY.IO ===
  // Pattern: ?w=300&h=300&q=80
  if (upgraded.includes('sanity.io') || upgraded.includes('cdn.sanity.io')) {
    upgraded = upgraded.replace(/\?.*$/, '');
    upgraded += '?q=100';
  }
  
  // === WOOCOMMERCE / WORDPRESS ===
  // Pattern: -300x300.jpg, -150x150.jpg
  if (upgraded.match(/-\d+x\d+\.(jpg|jpeg|png|webp)/i)) {
    upgraded = upgraded.replace(/-\d+x\d+\.(jpg|jpeg|png|webp)/i, '.$1');
  }
  
  // === MAGENTO ===
  // Pattern: /cache/1/image/300x300/ or /resize/300x300/
  if (upgraded.includes('/cache/') && upgraded.includes('/image/')) {
    upgraded = upgraded.replace(/\/cache\/\d+\/image\/\d+x\d+\//gi, '/cache/1/image/');
  }
  if (upgraded.includes('/resize/')) {
    upgraded = upgraded.replace(/\/resize\/\d+x\d*\//gi, '/');
    upgraded = upgraded.replace(/\/resize\/\d*x\d+\//gi, '/');
  }
  
  // === FRAGRANCEX ===
  if (upgraded.includes('img.fragrancex.com')) {
    if (upgraded.includes('/sku/small/')) {
      upgraded = upgraded.replace('/sku/small/', '/parent/medium/');
    }
  }
  
  // === FRAGRANCENET ===
  if (upgraded.includes('fragrancenet.com')) {
    upgraded = upgraded.replace(/_s\./g, '_l.').replace(/_m\./g, '_l.');
  }
  
  // === SEPHORA ===
  if (upgraded.includes('sephora.com') || upgraded.includes('sephora.')) {
    // Remove size constraints
    upgraded = upgraded.replace(/\?.*$/, '');
    upgraded = upgraded.replace(/_\d+x\d+_/g, '_');
  }
  
  // === NORDSTROM ===
  if (upgraded.includes('nordstrom.com') || upgraded.includes('n.nordstrommedia.com')) {
    upgraded = upgraded.split('?')[0];
    upgraded += '?h=2000&w=2000';
  }
  
  // === BLOOMINGDALE'S / MACY'S ===
  if (upgraded.includes('bloomingdales.com') || upgraded.includes('macys.com')) {
    upgraded = upgraded.split('?')[0];
    if (upgraded.includes('scene7')) {
      upgraded += '?wid=2000&hei=2000&fmt=png-alpha&qlt=100';
    }
  }
  
  // === NEIMAN MARCUS / BERGDORF ===
  if (upgraded.includes('neimanmarcus.com') || upgraded.includes('bergdorfgoodman.com')) {
    upgraded = upgraded.split('?')[0];
    upgraded += '?wid=2000&hei=2000';
  }
  
  // === HARRODS ===
  if (upgraded.includes('harrods.com')) {
    upgraded = upgraded.replace(/\/w\d+\//g, '/w2000/');
    upgraded = upgraded.replace(/\?.*$/, '');
  }
  
  // === SELFRIDGES ===
  if (upgraded.includes('selfridges.com')) {
    upgraded = upgraded.replace(/\?.*$/, '');
    upgraded = upgraded.replace(/_\d+\./g, '.');
  }
  
  // === NET-A-PORTER / MR PORTER ===
  if (upgraded.includes('net-a-porter.com') || upgraded.includes('mrporter.com')) {
    upgraded = upgraded.replace(/_pp\.jpg/g, '_in_pp.jpg');
    upgraded = upgraded.replace(/\/w\d+\//g, '/w2000/');
  }
  
  // === COSBAR ===
  if (upgraded.includes('cosbar.com')) {
    upgraded = upgraded.replace(/\?.*$/, '');
    // Try to get original by removing size suffix
    upgraded = upgraded.replace(/_\d+x\d+\./g, '.');
  }
  
  // === JOMASHOP ===
  if (upgraded.includes('jomashop.com')) {
    upgraded = upgraded.replace(/\?.*$/, '');
    upgraded = upgraded.replace(/-\d+x\d+\./g, '.');
  }
  
  // === DOUGLAS / NOTINO / FLACONI (German/EU stores) ===
  if (upgraded.includes('douglas.') || upgraded.includes('notino.') || upgraded.includes('flaconi.')) {
    upgraded = upgraded.replace(/\/\d+x\d+\//g, '/');
    upgraded = upgraded.replace(/\?.*$/, '');
  }
  
  // === STRAWBERRYNET ===
  if (upgraded.includes('strawberrynet.com')) {
    upgraded = upgraded.replace(/_\d+\./g, '.');
    upgraded = upgraded.replace(/\/thumb\//g, '/large/');
  }
  
  // === GENERIC PATTERNS ===
  // Remove common size suffixes
  upgraded = upgraded.replace(/[-_](small|thumb|thumbnail|xs|sm|md|mini|tiny|preview)\./gi, '.');
  
  // Remove numeric size patterns like _300. or -500.
  upgraded = upgraded.replace(/[-_]\d{2,4}\.(jpg|jpeg|png|webp)/gi, '.$1');
  
  // Remove quality parameters
  upgraded = upgraded.replace(/[?&]q(uality)?=\d+/gi, '');
  upgraded = upgraded.replace(/[?&]w(idth)?=\d+/gi, '');
  upgraded = upgraded.replace(/[?&]h(eight)?=\d+/gi, '');
  
  // Convert webp to png/jpg for potentially higher quality source
  // (Only if the URL structure suggests there's an original)
  if (upgraded.includes('format=webp') || upgraded.includes('fm=webp')) {
    upgraded = upgraded.replace(/format=webp/gi, 'format=png');
    upgraded = upgraded.replace(/fm=webp/gi, 'fm=png');
  }
  
  // Clean up any double slashes (except after protocol)
  upgraded = upgraded.replace(/([^:])\/{2,}/g, '$1/');
  
  // Clean up empty query strings
  upgraded = upgraded.replace(/\?&/g, '?').replace(/\?$/g, '');
  
  return upgraded;
}

// Verify the product page is actually for a fragrance/perfume product
async function verifyFragranceProduct(page: Page): Promise<boolean> {
  try {
    // Get the page title and content to check if it's a fragrance
    const pageContent = await page.evaluate(() => {
      const title = document.title.toLowerCase();
      const h1 = document.querySelector('h1')?.textContent?.toLowerCase() || '';
      const breadcrumb = document.querySelector('[class*="breadcrumb"], .breadcrumbs, nav[aria-label*="breadcrumb"]')?.textContent?.toLowerCase() || '';
      const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute('content')?.toLowerCase() || '';
      const bodyText = document.body.innerText.toLowerCase().slice(0, 5000); // First 5000 chars
      return { title, h1, breadcrumb, metaDesc, bodyText };
    });

    // Fragrance-related keywords
    const fragranceKeywords = [
      'perfume', 'cologne', 'fragrance', 'eau de', 'parfum', 'toilette',
      'scent', 'spray', 'ml', 'oz', 'edp', 'edt', 'body mist', 'aftershave',
      'amouage', 'chanel', 'dior', 'gucci', 'versace', 'armani', 'ysl',
      'tom ford', 'creed', 'jo malone', 'dolce', 'gabbana', 'burberry'
    ];

    // Non-fragrance keywords that indicate wrong product
    const nonFragranceKeywords = [
      'tv', 'television', 'laptop', 'phone', 'computer', 'electronics',
      'furniture', 'clothing', 'shoes', 'appliance', 'kitchen', 'home decor',
      'xiaomi', 'samsung tv', 'lg tv', 'sony tv', 'smart tv', '4k display'
    ];

    // Check for non-fragrance keywords first (these are strong indicators of wrong product)
    const combinedText = `${pageContent.title} ${pageContent.h1} ${pageContent.breadcrumb}`;
    for (const keyword of nonFragranceKeywords) {
      if (combinedText.includes(keyword)) {
        console.log(`  Non-fragrance keyword found: "${keyword}"`);
        return false;
      }
    }

    // Check for fragrance keywords
    for (const keyword of fragranceKeywords) {
      if (combinedText.includes(keyword) || pageContent.metaDesc.includes(keyword)) {
        return true;
      }
    }

    // If no clear indicators, check body text for fragrance terms
    let fragranceScore = 0;
    for (const keyword of fragranceKeywords) {
      if (pageContent.bodyText.includes(keyword)) {
        fragranceScore++;
      }
    }

    // Require at least 2 fragrance keywords in body text
    return fragranceScore >= 2;
  } catch (err) {
    console.log(`  Error verifying fragrance product: ${err}`);
    return true; // Default to true if verification fails
  }
}

// Check if we're on a product page (redirected from search)
async function isProductPage(page: Page): Promise<boolean> {
  const url = page.url();
  const productPatterns = [
    /\/product[s]?\//i,
    /\/p\//i,
    /\/item\//i,
    /\/dp\//i,
    /\.html$/i,
    /\/[a-z-]+-perfume/i,
    /\/[a-z-]+-cologne/i,
    /\/[a-z-]+-eau-de/i,
  ];
  return productPatterns.some(pattern => pattern.test(url));
}

// Scrape a single store for a SKU - OPTIMIZED VERSION
async function scrapeStore(
  page: Page,
  store: StoreConfig,
  sku: string
): Promise<ScrapedImageResult[]> {
  const results: ScrapedImageResult[] = [];
  const searchUrl = buildSearchUrl(store, sku);

  try {
    console.log(`  Navigating to: ${searchUrl}`);
    await page.goto(searchUrl, {
      waitUntil: "networkidle2",
      timeout: 25000,
    });

    await delay(2000);

    // Check if we were redirected to a product page
    const currentUrl = page.url();
    const wasRedirected = currentUrl !== searchUrl && await isProductPage(page);
    
    if (wasRedirected) {
      console.log(`  Redirected to product page: ${currentUrl}`);
    }

    // Check if product was found
    const productFound = await isProductFound(page, store);
    
    if (!productFound && !wasRedirected) {
      // Try to find product links and navigate to first one
      try {
        const productLinks = await page.$$eval(
          store.selectors.productLink,
          (links) => links
            .map((a) => a.getAttribute("href"))
            .filter((href): href is string => !!href)
            .slice(0, 1)
        );

        if (productLinks.length > 0) {
          const productUrl = productLinks[0].startsWith("http")
            ? productLinks[0]
            : `${store.baseUrl}${productLinks[0]}`;
          
          console.log(`  Found product link, navigating to: ${productUrl}`);
          await page.goto(productUrl, {
            waitUntil: "networkidle2",
            timeout: 25000,
          });
          await delay(2000);
        } else {
          console.log(`  No product found for SKU ${sku} on ${store.name} - SKIPPING`);
          return results;
        }
      } catch (err) {
        console.log(`  No product found for SKU ${sku} on ${store.name} - SKIPPING`);
        return results;
      }
    }

    // Verify this is actually a fragrance/perfume product page
    const isFragranceProduct = await verifyFragranceProduct(page);
    if (!isFragranceProduct) {
      console.log(`  Product on ${store.name} is not a fragrance - SKIPPING`);
      return results;
    }

    // Extract product images using all strategies
    const images = await extractAllProductImages(page, store);
    
    if (images.length === 0) {
      console.log(`  No valid product images found on ${store.name}`);
      return results;
    }
    
    for (const imageUrl of images) {
      results.push({
        sku,
        storeName: store.name,
        sourceUrl: page.url(),
        imageUrl,
      });
    }
  } catch (err) {
    console.error(
      `Error scraping ${store.name} for SKU ${sku}:`,
      err instanceof Error ? err.message : err
    );
  }

  return results;
}

// Download image and check dimensions before uploading
async function downloadAndUploadImage(
  imageUrl: string,
  sku: string,
  storeName: string,
  index: number,
  minWidth: number = 500,
  minHeight: number = 500
): Promise<{ s3Key: string; s3Url: string; width: number; height: number } | null> {
  try {
    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
        "Referer": new URL(imageUrl).origin,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    
    // Skip non-image content
    if (!contentType.includes("image")) {
      console.log(`  Skipping non-image content: ${contentType}`);
      return null;
    }
    
    const buffer = Buffer.from(await response.arrayBuffer());
    
    // Skip very small files (likely icons/placeholders) - require at least 15KB for HQ images
    if (buffer.length < 15000) {
      console.log(`  Skipping small file (${buffer.length} bytes): ${imageUrl.substring(0, 50)}...`);
      return null;
    }
    
    // Check image dimensions using sharp for reliable detection
    let dimensions: { width: number; height: number } | null = null;
    try {
      const metadata = await sharp(buffer).metadata();
      if (metadata.width && metadata.height) {
        dimensions = { width: metadata.width, height: metadata.height };
      }
    } catch (sharpErr) {
      // Fallback to simple header check if sharp fails
      dimensions = getImageDimensions(buffer);
    }
    
    if (dimensions) {
      if (dimensions.width < minWidth || dimensions.height < minHeight) {
        console.log(`  Skipping small image (${dimensions.width}x${dimensions.height}): ${imageUrl.substring(0, 60)}...`);
        return null;
      }
    } else {
      // If we can't determine dimensions, skip the image to be safe
      console.log(`  Skipping image with unknown dimensions: ${imageUrl.substring(0, 60)}...`);
      return null;
    }

    // Determine file extension
    let ext = "jpg";
    if (contentType.includes("png")) ext = "png";
    else if (contentType.includes("webp")) ext = "webp";
    else if (contentType.includes("gif")) ext = "gif";

    const safeStoreName = storeName.replace(/[^a-zA-Z0-9]/g, "_");
    const s3Key = `scrapes/${sku}/${safeStoreName}_${index}_${nanoid(6)}.${ext}`;

    const { url } = await storagePut(s3Key, buffer, contentType);
    return { 
      s3Key, 
      s3Url: url, 
      width: dimensions?.width || 0, 
      height: dimensions?.height || 0 
    };
  } catch (err) {
    console.error(
      `Failed to download image ${imageUrl.substring(0, 60)}...:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// Simple image dimension detection from buffer
function getImageDimensions(buffer: Buffer): { width: number; height: number } | null {
  try {
    // PNG
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
      const width = buffer.readUInt32BE(16);
      const height = buffer.readUInt32BE(20);
      return { width, height };
    }
    
    // JPEG
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
      let offset = 2;
      while (offset < buffer.length) {
        if (buffer[offset] !== 0xFF) break;
        const marker = buffer[offset + 1];
        if (marker === 0xC0 || marker === 0xC2) {
          const height = buffer.readUInt16BE(offset + 5);
          const width = buffer.readUInt16BE(offset + 7);
          return { width, height };
        }
        const length = buffer.readUInt16BE(offset + 2);
        offset += 2 + length;
      }
    }
    
    // WebP - support VP8, VP8L, and VP8X (extended) formats
    if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
      const chunkType = buffer.toString('ascii', 12, 16);
      
      if (chunkType === 'VP8 ') {
        // Lossy format
        const width = (buffer.readUInt16LE(26) & 0x3FFF);
        const height = (buffer.readUInt16LE(28) & 0x3FFF);
        return { width, height };
      }
      if (chunkType === 'VP8L') {
        // Lossless format
        const bits = buffer.readUInt32LE(21);
        const width = (bits & 0x3FFF) + 1;
        const height = ((bits >> 14) & 0x3FFF) + 1;
        return { width, height };
      }
      if (chunkType === 'VP8X') {
        // Extended format - dimensions are at offset 24 (3 bytes each)
        const width = (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)) + 1;
        const height = (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)) + 1;
        return { width, height };
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

// Scrape all stores for a single SKU
export async function scrapeSku(sku: string, useProxy: boolean = true): Promise<SkuScrapeResult> {
  const browser = await getBrowser(useProxy);
  const page = await browser.newPage();

  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );
  
  // Set viewport to desktop size
  await page.setViewport({ width: 1920, height: 1080 });

  const allImages: ScrapedImageResult[] = [];
  const errors: string[] = [];

  try {
    // STEP 1: Use Perplexity to find which stores carry this product
    console.log(`[Perplexity] Looking up SKU ${sku}...`);
    let productLookup: ProductLookupResult | null = null;
    let storesToScrape: StoreConfig[] = [];
    
    try {
      productLookup = await lookupProductBySku(sku);
      
      if (productLookup.productName) {
        console.log(`[Perplexity] Found: ${productLookup.productName} by ${productLookup.brand}`);
        console.log(`[Perplexity] Suggested stores: ${productLookup.suggestedStores.map(s => s.name).join(', ')}`);
        console.log(`[Perplexity] Matched scrapers: ${productLookup.matchedStores.join(', ') || 'None'}`);
        
        // DIRECT URL SCRAPING: Scrape the exact product URLs from Perplexity
        if (productLookup.suggestedStores.length > 0) {
          console.log(`[Direct URL] Scraping ${productLookup.suggestedStores.length} direct product URLs from Perplexity...`);
          
          const directUrlResults = await Promise.all(
            productLookup.suggestedStores.slice(0, 5).map(async (store) => {
              try {
                const directPage = await browser.newPage();
                await directPage.setUserAgent(getRandomUserAgent());
                await directPage.setViewport({ width: 1920, height: 1080 });
                
                console.log(`  [${store.name}] Navigating to direct URL: ${store.url}`);
                await directPage.goto(store.url, { waitUntil: "networkidle2", timeout: 25000 });
                await randomDelay(1000, 2000);
                
                // Extract all product images using generic selectors
                const images = await extractAllProductImages(directPage, {
                  name: store.name,
                  baseUrl: store.url,
                  searchUrlTemplate: store.url,
                  selectors: {
                    productFound: "img",
                    noResults: ".no-results, .not-found",
                    productImage: "img[src*='product'], .product-image img, .gallery img, [data-zoom-image]",
                    productLink: "a"
                  },
                  imageConfig: {
                    minWidth: 400,
                    minHeight: 400,
                    highResAttribute: "data-zoom-image",
                    urlPatternFilter: /logo|icon|banner|sprite|thumb|placeholder/i
                  },
                  rateLimit: 1000,
                  notes: "Direct URL scrape",
                  isActive: true
                });
                
                await directPage.close();
                
                if (images.length > 0) {
                  console.log(`  [${store.name}] Found ${images.length} images from direct URL`);
                  return images.map(url => ({
                    sku,
                    storeName: store.name,
                    sourceUrl: store.url,
                    imageUrl: url
                  }));
                }
                return [];
              } catch (err) {
                console.error(`  [${store.name}] Direct URL scrape failed: ${err}`);
                return [];
              }
            })
          );
          
          // Collect direct URL results
          for (const results of directUrlResults) {
            allImages.push(...results);
          }
          console.log(`[Direct URL] Collected ${allImages.length} images from direct URLs`);
        }
        
        // Also use matched scrapers if any
        if (productLookup.matchedStores.length > 0) {
          // Use matched stores PLUS top fragrance stores for better coverage
          const matchedStores = storeConfigs.filter(s => 
            productLookup!.matchedStores.some(matched => 
              matched.toLowerCase() === s.name.toLowerCase()
            )
          );
          
          // Also add top fragrance stores for better coverage
          const TOP_STORES = ["FragranceNet", "Sephora", "Nordstrom", "Notino", "Luckyscent"];
          const topStores = storeConfigs.filter(s => 
            TOP_STORES.some(top => s.name.toLowerCase().includes(top.toLowerCase()))
          );
          
          // Combine and deduplicate
          const allStores = [...matchedStores];
          for (const store of topStores) {
            if (!allStores.some(s => s.name === store.name)) {
              allStores.push(store);
            }
          }
          storesToScrape = allStores;
          console.log(`[Perplexity] Will also scrape ${storesToScrape.length} configured stores`);
        }
      } else {
        console.log(`[Perplexity] Could not identify product for SKU ${sku}`);
      }
    } catch (perplexityErr) {
      console.error(`[Perplexity] Lookup failed: ${perplexityErr}`);
    }
    
    // STEP 2: If no Perplexity matches, use top fragrance stores as fallback
    const TOP_FRAGRANCE_STORES = [
      "FragranceNet", "Jomashop", "Sephora", "Nordstrom", "Ulta Beauty",
      "Notino", "Luckyscent", "Strawberrynet", "Douglas", "Harrods"
    ];
    
    if (storesToScrape.length === 0) {
      console.log(`[Fallback] No Perplexity matches, using top 10 fragrance stores`);
      storesToScrape = storeConfigs.filter(s => 
        TOP_FRAGRANCE_STORES.some(top => 
          s.name.toLowerCase().includes(top.toLowerCase())
        )
      );
    }
    
    // If still no stores (shouldn't happen), use all active stores
    if (storesToScrape.length === 0) {
      console.log(`[Fallback] Using all ${getActiveStores().length} active stores`);
      storesToScrape = getActiveStores();
    }
    
    // PARALLEL SCRAPING: Run stores concurrently using separate pages
    const PARALLEL_LIMIT = 5; // Run 5 stores at a time to avoid overwhelming resources
    
    console.log(`Starting parallel scraping across ${storesToScrape.length} stores (${PARALLEL_LIMIT} concurrent)...`);
    
    // Process stores in batches
    for (let i = 0; i < storesToScrape.length; i += PARALLEL_LIMIT) {
      const batch = storesToScrape.slice(i, i + PARALLEL_LIMIT);
      const batchNum = Math.floor(i / PARALLEL_LIMIT) + 1;
      const totalBatches = Math.ceil(storesToScrape.length / PARALLEL_LIMIT);
      
      console.log(`Batch ${batchNum}/${totalBatches}: ${batch.map(s => s.name).join(', ')}`);
      
      const batchResults = await Promise.all(
        batch.map(async (store) => {
          // Create a new page for each store in the batch
          const storePage = await browser.newPage();
          await storePage.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
          );
          await storePage.setViewport({ width: 1920, height: 1080 });
          
          try {
            console.log(`  [${store.name}] Starting...`);
            const images = await scrapeStore(storePage, store, sku);
            
            if (images.length === 0) {
              console.log(`  [${store.name}] No product found - skipped`);
            } else {
              console.log(`  [${store.name}] Found ${images.length} images`);
            }
            
            return { store: store.name, images, error: null };
          } catch (err) {
            const errorMsg = `${store.name}: ${err instanceof Error ? err.message : "Unknown error"}`;
            console.error(`  [${store.name}] Error: ${err instanceof Error ? err.message : err}`);
            return { store: store.name, images: [], error: errorMsg };
          } finally {
            await storePage.close();
          }
        })
      );
      
      // Collect results from this batch
      for (const result of batchResults) {
        if (result.error) {
          errors.push(result.error);
        }
        allImages.push(...result.images);
      }
    }
    
    console.log(`Parallel scraping complete. Found ${allImages.length} total images.`);

    // Deduplicate by URL first
    const uniqueUrls = new Set<string>();
    const uniqueImages = allImages.filter(img => {
      if (uniqueUrls.has(img.imageUrl)) return false;
      uniqueUrls.add(img.imageUrl);
      return true;
    });
    
    console.log(`Found ${uniqueImages.length} unique images for SKU ${sku}`);
    
    // STEP: Process images through HQ pipeline (filtering + upscaling)
    const imageUrls = uniqueImages.map(img => img.imageUrl);
    const hqResult = await processImagesHQ(
      sku,
      imageUrls,
      productLookup?.productName,
      productLookup?.brand
    );
    
    console.log(`[HQ Pipeline] Processing steps: ${hqResult.processingSteps.join(' → ')}`);
    console.log(`[HQ Pipeline] Result: ${hqResult.images.length} HQ images, cost: $${hqResult.totalCost.toFixed(4)}`);
    
    // Upload HQ processed images to S3
    const uploadedHQ = await uploadHQImages(sku, hqResult.images);
    
    // Map uploaded images back to the result format
    let uploadedCount = 0;
    for (let i = 0; i < uploadedHQ.length && i < uniqueImages.length; i++) {
      const uploaded = uploadedHQ[i];
      if (uploaded && uniqueImages[i]) {
        uniqueImages[i].s3Key = uploaded.s3Key;
        uniqueImages[i].s3Url = uploaded.s3Url;
        uniqueImages[i].width = uploaded.width;
        uniqueImages[i].height = uploaded.height;
        uploadedCount++;
      }
    }
    
    // If HQ pipeline produced more images than we had, add them
    for (let i = uniqueImages.length; i < uploadedHQ.length; i++) {
      const uploaded = uploadedHQ[i];
      if (uploaded) {
        allImages.push({
          sku,
          storeName: 'HQ_Pipeline',
          sourceUrl: hqResult.images[i]?.originalUrl || '',
          imageUrl: hqResult.images[i]?.processedUrl || '',
          s3Key: uploaded.s3Key,
          s3Url: uploaded.s3Url,
          width: uploaded.width,
          height: uploaded.height,
        });
        uploadedCount++;
      }
    }
    
    console.log(`Uploaded ${uploadedCount} HQ images for SKU ${sku}`);
  } finally {
    await page.close();
  }

  const successfulImages = allImages.filter((img) => img.s3Url);
  
  return {
    sku,
    images: successfulImages,
    errors,
    status:
      successfulImages.length > 0
        ? errors.length > 0
          ? "partial"
          : "completed"
        : "failed",
  };
}

// Create zip file from scraped images
export async function createZipFromResults(
  results: SkuScrapeResult[],
  orderId: number
): Promise<{ zipKey: string; zipUrl: string }> {
  console.log(`Creating zip for order ${orderId} with ${results.length} SKU results`);
  
  return new Promise(async (resolve, reject) => {
    const chunks: Buffer[] = [];
    const writableStream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      },
      final(callback) {
        callback();
      }
    });

    const archive = archiver("zip", { zlib: { level: 5 } });
    
    archive.on('error', (err) => {
      console.error(`Archive error: ${err}`);
      reject(err);
    });

    writableStream.on('finish', async () => {
      console.log(`Stream finished, uploading zip to S3...`);
      try {
        const zipBuffer = Buffer.concat(chunks);
        const zipKey = `orders/${orderId}/Photo.1_Output_${nanoid(8)}.zip`;
        const { url } = await storagePut(zipKey, zipBuffer, "application/zip");
        console.log(`Zip uploaded to S3: ${url}`);
        resolve({ zipKey, zipUrl: url });
      } catch (err) {
        console.error(`Failed to upload zip: ${err}`);
        reject(err);
      }
    });

    archive.pipe(writableStream);

    // Add images to zip organized by SKU
    let addedCount = 0;
    for (const result of results) {
      if (result.images.length === 0) {
        console.log(`Skipping SKU ${result.sku} - no images found`);
        continue;
      }
      
      console.log(`Adding ${result.images.length} images for SKU ${result.sku} to zip`);
      for (let i = 0; i < result.images.length; i++) {
        const image = result.images[i];
        if (image.s3Url) {
          try {
            const response = await fetch(image.s3Url);
            if (response.ok) {
              const buffer = Buffer.from(await response.arrayBuffer());
              const ext = image.s3Url.split(".").pop()?.split("?")[0] || "jpg";
              const filename = `${result.sku}/${image.storeName}_${i + 1}.${ext}`;
              archive.append(buffer, { name: filename });
              addedCount++;
            }
          } catch (err) {
            console.error(`Failed to add image to zip: ${err}`);
          }
        }
      }
    }
    console.log(`Added ${addedCount} HQ images to zip, finalizing...`);

    archive.finalize();
  });
}

// Main scrape job function
export async function runScrapeJob(
  orderId: number,
  skus: string[],
  onProgress?: (processed: number, total: number) => void
): Promise<ScrapeJobResult> {
  const results: SkuScrapeResult[] = [];
  let totalImages = 0;
  let processedSkus = 0;
  let failedSkus = 0;

  try {
    for (let i = 0; i < skus.length; i++) {
      const sku = skus[i];
      console.log(`Processing SKU ${i + 1}/${skus.length}: ${sku}`);

      const result = await scrapeSku(sku);
      results.push(result);

      totalImages += result.images.length;
      processedSkus++;
      if (result.status === "failed") {
        failedSkus++;
      }

      if (onProgress) {
        onProgress(i + 1, skus.length);
      }
    }

    // Create zip file
    console.log(`Starting zip creation for order ${orderId}...`);
    let zipKey = "";
    let zipUrl = "";
    try {
      const zipResult = await createZipFromResults(results, orderId);
      zipKey = zipResult.zipKey;
      zipUrl = zipResult.zipUrl;
      console.log(`Zip created successfully: ${zipUrl}`);
    } catch (zipErr) {
      console.error(`Failed to create zip for order ${orderId}:`, zipErr);
    }

    return {
      orderId,
      results,
      zipKey,
      zipUrl,
      totalImages,
      processedSkus,
      failedSkus,
    };
  } finally {
    await closeBrowser();
  }
}

// Parse SKUs from text input (handles various formats)
export function parseSkusFromText(text: string): string[] {
  const parts = text
    .split(/[\n\r,;\t]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const skus: string[] = [];
  for (const part of parts) {
    const matches = part.match(/\d{8,14}/g);
    if (matches) {
      skus.push(...matches);
    }
  }

  return Array.from(new Set(skus));
}
