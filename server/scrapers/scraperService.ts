// Scraper Service - Main scraping orchestration
// Uses Puppeteer with stealth plugin to scrape product images from multiple stores

import puppeteer from "puppeteer";
import type { Browser, Page } from "puppeteer";
import { nanoid } from "nanoid";
import archiver from "archiver";
import { Writable } from "stream";
import sharp from "sharp";

import { storagePut } from "../storage";
import { storeConfigs, getActiveStores, type StoreConfig } from "./storeConfigs";
import { getProxyForPuppeteer } from "./asocksProxy";
import { lookupProductBySku, type ProductLookupResult } from "./perplexityLookup";
import { processImagesHQ, uploadHQImages } from "./hqImagePipeline";

// Using plain puppeteer for reliability (puppeteer-extra had proxy caching issues)

// Types
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
  zipKey: string;
  zipUrl: string;
  totalImages: number;
  processedSkus: number;
  failedSkus: number;
}

// Browser instance management - create fresh browser for each job
let browserInstance: Browser | null = null;

async function getBrowser(useProxy: boolean = false): Promise<Browser> {
  // Always close existing browser and create fresh one
  if (browserInstance) {
    try {
      if (browserInstance.connected) {
        await browserInstance.close();
      }
    } catch (e) {
      // Ignore close errors
    }
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

  // Proxy disabled - direct connections work better for fragrance sites

  // Use plain puppeteer for reliability
  browserInstance = await puppeteer.launch({
    headless: true,
    args: launchArgs,
  });
  console.log(`[Browser] Launched new browser instance (proxy: disabled)`);
  
  return browserInstance;
}

async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch (e) {
      // Ignore close errors
    }
    browserInstance = null;
  }
}

// Delay helper
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Random delay to appear more human-like
function randomDelay(min: number, max: number): Promise<void> {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return delay(ms);
}

// User agent rotation
const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
];

function getRandomUserAgent(): string {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// ============================================================================
// MAIN PRODUCT IMAGE EXTRACTION - Comprehensive filtering to avoid wrong images
// ============================================================================

// CSS selectors for sections that contain OTHER products (not the main product)
const EXCLUDE_SECTION_SELECTORS = [
  // Similar/Related products
  '.similar-items', '.similar-products', '.similar', '.similars',
  '.recommended', '.recommendations', '.recommend',
  '.related-products', '.related-items', '.related',
  '.also-like', '.you-may-like', '.you-might-like', '.may-also-like',
  '.people-also', '.customers-also', '.others-bought', '.others-viewed',
  '.frequently-bought', '.bought-together', '.complete-the-look',
  '.pair-it-with', '.pair-with', '.goes-well-with', '.style-with',
  '.recently-viewed', '.recently-browsed', '.browsing-history',
  '.cross-sell', '.upsell', '.up-sell', '.cross-sells',
  // Generic product grids/carousels (usually recommendations)
  '.product-grid', '.products-grid', '.product-list',
  '.product-carousel', '.products-carousel', '.carousel-section',
  '.product-slider', '.products-slider',
  // Attribute-based selectors
  '[class*="similar"]', '[class*="recommend"]', '[class*="related"]',
  '[class*="also-like"]', '[class*="you-may"]', '[class*="you-might"]',
  '[class*="recently"]', '[class*="cross-sell"]', '[class*="upsell"]',
  '[id*="similar"]', '[id*="recommend"]', '[id*="related"]',
  '[id*="also-like"]', '[id*="recently"]',
  '[data-section*="recommend"]', '[data-section*="similar"]',
  '[data-component*="recommend"]', '[data-component*="similar"]',
  // Page structure elements
  'footer', 'nav', 'header', 'aside',
  '.footer', '.header', '.navigation', '.sidebar',
  // Review/rating sections (often have user-uploaded images)
  '.reviews', '.review-section', '.customer-reviews',
  '.ratings', '.testimonials',
  // Marketing/promo sections
  '.promo', '.promotion', '.banner', '.banners',
  '.marketing', '.advertisement', '.ad-section',
];

// URL patterns that indicate NON-product images
const EXCLUDE_URL_PATTERNS = [
  // UI elements
  'logo', 'icon', 'sprite', 'button', 'arrow', 'chevron',
  'close', 'search', 'menu', 'nav', 'header', 'footer',
  // Thumbnails and small images
  'thumb', 'thumbnail', '_xs', '_sm', '_tiny', 'mini',
  'w=50', 'w=100', 'w=150', 'h=50', 'h=100', 'h=150',
  '50x50', '100x100', '150x150',
  // Placeholders and loading
  'placeholder', 'loading', 'lazy', 'blank', 'empty',
  'no-image', 'coming-soon', 'out-of-stock', 'sold-out',
  // Payment/trust icons
  'payment', 'visa', 'mastercard', 'paypal', 'amex', 'klarna', 'tabby',
  'trust', 'secure', 'ssl', 'certificate', 'badge', 'verified',
  // Social media
  'social', 'facebook', 'twitter', 'instagram', 'tiktok', 'youtube', 'pinterest',
  // Tracking/analytics
  'pixel', 'tracking', '1x1', 'spacer', 'beacon',
  // Rating/review
  'star', 'rating', 'review',
  // Shipping/delivery
  'shipping', 'delivery', 'return', 'guarantee',
  // Avatar/profile
  'avatar', 'profile', 'user',
];

// Main product area selectors (prioritize images from these areas)
const MAIN_PRODUCT_SELECTORS = [
  // Primary product image containers
  '.product-image', '.product-gallery', '.product-media', '.pdp-image',
  '.main-image', '.primary-image', '.hero-image', '.featured-image',
  '#main-image', '#product-image', '#primary-image',
  '[data-component="product-image"]', '[data-component="gallery"]',
  // Gallery/slider containers
  '.gallery-image', '.zoom-image', '.magnify-image',
  '.woocommerce-product-gallery__image', '.fotorama__stage__frame',
  '.slick-slide:not(.slick-cloned)', '.swiper-slide', '.carousel-item',
  // Product detail page containers
  '.pdp-gallery', '.pdp-images', '.product-detail-images',
  '.product-images-container', '.product-gallery-container',
];

// Extract all product images from a page using multiple strategies
async function extractAllProductImages(page: Page, store: StoreConfig): Promise<string[]> {
  const allUrls: string[] = [];
  
  // Strategy 1: Use store-specific selector (highest priority)
  try {
    const storeImages = await page.$$eval(
      store.selectors.productImage,
      (elements, config) => {
        const { highResAttr, excludeSelectors } = config;
        return elements
          .filter(el => {
            // Exclude if inside a recommendation section
            for (const selector of excludeSelectors) {
              if (el.closest(selector)) return false;
            }
            return true;
          })
          .map(el => {
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
          })
          .filter(url => url && (url.startsWith('http') || url.startsWith('//')));
      },
      { highResAttr: store.imageConfig.highResAttribute, excludeSelectors: EXCLUDE_SECTION_SELECTORS }
    );
    allUrls.push(...storeImages);
    console.log(`  Store selector found ${storeImages.length} images`);
  } catch (err) {
    console.log(`  Store selector failed: ${err}`);
  }
  
  // Strategy 2: Main product area selectors (high priority)
  for (const selector of MAIN_PRODUCT_SELECTORS) {
    try {
      const images = await page.$$eval(
        `${selector} img, ${selector}[src], ${selector}[data-src]`,
        (elements, excludeSelectors) => {
          return elements
            .filter(el => {
              for (const selector of excludeSelectors) {
                if (el.closest(selector)) return false;
              }
              return true;
            })
            .map(el => {
              let url = el.getAttribute('data-zoom-image') || '';
              if (!url) url = el.getAttribute('data-large_image') || '';
              if (!url) url = el.getAttribute('data-full-image') || '';
              if (!url) url = el.getAttribute('data-original') || '';
              if (!url) url = el.getAttribute('data-src') || '';
              if (!url) url = el.getAttribute('src') || '';
              return url;
            })
            .filter(url => url && (url.startsWith('http') || url.startsWith('//')));
        },
        EXCLUDE_SECTION_SELECTORS
      );
      if (images.length > 0) allUrls.push(...images);
    } catch { /* Selector not found */ }
  }
  
  // Strategy 3: High-res attribute selectors
  const highResSelectors = [
    '[data-zoom-image]', '[data-large_image]', '[data-full-image]', 
    '[data-original]', '[data-high-res]', '[data-hires]',
    'picture source[srcset]', 'picture img',
  ];
  
  for (const selector of highResSelectors) {
    try {
      const images = await page.$$eval(
        selector,
        (elements, excludeSelectors) => {
          return elements
            .filter(el => {
              for (const selector of excludeSelectors) {
                if (el.closest(selector)) return false;
              }
              // Position check - must be in top portion of page
              const rect = el.getBoundingClientRect();
              const scrollY = window.scrollY || window.pageYOffset;
              const absoluteTop = rect.top + scrollY;
              if (absoluteTop > 1200) return false;
              return true;
            })
            .map(el => {
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
              if (!url) url = el.getAttribute('data-high-res') || '';
              if (!url) url = el.getAttribute('data-hires') || '';
              if (!url) url = el.getAttribute('data-src') || '';
              if (!url) url = el.getAttribute('src') || '';
              return url;
            })
            .filter(url => url && (url.startsWith('http') || url.startsWith('//')));
        },
        EXCLUDE_SECTION_SELECTORS
      );
      if (images.length > 0) allUrls.push(...images);
    } catch { /* Selector not found */ }
  }
  
  // Strategy 4: Find large images in main product area ONLY (fallback)
  try {
    const largeImages = await page.evaluate((excludeSelectors) => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return imgs
        .filter(img => {
          // CRITICAL: Exclude if inside a recommendation section
          for (const selector of excludeSelectors) {
            if (img.closest(selector)) {
              return false;
            }
          }
          
          // Position check - ONLY include images in top 1200px (main product area)
          const rect = img.getBoundingClientRect();
          const scrollY = window.scrollY || window.pageYOffset;
          const absoluteTop = rect.top + scrollY;
          if (absoluteTop > 1200) {
            return false;
          }
          
          // Size check - must be reasonably large
          const width = img.naturalWidth || parseInt(img.getAttribute('width') || '0', 10);
          const height = img.naturalHeight || parseInt(img.getAttribute('height') || '0', 10);
          if (width < 250 && height < 250) return false;
          if (rect.width < 200 && rect.height < 200) return false;
          
          // Aspect ratio check - perfume bottles are usually portrait or square
          const aspectRatio = width / height;
          if (aspectRatio > 3 || aspectRatio < 0.3) return false; // Too wide or too tall = banner
          
          return true;
        })
        .map(img => {
          let url = img.getAttribute('data-zoom-image') || '';
          if (!url) url = img.getAttribute('data-large_image') || '';
          if (!url) url = img.getAttribute('data-full-image') || '';
          if (!url) url = img.getAttribute('data-src') || '';
          if (!url) url = img.src || '';
          return url;
        })
        .filter(url => url && (url.startsWith('http') || url.startsWith('//')));
    }, EXCLUDE_SECTION_SELECTORS);
    allUrls.push(...largeImages);
  } catch { /* Evaluation failed */ }
  
  // Deduplicate
  const uniqueUrls = Array.from(new Set(allUrls));
  
  // Filter by URL patterns
  const filteredUrls = uniqueUrls.filter(url => {
    const lowerUrl = url.toLowerCase();
    
    // Store-specific filter
    if (store.imageConfig.urlPatternFilter && store.imageConfig.urlPatternFilter.test(lowerUrl)) {
      return false;
    }
    
    // Global exclusion patterns
    for (const pattern of EXCLUDE_URL_PATTERNS) {
      if (lowerUrl.includes(pattern)) {
        return false;
      }
    }
    
    return true;
  });
  
  // Limit to top 5 images per store
  const limitedUrls = filteredUrls.slice(0, 5);
  console.log(`  Total unique product images found: ${filteredUrls.length}`);
  
  return limitedUrls;
}

// Scrape a single store
async function scrapeStore(
  page: Page,
  store: StoreConfig,
  sku: string
): Promise<ScrapedImageResult[]> {
  const searchUrl = store.searchUrlTemplate.replace("{sku}", sku);
  console.log(`  Navigating to: ${searchUrl}`);

  try {
    await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: 25000 });
    await randomDelay(1000, 2000);

    // Check for no results
    const noResults = await page.$(store.selectors.noResults);
    if (noResults) {
      console.log(`  No product found for SKU ${sku} on ${store.name} - SKIPPING`);
      return [];
    }

    // Check if we found a product
    const productFound = await page.$(store.selectors.productFound);
    if (!productFound) {
      console.log(`  No product found for SKU ${sku} on ${store.name} - SKIPPING`);
      return [];
    }

    // Check if we need to navigate to product page
    const productLink = await page.$(store.selectors.productLink);
    if (productLink) {
      const href = await productLink.evaluate((el) => el.getAttribute("href"));
      if (href && !href.includes("search")) {
        const productUrl = href.startsWith("http")
          ? href
          : new URL(href, store.baseUrl).href;
        console.log(`  Found product link, navigating to: ${productUrl}`);
        await page.goto(productUrl, { waitUntil: "networkidle2", timeout: 25000 });
        await randomDelay(500, 1000);
        
        // Check if this is actually a fragrance product (for stores that sell multiple categories)
        const pageUrl = page.url();
        const pageTitle = await page.title();
        const isFragrance = 
          pageUrl.toLowerCase().includes('fragrance') ||
          pageUrl.toLowerCase().includes('perfume') ||
          pageUrl.toLowerCase().includes('cologne') ||
          pageUrl.toLowerCase().includes('eau-de') ||
          pageTitle.toLowerCase().includes('fragrance') ||
          pageTitle.toLowerCase().includes('perfume') ||
          pageTitle.toLowerCase().includes('cologne') ||
          pageTitle.toLowerCase().includes('eau de');
        
        // Also check if redirected to a non-product page
        if (pageUrl.includes('invitation') || pageUrl.includes('closed') || pageUrl.includes('unavailable')) {
          console.log(`  Redirected to product page: ${pageUrl}`);
          console.log(`  Product on ${store.name} is not a fragrance - SKIPPING`);
          return [];
        }
      }
    }

    // Extract images
    const imageUrls = await extractAllProductImages(page, store);

    return imageUrls.map((imageUrl) => ({
      sku,
      storeName: store.name,
      sourceUrl: page.url(),
      imageUrl: imageUrl.startsWith("//") ? `https:${imageUrl}` : imageUrl,
    }));
  } catch (err) {
    console.error(`Error scraping ${store.name} for SKU ${sku}: ${err}`);
    return [];
  }
}

// Download and upload image to S3
async function downloadAndUploadImage(
  imageUrl: string,
  sku: string,
  storeName: string,
  index: number,
  minWidth: number = 400,
  minHeight: number = 400
): Promise<{ s3Key: string; s3Url: string; width: number; height: number } | null> {
  try {
    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent": getRandomUserAgent(),
        "Accept": "image/webp,image/apng,image/*,*/*;q=0.8",
        "Referer": new URL(imageUrl).origin,
      },
    });

    if (!response.ok) {
      console.log(`  Failed to download image (${response.status}): ${imageUrl.substring(0, 60)}...`);
      return null;
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    if (!contentType.startsWith("image/")) {
      console.log(`  Not an image (${contentType}): ${imageUrl.substring(0, 60)}...`);
      return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    
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
export async function scrapeSku(sku: string, useProxy: boolean = false): Promise<SkuScrapeResult> {
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
