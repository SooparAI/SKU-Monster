// Scraper Service - PRODUCTION-READY
// Uses UPC database first, then Perplexity image search, then browser as last resort
// All image sources work without Chrome - browser is purely optional

import type { Browser, Page } from "puppeteer";
import { nanoid } from "nanoid";
import archiver from "archiver";
import { Writable } from "stream";
import { exec } from "child_process";
import { promisify } from "util";

import { storagePut } from "../storage";
import { storeConfigs, getActiveStores, type StoreConfig } from "./storeConfigs";
import { processImagesHQ, uploadHQImages } from "./hqImagePipeline";
import { lookupUpc, extractProductKeywords } from "./upcLookup";
import { searchProductImages, searchEbayImages, searchRetailerImages } from "./imageSearch";

const execAsync = promisify(exec);

// Lazy-load puppeteer to avoid crashes when Chrome is not installed
let puppeteerModule: any = null;
let puppeteerLoaded = false;

async function getPuppeteer(): Promise<any> {
  if (puppeteerLoaded) return puppeteerModule;
  puppeteerLoaded = true;
  try {
    const mod = await import("puppeteer");
    puppeteerModule = mod.default || mod;
    console.log("[Puppeteer] Module loaded successfully");
  } catch (e) {
    console.warn("[Puppeteer] Module not available:", e);
    puppeteerModule = null;
  }
  return puppeteerModule;
}

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

// ===== OPTIMIZED CONSTANTS =====
const SKU_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes to accommodate parallel AI image generation
const PAGE_TIMEOUT_MS = 10000;
const PARALLEL_LIMIT = 5;
const MAX_STORE_IMAGES = 10;
const TOP_STORES_COUNT = 12;

const TOP_STORE_NAMES = new Set([
  "FragranceNet", "FragranceX", "Sephora", "Nordstrom",
  "Ulta Beauty", "Macy's", "Bloomingdale's", "Neiman Marcus",
  "Harrods", "Selfridges", "Realry", "The Perfume Shop",
]);

// Browser instance management
let browserInstance: Browser | null = null;
let browserPid: number | null = null;

async function getBrowser(): Promise<Browser | null> {
  const puppeteer = await getPuppeteer();
  if (!puppeteer) {
    console.log("[Browser] Puppeteer not available, skipping browser launch");
    return null;
  }

  if (browserInstance) {
    try {
      if (browserInstance.connected) await browserInstance.close();
    } catch { /* ignore */ }
    browserInstance = null;
  }

  try {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas", "--disable-gpu", "--window-size=1920x1080",
        "--disable-blink-features=AutomationControlled",
        "--disable-features=IsolateOrigins,site-per-process",
        "--disable-extensions", "--disable-background-networking",
        "--disable-default-apps", "--disable-sync", "--disable-translate",
        "--metrics-recording-only", "--no-first-run",
      ],
    });
    browserPid = browserInstance!.process()?.pid || null;
    console.log(`[Browser] Launched (PID: ${browserPid})`);
    return browserInstance;
  } catch (err) {
    console.error(`[Browser] Launch failed: ${err}`);
    return null;
  }
}

async function closeBrowser(): Promise<void> {
  if (browserInstance) {
    try { await browserInstance.close(); } catch { /* ignore */ }
    browserInstance = null;
  }
  if (browserPid) {
    try { await execAsync(`kill -9 ${browserPid} 2>/dev/null || true`); } catch { /* ignore */ }
    browserPid = null;
  }
}

async function cleanupOrphanedProcesses(): Promise<void> {
  try {
    await execAsync('pkill -9 -f "puppeteer.*chrome" 2>/dev/null || true');
    await execAsync('rm -rf /tmp/puppeteer_* 2>/dev/null || true');
    console.log('[Cleanup] Cleaned up orphaned processes');
  } catch { /* ignore */ }
}

try { cleanupOrphanedProcesses(); } catch { /* ignore */ }

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`'${operation}' timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise
      .then((result) => { clearTimeout(timer); resolve(result); })
      .catch((err) => { clearTimeout(timer); reject(err); });
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(min: number, max: number): Promise<void> {
  return delay(Math.floor(Math.random() * (max - min + 1)) + min);
}

const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15",
];

function getRandomUserAgent(): string {
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

// ===== EXCLUSION ZONES for image extraction =====
const EXCLUDED_SECTION_SELECTORS = [
  '[class*="similar"]', '[class*="recommend"]', '[class*="related"]',
  '[class*="also-like"]', '[class*="you-may"]', '[class*="recently"]',
  '[class*="cross-sell"]', '[class*="upsell"]', '[class*="carousel"]',
  '[id*="similar"]', '[id*="recommend"]', '[id*="related"]',
  '[data-component*="recommend"]', '[data-component*="similar"]',
  'footer', '[class*="footer"]',
].join(', ');

const MAIN_PRODUCT_SELECTORS = [
  '[class*="product-image"]', '[class*="product-gallery"]',
  '[class*="pdp-image"]', '[class*="main-image"]',
  '[class*="hero-image"]', '[class*="product-media"]',
  '[data-component="product-image"]', '[data-testid*="product-image"]',
  '.product-detail img', '.product-page img',
  '[class*="zoom"]', '[class*="magnif"]',
];

async function extractProductImages(page: Page, store: StoreConfig): Promise<string[]> {
  const images: string[] = [];
  try {
    const extracted = await page.evaluate((mainSelectors: string[], excludedSelectors: string, storeSelectors: any) => {
      const results: string[] = [];
      const seen = new Set<string>();
      const addImg = (url: string | null | undefined) => {
        if (!url || url.startsWith('data:') || seen.has(url)) return;
        seen.add(url);
        results.push(url);
      };
      const excludedElements = document.querySelectorAll(excludedSelectors);
      const isInExcludedZone = (el: Element): boolean => {
        for (const excluded of Array.from(excludedElements)) {
          if (excluded.contains(el)) return true;
        }
        return false;
      };
      if (storeSelectors.productImage) {
        const storeImgs = document.querySelectorAll(storeSelectors.productImage);
        for (const img of Array.from(storeImgs)) {
          if (isInExcludedZone(img)) continue;
          const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-zoom-image');
          addImg(src);
        }
      }
      for (const selector of mainSelectors) {
        const container = document.querySelector(selector);
        if (!container || isInExcludedZone(container)) continue;
        const imgs = container.querySelectorAll('img');
        for (const img of Array.from(imgs)) {
          const src = img.getAttribute('src') || img.getAttribute('data-src');
          addImg(src);
        }
      }
      if (results.length < 3) {
        const allImgs = document.querySelectorAll('img');
        for (const img of Array.from(allImgs)) {
          if (isInExcludedZone(img)) continue;
          const rect = img.getBoundingClientRect();
          if (rect.top > 1200) continue;
          if (rect.width < 200 || rect.height < 200) continue;
          const src = img.getAttribute('src') || img.getAttribute('data-src');
          addImg(src);
        }
      }
      return results;
    }, MAIN_PRODUCT_SELECTORS, EXCLUDED_SECTION_SELECTORS, store.selectors);
    for (let url of extracted) {
      if (url.startsWith('//')) url = 'https:' + url;
      else if (url.startsWith('/')) {
        const baseUrl = new URL(store.baseUrl);
        url = baseUrl.origin + url;
      }
      if (!images.includes(url)) images.push(url);
    }
    console.log(`  Extracted ${images.length} product images`);
  } catch (err) {
    console.error(`  Error extracting images: ${err}`);
  }
  return images;
}

async function scrapeStore(page: Page, store: StoreConfig, sku: string): Promise<ScrapedImageResult[]> {
  const results: ScrapedImageResult[] = [];
  try {
    const searchUrl = store.searchUrlTemplate.replace("{sku}", sku);
    await withTimeout(
      page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS }),
      PAGE_TIMEOUT_MS + 3000,
      `Navigate to ${store.name}`
    );
    await delay(1500);
    const noResults = await page.$(store.selectors.noResults);
    if (noResults) return [];
    const pageContent = await page.evaluate(() => {
      return (document.body.innerText + ' ' + document.title).toLowerCase();
    });
    const skuLower = sku.toLowerCase();
    if (!pageContent.includes(skuLower)) {
      console.log(`  [${store.name}] SKU not found on page - skipping`);
      return [];
    }
    const productLink = await page.$(store.selectors.productLink);
    if (productLink) {
      try {
        await productLink.click();
        await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS }).catch(() => {});
        await delay(1000);
      } catch { /* ignore */ }
    }
    const imageUrls = await extractProductImages(page, store);
    for (const url of imageUrls) {
      results.push({ sku, storeName: store.name, sourceUrl: page.url(), imageUrl: url });
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('timed out')) {
      console.log(`  [${store.name}] Timed out - skipping`);
    } else {
      console.error(`  [${store.name}] Error: ${err instanceof Error ? err.message : err}`);
    }
  }
  return results;
}

function getTopStores(): StoreConfig[] {
  const active = getActiveStores();
  const top = active.filter(s => TOP_STORE_NAMES.has(s.name));
  if (top.length < TOP_STORES_COUNT) {
    const remaining = active.filter(s => !TOP_STORE_NAMES.has(s.name));
    top.push(...remaining.slice(0, TOP_STORES_COUNT - top.length));
  }
  return top.slice(0, TOP_STORES_COUNT);
}

// ===== MAIN SCRAPE FUNCTION =====
export async function scrapeSku(sku: string): Promise<SkuScrapeResult> {
  const startTime = Date.now();
  const allImages: ScrapedImageResult[] = [];
  const errors: string[] = [];

  // STEP 1: UPC database lookup (fast, reliable, no browser needed)
  console.log(`[${sku}] STEP 1: UPC database lookup...`);
  try {
    const upcResult = await lookupUpc(sku);
    if (upcResult.found) {
      console.log(`[${sku}] UPC found: ${upcResult.productName} (${upcResult.images.length} images)`);
      for (const imageUrl of upcResult.images) {
        allImages.push({ sku, storeName: "UPC Database", sourceUrl: "upcitemdb.com", imageUrl });
      }
    } else {
      console.log(`[${sku}] UPC: not found`);
    }
  } catch (upcErr) {
    console.error(`[${sku}] UPC lookup error: ${upcErr}`);
    errors.push(`UPC lookup failed: ${upcErr instanceof Error ? upcErr.message : String(upcErr)}`);
  }

  // STEP 2: Google Images search (no API key, no rate limits, no browser needed)
  if (allImages.length < 3) {
    console.log(`[${sku}] STEP 2: Google Images search (have ${allImages.length} images so far)...`);
    try {
      const googleResult = await searchProductImages(sku);
      if (googleResult.imageUrls.length > 0) {
        console.log(`[${sku}] Google Images found ${googleResult.imageUrls.length} images`);
        for (const imageUrl of googleResult.imageUrls) {
          allImages.push({ sku, storeName: "Google Images", sourceUrl: "google.com", imageUrl });
        }
      } else {
        console.log(`[${sku}] Google Images: no images found`);
      }
    } catch (googleErr) {
      console.error(`[${sku}] Google Images error: ${googleErr}`);
      errors.push(`Google Images failed: ${googleErr instanceof Error ? googleErr.message : String(googleErr)}`);
    }
  }

  // STEP 2b: eBay image search (no API key, no rate limits, no browser needed)
  if (allImages.length < 3) {
    console.log(`[${sku}] STEP 2b: eBay search (have ${allImages.length} images so far)...`);
    try {
      const ebayImages = await searchEbayImages(sku);
      for (const imageUrl of ebayImages) {
        allImages.push({ sku, storeName: "eBay", sourceUrl: "ebay.com", imageUrl });
      }
      console.log(`[${sku}] eBay found ${ebayImages.length} images`);
    } catch (ebayErr) {
      console.error(`[${sku}] eBay error: ${ebayErr}`);
    }
  }

  // STEP 2c: Amazon/retailer direct search (no browser needed)
  if (allImages.length < 3) {
    console.log(`[${sku}] STEP 2c: Amazon/retailer search (have ${allImages.length} images so far)...`);
    try {
      const retailerImages = await searchRetailerImages(sku);
      for (const imageUrl of retailerImages) {
        allImages.push({ sku, storeName: "Amazon", sourceUrl: "amazon.com", imageUrl });
      }
      console.log(`[${sku}] Amazon/retailer found ${retailerImages.length} images`);
    } catch (retailErr) {
      console.error(`[${sku}] Amazon/retailer error: ${retailErr}`);
    }
  }

  // STEP 3: Browser scraping (OPTIONAL - only if we still need more images AND browser is available)
  if (allImages.length < 3) {
    console.log(`[${sku}] STEP 3: Browser scraping (have ${allImages.length} images so far)...`);
    const browser = await getBrowser();
    if (browser) {
      try {
        const stores = getTopStores();
        console.log(`[${sku}] Scraping ${stores.length} top stores...`);
        for (let i = 0; i < stores.length; i += PARALLEL_LIMIT) {
          if (Date.now() - startTime > SKU_TIMEOUT_MS) {
            console.log(`[${sku}] Timeout exceeded, stopping store scraping`);
            errors.push(`Timeout after ${Math.floor((Date.now() - startTime) / 1000)}s`);
            break;
          }
          const batch = stores.slice(i, i + PARALLEL_LIMIT);
          console.log(`  Batch: ${batch.map(s => s.name).join(', ')}`);
          const batchResults = await Promise.all(
            batch.map(async (store) => {
              const storePage = await browser.newPage();
              await storePage.setUserAgent(getRandomUserAgent());
              await storePage.setViewport({ width: 1920, height: 1080 });
              try {
                return await scrapeStore(storePage, store, sku);
              } catch (err) {
                errors.push(`${store.name}: ${err instanceof Error ? err.message : "Error"}`);
                return [];
              } finally {
                try { await storePage.close(); } catch { /* ignore */ }
              }
            })
          );
          for (const images of batchResults) {
            allImages.push(...images);
          }
          if (allImages.length >= MAX_STORE_IMAGES) {
            console.log(`[${sku}] Early exit: ${allImages.length} images found`);
            break;
          }
        }
      } finally {
        await closeBrowser();
      }
    } else {
      console.log(`[${sku}] Browser not available, skipping store scraping`);
      errors.push("Browser not available (Chrome not installed)");
    }
  } else {
    console.log(`[${sku}] ${allImages.length} images found, skipping browser scraping`);
  }

  // Deduplicate
  const uniqueUrls = new Set<string>();
  const uniqueImages = allImages.filter(img => {
    if (uniqueUrls.has(img.imageUrl)) return false;
    uniqueUrls.add(img.imageUrl);
    return true;
  });

  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  console.log(`[${sku}] ${uniqueImages.length} unique images in ${elapsed}s`);

  // STEP 4: HQ pipeline (parallel scoring + parallel upscaling)
  const imageUrls = uniqueImages.map(img => img.imageUrl);
  const hqResult = await processImagesHQ(sku, imageUrls);
  console.log(`[${sku}] HQ pipeline: ${hqResult.images.length} images, cost: $${hqResult.totalCost.toFixed(4)}`);

  // STEP 5: Upload to S3 (parallel)
  const uploadedHQ = await uploadHQImages(sku, hqResult.images);

  // Build final images
  const finalImages: ScrapedImageResult[] = [];
  for (const uploaded of uploadedHQ) {
    const hqImg = hqResult.images.find(img =>
      uploaded.s3Key.includes(img.source) || true
    );
    const sourceImg = uniqueImages.find(img =>
      hqImg && img.imageUrl === hqImg.originalUrl
    );
    finalImages.push({
      sku,
      storeName: sourceImg?.storeName || "HQ Pipeline",
      sourceUrl: sourceImg?.sourceUrl || "",
      imageUrl: uploaded.s3Url,
      s3Key: uploaded.s3Key,
      s3Url: uploaded.s3Url,
      width: uploaded.width,
      height: uploaded.height,
    });
  }

  console.log(`[${sku}] DONE: ${finalImages.length} HQ images uploaded to S3 in ${Math.floor((Date.now() - startTime) / 1000)}s`);

  return {
    sku,
    images: finalImages,
    errors,
    status: finalImages.length > 0 ? "completed" : "failed",
  };
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

    const archive = archiver("zip", { zlib: { level: 6 } });
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
    console.log(`Added ${addedCount} HQ images to zip`);
    archive.finalize();
  });
}

// ===== MAIN JOB RUNNER with hard timeout =====
export async function runScrapeJob(
  orderId: number,
  skus: string[],
  onProgress?: (processed: number, total: number) => void
): Promise<ScrapeJobResult> {
  const results: SkuScrapeResult[] = [];
  let totalImages = 0;
  let processedSkus = 0;
  let failedSkus = 0;

  console.log(`[Job ${orderId}] Starting with ${skus.length} SKUs`);

  const jobTimeout = setTimeout(async () => {
    console.error(`[Job ${orderId}] HARD TIMEOUT - force killing all processes`);
    await closeBrowser();
    await cleanupOrphanedProcesses();
  }, SKU_TIMEOUT_MS * skus.length + 60000);

  try {
    for (let i = 0; i < skus.length; i++) {
      const sku = skus[i];
      console.log(`[Job ${orderId}] SKU ${i + 1}/${skus.length}: ${sku}`);

      try {
        const result = await withTimeout(
          scrapeSku(sku),
          SKU_TIMEOUT_MS,
          `Scrape SKU ${sku}`
        );
        results.push(result);
        totalImages += result.images.length;
        processedSkus++;
        if (result.status === "failed") failedSkus++;
      } catch (err) {
        console.error(`[Job ${orderId}] SKU ${sku} failed: ${err}`);
        results.push({
          sku,
          images: [],
          errors: [err instanceof Error ? err.message : "Unknown error"],
          status: "failed",
        });
        failedSkus++;
        processedSkus++;
      }

      if (onProgress) onProgress(i + 1, skus.length);
    }

    console.log(`[Job ${orderId}] Creating zip...`);
    let zipKey = "";
    let zipUrl = "";
    try {
      const zipResult = await createZipFromResults(results, orderId);
      zipKey = zipResult.zipKey;
      zipUrl = zipResult.zipUrl;
      console.log(`[Job ${orderId}] Zip created: ${zipUrl}`);
    } catch (zipErr) {
      console.error(`[Job ${orderId}] Zip failed:`, zipErr);
    }

    return { orderId, results, zipKey, zipUrl, totalImages, processedSkus, failedSkus };
  } finally {
    clearTimeout(jobTimeout);
    await closeBrowser();
    await cleanupOrphanedProcesses();
    console.log(`[Job ${orderId}] Complete. Resources cleaned up.`);
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
    if (matches) skus.push(...matches);
  }

  return Array.from(new Set(skus));
}
