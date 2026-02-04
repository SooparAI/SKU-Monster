import puppeteer, { Browser, Page } from "puppeteer";
import { StoreConfig, getActiveStores, buildSearchUrl } from "./storeConfigs";
import { storagePut } from "../storage";
import { nanoid } from "nanoid";
import archiver from "archiver";
import { Writable } from "stream";

export interface ScrapedImageResult {
  sku: string;
  storeName: string;
  sourceUrl: string;
  imageUrl: string;
  s3Key?: string;
  s3Url?: string;
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

// Browser instance management
let browserInstance: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browserInstance || !browserInstance.connected) {
    browserInstance = await puppeteer.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--disable-gpu",
        "--window-size=1920x1080",
      ],
    });
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

// Extract image URLs from a page
async function extractImageUrls(
  page: Page,
  selector: string
): Promise<string[]> {
  try {
    await page.waitForSelector(selector, { timeout: 5000 });
    const images = await page.$$eval(selector, (imgs) =>
      imgs
        .map((img) => {
          const src =
            img.getAttribute("src") ||
            img.getAttribute("data-src") ||
            img.getAttribute("data-image") ||
            img.getAttribute("data-lazy-src");
          return src;
        })
        .filter((src): src is string => !!src && src.startsWith("http"))
    );
    return Array.from(new Set(images)); // Remove duplicates
  } catch {
    return [];
  }
}

// Check if search returned no results
async function hasNoResults(page: Page, selector: string): Promise<boolean> {
  try {
    const element = await page.$(selector);
    return element !== null;
  } catch {
    return false;
  }
}

// Scrape a single store for a SKU
async function scrapeStore(
  page: Page,
  store: StoreConfig,
  sku: string
): Promise<ScrapedImageResult[]> {
  const results: ScrapedImageResult[] = [];
  const searchUrl = buildSearchUrl(store, sku);

  try {
    // Navigate to search page
    await page.goto(searchUrl, {
      waitUntil: "networkidle2",
      timeout: 30000,
    });

    // Wait for page to load
    await delay(1000);

    // Check for no results
    if (await hasNoResults(page, store.selectors.noResults)) {
      return results;
    }

    // Try to find product links
    const productLinks = await page.$$eval(
      store.selectors.productLink,
      (links) =>
        links
          .map((a) => a.getAttribute("href"))
          .filter((href): href is string => !!href)
          .slice(0, 3) // Limit to first 3 products
    );

    if (productLinks.length === 0) {
      // No product links found, try to extract images from search page directly
      const images = await extractImageUrls(page, store.selectors.productImage);
      for (const imageUrl of images) {
        results.push({
          sku,
          storeName: store.name,
          sourceUrl: searchUrl,
          imageUrl: imageUrl.startsWith("//") ? `https:${imageUrl}` : imageUrl,
        });
      }
    } else {
      // Visit each product page and extract images
      for (const link of productLinks) {
        const productUrl = link.startsWith("http")
          ? link
          : `${store.baseUrl}${link}`;

        try {
          await page.goto(productUrl, {
            waitUntil: "networkidle2",
            timeout: 30000,
          });
          await delay(store.rateLimit);

          const images = await extractImageUrls(
            page,
            store.selectors.productImage
          );
          for (const imageUrl of images) {
            results.push({
              sku,
              storeName: store.name,
              sourceUrl: productUrl,
              imageUrl: imageUrl.startsWith("//")
                ? `https:${imageUrl}`
                : imageUrl,
            });
          }
        } catch (err) {
          console.error(
            `Error visiting product page ${productUrl}:`,
            err instanceof Error ? err.message : err
          );
        }
      }
    }
  } catch (err) {
    console.error(
      `Error scraping ${store.name} for SKU ${sku}:`,
      err instanceof Error ? err.message : err
    );
  }

  return results;
}

// Download image and upload to S3
async function downloadAndUploadImage(
  imageUrl: string,
  sku: string,
  storeName: string,
  index: number
): Promise<{ s3Key: string; s3Url: string } | null> {
  try {
    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "image/jpeg";
    const buffer = Buffer.from(await response.arrayBuffer());

    // Determine file extension
    let ext = "jpg";
    if (contentType.includes("png")) ext = "png";
    else if (contentType.includes("webp")) ext = "webp";
    else if (contentType.includes("gif")) ext = "gif";

    const safeStoreName = storeName.replace(/[^a-zA-Z0-9]/g, "_");
    const s3Key = `scrapes/${sku}/${safeStoreName}_${index}_${nanoid(6)}.${ext}`;

    const { url } = await storagePut(s3Key, buffer, contentType);
    return { s3Key, s3Url: url };
  } catch (err) {
    console.error(
      `Failed to download image ${imageUrl}:`,
      err instanceof Error ? err.message : err
    );
    return null;
  }
}

// Scrape all stores for a single SKU
export async function scrapeSku(sku: string): Promise<SkuScrapeResult> {
  const browser = await getBrowser();
  const page = await browser.newPage();

  // Set user agent
  await page.setUserAgent(
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  );

  const stores = getActiveStores();
  const allImages: ScrapedImageResult[] = [];
  const errors: string[] = [];

  try {
    for (const store of stores) {
      try {
        console.log(`Scraping ${store.name} for SKU ${sku}...`);
        const images = await scrapeStore(page, store, sku);
        allImages.push(...images);
        await delay(store.rateLimit);
      } catch (err) {
        const errorMsg = `${store.name}: ${err instanceof Error ? err.message : "Unknown error"}`;
        errors.push(errorMsg);
        console.error(errorMsg);
      }
    }

    // Download and upload images to S3
    let imageIndex = 0;
    for (const image of allImages) {
      const uploaded = await downloadAndUploadImage(
        image.imageUrl,
        sku,
        image.storeName,
        imageIndex++
      );
      if (uploaded) {
        image.s3Key = uploaded.s3Key;
        image.s3Url = uploaded.s3Url;
      }
    }
  } finally {
    await page.close();
  }

  return {
    sku,
    images: allImages.filter((img) => img.s3Url), // Only return successfully uploaded images
    errors,
    status:
      allImages.length > 0
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
  const chunks: Buffer[] = [];
  const writableStream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    },
  });

  const archive = archiver("zip", { zlib: { level: 9 } });
  archive.pipe(writableStream);

  // Add images to zip organized by SKU
  for (const result of results) {
    for (let i = 0; i < result.images.length; i++) {
      const image = result.images[i];
      if (image.s3Url) {
        try {
          const response = await fetch(image.s3Url);
          if (response.ok) {
            const buffer = Buffer.from(await response.arrayBuffer());
            const ext = image.s3Url.split(".").pop() || "jpg";
            const filename = `${result.sku}/${image.storeName}_${i + 1}.${ext}`;
            archive.append(buffer, { name: filename });
          }
        } catch (err) {
          console.error(`Failed to add image to zip: ${err}`);
        }
      }
    }
  }

  await archive.finalize();

  // Wait for stream to finish
  await new Promise<void>((resolve) => writableStream.on("finish", resolve));

  const zipBuffer = Buffer.concat(chunks);
  const zipKey = `orders/${orderId}/Photo.1_Output_${nanoid(8)}.zip`;

  const { url } = await storagePut(zipKey, zipBuffer, "application/zip");

  return { zipKey, zipUrl: url };
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
    const { zipKey, zipUrl } = await createZipFromResults(results, orderId);

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
  // Split by common delimiters and extract potential SKUs
  const parts = text
    .split(/[\n\r,;\t]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  // Extract numeric SKUs (EAN/UPC codes are typically 8-14 digits)
  const skus: string[] = [];
  for (const part of parts) {
    // Extract numbers that look like SKUs
    const matches = part.match(/\d{8,14}/g);
    if (matches) {
      skus.push(...matches);
    }
  }

  return Array.from(new Set(skus)); // Remove duplicates
}
