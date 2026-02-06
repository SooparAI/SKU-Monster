// Scraper Service for SKU Image Scraper
// Uses Puppeteer to scrape product images from multiple stores - FULLY PROGRAMMATIC (no AI)

import puppeteer from "puppeteer";
import type { Browser, Page } from "puppeteer";
import { nanoid } from "nanoid";
import archiver from "archiver";
import { Writable } from "stream";
import sharp from "sharp";
import { exec } from "child_process";
import { promisify } from "util";

import { storagePut } from "../storage";
import { storeConfigs, getActiveStores, type StoreConfig } from "./storeConfigs";
import { processImagesHQ, uploadHQImages } from "./hqImagePipeline";

const execAsync = promisify(exec);

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

// Constants for resource management
const JOB_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max per SKU
const PAGE_TIMEOUT_MS = 20000; // 20 seconds per page navigation
const PARALLEL_LIMIT = 8; // Run 8 stores at a time

// Browser instance management
let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
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

  browserInstance = await puppeteer.launch({
    headless: true,
    args: launchArgs,
  });
  
  console.log(`[Browser] Launched new browser instance`);
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

// Kill orphaned Chrome processes (safety net)
async function cleanupOrphanedProcesses(): Promise<void> {
  try {
    await execAsync('pkill -9 -f "puppeteer.*chrome" 2>/dev/null || true');
    await execAsync('rm -rf /tmp/puppeteer_* 2>/dev/null || true');
    console.log('[Cleanup] Cleaned up orphaned processes and temp dirs');
  } catch (e) {
    // Ignore errors
  }
}

// Timeout wrapper
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Operation '${operation}' timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    
    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
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

// CSS selectors to EXCLUDE (recommendation sections, similar items, etc.)
const EXCLUSION_SELECTORS = [
  // Recommendation sections
  '[class*="similar"]', '[class*="recommend"]', '[class*="related"]',
  '[class*="also-like"]', '[class*="you-may"]', '[class*="recently"]',
  '[class*="cross-sell"]', '[class*="upsell"]', '[class*="suggestion"]',
  '[id*="similar"]', '[id*="recommend"]', '[id*="related"]',
  // Footer/header areas
  'footer', 'header', 'nav', '[role="navigation"]',
  // Carousels and sliders (often contain other products)
  '[class*="carousel"]', '[class*="slider"]', '[class*="swiper"]',
  // Reviews and ratings
  '[class*="review"]', '[class*="rating"]',
];

// Main product area selectors (prioritized)
const MAIN_PRODUCT_SELECTORS = [
  '[class*="product-gallery"]', '[class*="product-image"]', '[class*="pdp-image"]',
  '[class*="main-image"]', '[class*="hero-image"]', '[class*="primary-image"]',
  '[data-testid*="product-image"]', '[data-testid*="gallery"]',
  '.product-detail img', '.product-main img', '#product-image',
  '[class*="zoom"]', '[data-zoom-image]',
];

// Extract product images from a page - PROGRAMMATIC ONLY
async function extractProductImages(page: Page, store: StoreConfig): Promise<string[]> {
  const images: string[] = [];
  
  try {
    // Get all images with their positions and attributes - inline all logic to avoid __name issues
    const imageData = await page.evaluate(() => {
      const results: Array<{
        src: string;
        width: number;
        height: number;
        naturalWidth: number;
        naturalHeight: number;
        top: number;
        dataSrc?: string;
        dataZoom?: string;
        srcset?: string;
        parentClasses: string;
      }> = [];
      
      // Get all images
      const imgs = Array.from(document.querySelectorAll('img'));
      for (const img of imgs) {
        const rect = img.getBoundingClientRect();
        const src = img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
        
        if (!src || src.startsWith('data:')) continue;
        
        // Collect parent classes for filtering
        let parentClasses = '';
        let current: Element | null = img;
        for (let i = 0; i < 5 && current; i++) {
          parentClasses += ' ' + (current.className || '');
          current = current.parentElement;
        }
        
        results.push({
          src,
          width: rect.width,
          height: rect.height,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          top: rect.top + window.scrollY,
          dataSrc: img.getAttribute('data-src') || undefined,
          dataZoom: img.getAttribute('data-zoom-image') || img.getAttribute('data-large') || undefined,
          srcset: img.getAttribute('srcset') || undefined,
          parentClasses: parentClasses.toLowerCase(),
        });
      }
      
      return results;
    });
    
    // Exclusion patterns for parent classes
    const excludedClassPatterns = ['similar', 'recommend', 'related', 'carousel', 'slider', 'footer', 'header', 'nav', 'review', 'rating'];
    const mainAreaClassPatterns = ['product', 'gallery', 'main', 'hero', 'primary', 'pdp', 'zoom'];
    
    // Filter and score images
    const validImages = imageData
      .filter(img => {
        // Exclude images in recommendation sections (check parent classes)
        for (const pattern of excludedClassPatterns) {
          if (img.parentClasses.includes(pattern)) return false;
        }
        
        // Only images in top 1200px of page (main product area)
        if (img.top > 1200) return false;
        
        // Minimum size requirements
        const width = img.naturalWidth || img.width;
        const height = img.naturalHeight || img.height;
        if (width < 300 || height < 300) return false;
        
        // Filter out non-product URLs
        const url = img.src.toLowerCase();
        const excludePatterns = [
          'logo', 'icon', 'sprite', 'button', 'arrow', 'chevron',
          'thumb', 'thumbnail', '_xs', '_sm', '_tiny', 'mini',
          'placeholder', 'loading', 'lazy', 'blank', 'empty',
          'payment', 'visa', 'mastercard', 'paypal', 'badge',
          'social', 'facebook', 'twitter', 'instagram',
          'pixel', 'tracking', '1x1', 'spacer', 'beacon',
          'star', 'rating', 'review', 'avatar', 'profile',
          'banner', 'promo', 'ad-', 'cart', 'checkout',
          'similar', 'recommend', 'related',
        ];
        
        for (const pattern of excludePatterns) {
          if (url.includes(pattern)) return false;
        }
        
        return true;
      })
      .sort((a, b) => {
        // Check if in main product area (by parent classes)
        const aInMain = mainAreaClassPatterns.some(p => a.parentClasses.includes(p));
        const bInMain = mainAreaClassPatterns.some(p => b.parentClasses.includes(p));
        
        // Prioritize main product area images
        if (aInMain && !bInMain) return -1;
        if (!aInMain && bInMain) return 1;
        
        // Then by size (larger is better)
        const sizeA = (a.naturalWidth || a.width) * (a.naturalHeight || a.height);
        const sizeB = (b.naturalWidth || b.width) * (b.naturalHeight || b.height);
        return sizeB - sizeA;
      });
    
    // Get best URLs (prefer high-res versions)
    for (const img of validImages.slice(0, 5)) {
      // Try to get highest resolution version
      let bestUrl = img.dataZoom || img.src;
      
      // Parse srcset for highest resolution
      if (img.srcset) {
        const srcsetParts = img.srcset.split(',').map(s => s.trim());
        let maxWidth = 0;
        for (const part of srcsetParts) {
          const match = part.match(/(\S+)\s+(\d+)w/);
          if (match && parseInt(match[2]) > maxWidth) {
            maxWidth = parseInt(match[2]);
            bestUrl = match[1];
          }
        }
      }
      
      // Clean up URL
      if (bestUrl && !bestUrl.startsWith('data:')) {
        // Make absolute URL
        if (bestUrl.startsWith('//')) {
          bestUrl = 'https:' + bestUrl;
        } else if (bestUrl.startsWith('/')) {
          const baseUrl = new URL(store.baseUrl);
          bestUrl = baseUrl.origin + bestUrl;
        }
        
        if (!images.includes(bestUrl)) {
          images.push(bestUrl);
        }
      }
    }
    
    console.log(`  Store selector found ${images.length} images`);
  } catch (err) {
    console.error(`  Error extracting images: ${err}`);
  }
  
  return images;
}

// Scrape a single store for a SKU - PROGRAMMATIC with SKU verification
async function scrapeStore(page: Page, store: StoreConfig, sku: string): Promise<ScrapedImageResult[]> {
  const results: ScrapedImageResult[] = [];
  
  try {
    // Build search URL
    const searchUrl = store.searchUrlTemplate.replace("{sku}", sku);
    console.log(`  Navigating to: ${searchUrl}`);
    
    // Navigate with timeout
    await withTimeout(
      page.goto(searchUrl, { waitUntil: "networkidle2", timeout: PAGE_TIMEOUT_MS }),
      PAGE_TIMEOUT_MS + 5000,
      `Navigate to ${store.name}`
    );
    
    await randomDelay(500, 1000);
    
    // Check if product was found
    const noResults = await page.$(store.selectors.noResults);
    if (noResults) {
      console.log(`  No product found for SKU ${sku} on ${store.name} - SKIPPING`);
      return [];
    }
    
    // CRITICAL: Verify the SKU appears on the page to avoid wrong products
    const pageContent = await page.evaluate(() => {
      // Get page text content
      const body = document.body.innerText || '';
      const title = document.title || '';
      // Also check meta tags and data attributes
      const meta = Array.from(document.querySelectorAll('meta')).map(m => m.getAttribute('content') || '').join(' ');
      return (body + ' ' + title + ' ' + meta).toLowerCase();
    });
    
    // Check if SKU appears on the page (exact match or with common separators)
    const skuPatterns = [
      sku,
      sku.replace(/(\d{3})(\d{3})(\d+)/, '$1-$2-$3'), // 701-666-410164
      sku.replace(/(\d{3})(\d{3})(\d{3})(\d+)/, '$1$2$3$4'), // variations
    ];
    
    const skuFound = skuPatterns.some(pattern => pageContent.includes(pattern.toLowerCase()));
    
    if (!skuFound) {
      // SKU not found on page - this is likely a wrong product or generic search results
      console.log(`  SKU ${sku} NOT FOUND on page - likely wrong product, SKIPPING`);
      return [];
    }
    
    console.log(`  SKU ${sku} VERIFIED on page - extracting images`);
    
    // Try to find and click on product link if we're on search results
    const productLink = await page.$(store.selectors.productLink);
    if (productLink) {
      const href = await productLink.evaluate(el => el.getAttribute('href'));
      if (href && !href.includes(sku)) {
        // We're on search results, click through to product
        try {
          await productLink.click();
          await page.waitForNavigation({ waitUntil: "networkidle2", timeout: PAGE_TIMEOUT_MS });
          await randomDelay(500, 1000);
          
          // Re-verify SKU after navigation
          const newContent = await page.evaluate(() => document.body.innerText.toLowerCase());
          if (!skuPatterns.some(p => newContent.includes(p.toLowerCase()))) {
            console.log(`  SKU ${sku} NOT FOUND after navigation - SKIPPING`);
            return [];
          }
        } catch {
          // Navigation might not happen if already on product page
        }
      }
    }
    
    // Extract images
    const imageUrls = await extractProductImages(page, store);
    
    // Convert to results
    for (const url of imageUrls) {
      results.push({
        sku,
        storeName: store.name,
        sourceUrl: page.url(),
        imageUrl: url,
      });
    }
    
    console.log(`  Total unique product images found: ${results.length}`);
  } catch (err) {
    if (err instanceof Error && err.message.includes('timed out')) {
      console.error(`  ${store.name} timed out - skipping`);
    } else {
      console.error(`Error scraping ${store.name} for SKU ${sku}: ${err}`);
    }
  }
  
  return results;
}

import { lookupUpc, extractProductKeywords } from "./upcLookup";

// Scrape all stores for a single SKU - FULLY PROGRAMMATIC (no AI)
export async function scrapeSku(sku: string): Promise<SkuScrapeResult> {
  const startTime = Date.now();
  
  const allImages: ScrapedImageResult[] = [];
  const errors: string[] = [];
  
  // STEP 1: Try UPC database lookup first (fast, reliable, no scraping needed)
  console.log(`[UPC Lookup] Checking UPC database for SKU ${sku}...`);
  const upcResult = await lookupUpc(sku);
  
  let productKeywords: string[] = [];
  
  if (upcResult.found) {
    console.log(`[UPC Lookup] Found product: ${upcResult.productName}`);
    productKeywords = extractProductKeywords(upcResult.productName, upcResult.brand);
    console.log(`[UPC Lookup] Keywords for verification: ${productKeywords.join(', ')}`);
    
    // Use images from UPC database directly
    if (upcResult.images.length > 0) {
      console.log(`[UPC Lookup] Using ${upcResult.images.length} images from UPC database`);
      for (const imageUrl of upcResult.images) {
        allImages.push({
          sku,
          storeName: "UPC Database",
          sourceUrl: "upcitemdb.com",
          imageUrl,
        });
      }
    }
  } else {
    console.log(`[UPC Lookup] Product not found in UPC database, will scrape stores`);
  }
  
  // STEP 2: If we have enough images from UPC database, skip store scraping
  const needStoreScraping = allImages.length < 3;
  
  if (!needStoreScraping) {
    console.log(`[UPC Lookup] Got ${allImages.length} images from UPC database, skipping store scraping`);
  }
  
  const browser = needStoreScraping ? await getBrowser() : null;
  
  try {
    if (needStoreScraping && browser) {
      // STEP 3: Scrape stores for additional images
      const storesToScrape = getActiveStores();
      console.log(`[Programmatic] Scraping ${storesToScrape.length} stores for SKU ${sku}...`);
    
      // Process stores in parallel batches
    for (let i = 0; i < storesToScrape.length; i += PARALLEL_LIMIT) {
      // Check timeout
      if (Date.now() - startTime > JOB_TIMEOUT_MS) {
        console.log(`[Timeout] SKU ${sku} exceeded ${JOB_TIMEOUT_MS / 1000}s limit, stopping`);
        errors.push(`Timeout after ${Math.floor((Date.now() - startTime) / 1000)}s`);
        break;
      }
      
      const batch = storesToScrape.slice(i, i + PARALLEL_LIMIT);
      const batchNum = Math.floor(i / PARALLEL_LIMIT) + 1;
      const totalBatches = Math.ceil(storesToScrape.length / PARALLEL_LIMIT);
      
      console.log(`Batch ${batchNum}/${totalBatches}: ${batch.map(s => s.name).join(', ')}`);
      
      const batchResults = await Promise.all(
        batch.map(async (store) => {
          const storePage = await browser.newPage();
          await storePage.setUserAgent(getRandomUserAgent());
          await storePage.setViewport({ width: 1920, height: 1080 });
          
          try {
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
            try {
              await storePage.close();
            } catch { /* ignore */ }
          }
        })
      );
      
      // Collect results
      for (const result of batchResults) {
        if (result.error) {
          errors.push(result.error);
        }
        allImages.push(...result.images);
      }
      
      // Early exit if we have enough images
      if (allImages.length >= 20) {
        console.log(`[Early Exit] Found ${allImages.length} images, stopping early`);
        break;
      }
    }
    
    console.log(`Scraping complete. Found ${allImages.length} total images in ${Math.floor((Date.now() - startTime) / 1000)}s`);
    } // End of if (needStoreScraping && browser)

    // Deduplicate by URL
    const uniqueUrls = new Set<string>();
    const uniqueImages = allImages.filter(img => {
      if (uniqueUrls.has(img.imageUrl)) return false;
      uniqueUrls.add(img.imageUrl);
      return true;
    });
    
    console.log(`Found ${uniqueImages.length} unique images for SKU ${sku}`);
    
    // Process through HQ pipeline (upscaling)
    const imageUrls = uniqueImages.map(img => img.imageUrl);
    const hqResult = await processImagesHQ(sku, imageUrls);
    
    console.log(`[HQ Pipeline] Processing steps: ${hqResult.processingSteps.join(' → ')}`);
    console.log(`[HQ Pipeline] Result: ${hqResult.images.length} HQ images, cost: $${hqResult.totalCost.toFixed(4)}`);
    
    // Upload HQ images to S3
    const uploadedHQ = await uploadHQImages(sku, hqResult.images);
    
    // Map uploaded images back
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
    
    // Add extra HQ images if pipeline produced more
    for (let i = uniqueImages.length; i < uploadedHQ.length; i++) {
      const uploaded = uploadedHQ[i];
      if (uploaded) {
        uniqueImages.push({
          sku,
          storeName: "HQ Pipeline",
          sourceUrl: "",
          imageUrl: uploaded.s3Url,
          s3Key: uploaded.s3Key,
          s3Url: uploaded.s3Url,
          width: uploaded.width,
          height: uploaded.height,
        });
        uploadedCount++;
      }
    }
    
    console.log(`Uploaded ${uploadedCount} HQ images for SKU ${sku}`);
    
    // Filter to only images with S3 URLs
    const finalImages = uniqueImages.filter(img => img.s3Url);
    
    return {
      sku,
      images: finalImages,
      errors,
      status: finalImages.length > 0 ? "completed" : errors.length > 0 ? "partial" : "failed",
    };
  } finally {
    await closeBrowser();
  }
}

// Create zip from results
async function createZipFromResults(
  results: SkuScrapeResult[],
  orderId: number
): Promise<{ zipKey: string; zipUrl: string }> {
  return new Promise(async (resolve, reject) => {
    const chunks: Buffer[] = [];
    const writableStream = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(chunk);
        callback();
      },
    });

    const archive = archiver("zip", { zlib: { level: 9 } });

    archive.on("error", reject);
    archive.on("end", async () => {
      const zipBuffer = Buffer.concat(chunks);
      const zipKey = `orders/${orderId}/Photo.1_Output_${nanoid(8)}.zip`;
      
      try {
        const { url } = await storagePut(zipKey, zipBuffer, "application/zip");
        resolve({ zipKey, zipUrl: url });
      } catch (err) {
        reject(err);
      }
    });

    archive.pipe(writableStream);

    // Add HQ images to zip
    let addedCount = 0;
    for (const result of results) {
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

// Main scrape job function with timeout enforcement
export async function runScrapeJob(
  orderId: number,
  skus: string[],
  onProgress?: (processed: number, total: number) => void
): Promise<ScrapeJobResult> {
  const results: SkuScrapeResult[] = [];
  let totalImages = 0;
  let processedSkus = 0;
  let failedSkus = 0;

  console.log(`Starting scrape job ${orderId} with ${skus.length} SKUs`);

  try {
    for (let i = 0; i < skus.length; i++) {
      const sku = skus[i];
      console.log(`Processing SKU ${i + 1}/${skus.length}: ${sku}`);

      try {
        const result = await withTimeout(
          scrapeSku(sku),
          JOB_TIMEOUT_MS,
          `Scrape SKU ${sku}`
        );
        results.push(result);
        totalImages += result.images.length;
        processedSkus++;
        if (result.status === "failed") {
          failedSkus++;
        }
      } catch (err) {
        console.error(`SKU ${sku} failed: ${err}`);
        results.push({
          sku,
          images: [],
          errors: [err instanceof Error ? err.message : "Unknown error"],
          status: "failed",
        });
        failedSkus++;
        processedSkus++;
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
    // Always cleanup
    await closeBrowser();
    await cleanupOrphanedProcesses();
    console.log(`Scrape job ${orderId} complete. Cleaned up resources.`);
  }
}

// Parse SKUs from text input
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
