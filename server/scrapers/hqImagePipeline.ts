/**
 * HQ Image Processing Pipeline v2 — STUDIO QUALITY
 * 
 * Strategy (NO AI image generation — real photos only):
 * 1. Pre-filter scraped URLs by pattern (FREE, instant)
 * 2. Score images in PARALLEL — picks the best real product photos
 * 3. Watermark detection — penalize/skip watermarked images
 * 4. AI upscale via Real-ESRGAN (~$0.002/image) — crisp 2000x2000+
 * 5. Final compositing: product centered on pure white, uniform size
 * 
 * Key principles:
 * - NEVER use AI to generate product images (text on labels gets garbled)
 * - Real product photos from retailers are the ONLY source
 * - NO background removal (rembg causes edge artifacts on product images)
 * - Upscale + white pad = clean studio quality
 * - Target: 3 images, each 2000x2000, 1-3MB, pure white background
 * - Cost budget: ~$0.002/image × 3 = $0.006/SKU (well under $0.05)
 */

import { storagePut } from '../storage';
import { nanoid } from 'nanoid';
import Replicate from 'replicate';
import { detectWatermark } from './imagePostProcess';

// Dynamic sharp import
let sharpModule: any = null;
let sharpLoaded = false;

async function getSharp(): Promise<any> {
  if (sharpLoaded) return sharpModule;
  sharpLoaded = true;
  try {
    const mod = await import('sharp');
    sharpModule = mod.default || mod;
    console.log('[HQ Pipeline] sharp module loaded successfully');
  } catch (e) {
    console.warn('[HQ Pipeline] sharp not available for metadata');
    sharpModule = null;
  }
  return sharpModule;
}

// Replicate config
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN || '';

// Models
const REAL_ESRGAN_MODEL = 'nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa';
// REMBG removed — causes edge artifacts on product images

// Output dimensions
const STUDIO_SIZE = 2000; // 2000x2000 studio output
// STUDIO_BG removed — studioComposite no longer used

export interface ProcessedImage {
  originalUrl: string;
  processedUrl: string;
  width: number;
  height: number;
  sizeKB: number;
  source: 'scraper';
  isHQ: boolean;
  score: number;
}

export interface HQPipelineResult {
  sku: string;
  images: ProcessedImage[];
  productName: string | null;
  brand: string | null;
  totalCost: number;
  processingSteps: string[];
}

// ===== URL FILTERING =====

const NON_PRODUCT_PATTERNS = [
  'logo', 'icon', 'sprite', 'button', 'arrow', 'chevron',
  'close', 'search', 'menu', 'header', 'footer',
  'thumb', 'thumbnail', '_xs', '_sm', '_tiny',
  '50x50', '100x100', '150x150',
  'placeholder', 'loading', 'blank', 'empty',
  'no-image', 'coming-soon', 'out-of-stock', 'sold-out',
  'payment', 'visa', 'mastercard', 'paypal', 'amex', 'klarna', 'tabby',
  'trust', 'certificate', 'badge', 'verified',
  'facebook', 'twitter', 'instagram', 'tiktok', 'youtube', 'pinterest',
  'pixel', 'tracking', '1x1', 'spacer', 'beacon',
  'shipping', 'delivery', 'guarantee',
  'avatar', 'promo', 'ad-', 'advertisement',
  'cart', 'checkout',
  'similar', 'recommend', 'related', 'also-like', 'you-may',
  'recently-viewed', 'cross-sell', 'upsell',
];

const PRODUCT_PATTERNS = [
  'product', 'item', 'perfume', 'fragrance', 'cologne', 'eau', 'spray',
  'bottle', 'main', 'hero', 'primary', 'large', 'zoom', 'full', 'hires',
];

function preFilterByUrl(urls: string[]): string[] {
  return urls.filter(url => {
    const urlLower = url.toLowerCase();
    for (const pattern of NON_PRODUCT_PATTERNS) {
      if (urlLower.includes(pattern)) return false;
    }
    const hasImageExt = /\.(jpg|jpeg|png|webp|tif|tiff)(\?|$)/i.test(url);
    const hasImageParam = /fmt=(jpeg|jpg|png|webp)/i.test(url);
    const hasImageContentHint = /\/images?\//i.test(url) || /\/media\//i.test(url);
    if (!hasImageExt && !hasImageParam && !hasImageContentHint) return false;
    return true;
  });
}

// ===== IMAGE SCORING =====

function getBrowserHeaders(imageUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Sec-Ch-Ua': '"Chromium";v="131", "Google Chrome";v="131"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'image',
    'Sec-Fetch-Mode': 'no-cors',
    'Sec-Fetch-Site': 'cross-site',
  };
  try {
    const url = new URL(imageUrl);
    headers['Referer'] = `${url.protocol}//${url.hostname}/`;
  } catch { /* ignore */ }
  return headers;
}

async function scoreImage(imageUrl: string): Promise<{
  score: number;
  width: number;
  height: number;
  sizeKB: number;
  buffer: Buffer | null;
}> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const headers = attempt === 0
        ? getBrowserHeaders(imageUrl)
        : { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 'Accept': '*/*' };

      const response = await fetch(imageUrl, {
        headers,
        signal: AbortSignal.timeout(15000),
        redirect: 'follow',
      });

      if (!response.ok) {
        if (attempt === 0) continue;
        return { score: 0, width: 0, height: 0, sizeKB: 0, buffer: null };
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const sizeKB = buffer.length / 1024;

      let width = 0;
      let height = 0;
      let score = 50;

      const sharp = await getSharp();
      if (sharp) {
        try {
          const metadata = await sharp(buffer).metadata();
          width = metadata.width || 0;
          height = metadata.height || 0;
        } catch { /* ignore */ }
      }

      // File size scoring
      if (sizeKB < 2) score -= 50;
      else if (sizeKB < 10) score -= 20;
      else if (sizeKB >= 200) score += 30;
      else if (sizeKB >= 50) score += 15;

      // Dimension scoring — heavily favor large images
      if (width > 0 && height > 0) {
        if (width < 200 || height < 200) score -= 40;
        else if (width >= 1500 && height >= 1500) score += 40;
        else if (width >= 800 && height >= 800) score += 30;
        else if (width >= 500 && height >= 500) score += 15;

        const aspectRatio = width / height;
        if (aspectRatio >= 0.6 && aspectRatio <= 1.2) score += 20; // Square-ish ideal
        else if (aspectRatio > 2.5 || aspectRatio < 0.4) score -= 30;
      } else {
        if (sizeKB >= 30) score += 10;
      }

      // URL pattern scoring
      const urlLower = imageUrl.toLowerCase();
      for (const pattern of PRODUCT_PATTERNS) {
        if (urlLower.includes(pattern)) { score += 5; break; }
      }

      // Content analysis with sharp
      if (sharp) {
        try {
          const stats = await sharp(buffer).stats();
          const channels = stats.channels;
          const avgStdDev = channels.reduce((sum: number, ch: any) => sum + ch.stdev, 0) / channels.length;
          if (avgStdDev < 10) score -= 30;
          else if (avgStdDev > 40) score += 10;

          const avgMean = channels.reduce((sum: number, ch: any) => sum + ch.mean, 0) / channels.length;
          if (avgMean > 200 && avgStdDev > 30) score += 15; // White bg with detail
        } catch { /* ignore */ }
      }

      // Watermark detection — penalize watermarked images
      if (buffer && buffer.length > 5000) {
        try {
          const wm = await detectWatermark(buffer);
          if (wm.score >= 60) {
            score -= 40;
            console.log(`[HQ Score] Watermark detected (${wm.score}): ${wm.reason}`);
          } else if (wm.score >= 40) {
            score -= 20;
            console.log(`[HQ Score] Possible watermark (${wm.score}): ${wm.reason}`);
          }
        } catch { /* ignore */ }
      }

      const finalScore = Math.max(0, Math.min(100, score));
      console.log(`[HQ Score] ${finalScore}: ${imageUrl.substring(0, 60)}... (${width}x${height}, ${sizeKB.toFixed(1)}KB)`);
      return { score: finalScore, width, height, sizeKB, buffer };
    } catch (err) {
      if (attempt === 0) continue;
      console.error(`[HQ Score] Error scoring ${imageUrl.substring(0, 60)}: ${err}`);
      return { score: 0, width: 0, height: 0, sizeKB: 0, buffer: null };
    }
  }
  return { score: 0, width: 0, height: 0, sizeKB: 0, buffer: null };
}

// ===== REPLICATE HELPERS =====

// removeBackground() REMOVED — rembg causes edge artifacts on product images
// Most retailer images already have white/light backgrounds

/**
 * AI upscale using Replicate Real-ESRGAN (~$0.002/image)
 */
async function aiUpscale(imageUrl: string, scale: number = 4): Promise<Buffer | null> {
  if (!REPLICATE_TOKEN) {
    console.warn('[AI Upscale] REPLICATE_API_TOKEN not set');
    return null;
  }

  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const replicate = new Replicate({ auth: REPLICATE_TOKEN });
      console.log(`[AI Upscale] Upscaling ${scale}x (attempt ${attempt}/${MAX_RETRIES})...`);
      const start = Date.now();

      const controller = new AbortController();
      const replicateTimeout = setTimeout(() => controller.abort(), 120000);

      let output: any;
      try {
        output = await replicate.run(REAL_ESRGAN_MODEL, {
          input: { image: imageUrl, scale, face_enhance: false },
        });
      } finally {
        clearTimeout(replicateTimeout);
      }

      let buffer: Buffer;
      if (output instanceof ReadableStream || (output && typeof (output as any).getReader === 'function')) {
        const reader = (output as ReadableStream).getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
        }
        buffer = Buffer.concat(chunks);
      } else if (typeof output === 'string') {
        const resp = await fetch(output, { signal: AbortSignal.timeout(30000) });
        buffer = Buffer.from(await resp.arrayBuffer());
      } else {
        console.error('[AI Upscale] Unexpected output type:', typeof output);
        return null;
      }

      const elapsed = Date.now() - start;
      console.log(`[AI Upscale] Done in ${elapsed}ms, output: ${(buffer.length / 1024).toFixed(1)}KB`);
      return buffer;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (errMsg.includes('429') && attempt < MAX_RETRIES) {
        const retryAfter = errMsg.match(/resets in ~(\d+)s/);
        const waitSec = retryAfter ? parseInt(retryAfter[1]) + 2 : 15;
        console.warn(`[AI Upscale] Rate limited, waiting ${waitSec}s...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
        continue;
      }
      console.error(`[AI Upscale] Failed (attempt ${attempt}): ${errMsg}`);
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      return null;
    }
  }
  return null;
}

// studioComposite() REMOVED — no longer needed without background removal

/**
 * Fallback: just resize and pad on white without background removal.
 * Used when bg removal fails or for already-white-bg images.
 */
async function simpleWhitePad(
  buffer: Buffer,
  targetSize: number = STUDIO_SIZE
): Promise<{ buffer: Buffer; width: number; height: number } | null> {
  const sharp = await getSharp();
  if (!sharp) return null;

  try {
    const metadata = await sharp(buffer).metadata();
    const origW = metadata.width || 0;
    const origH = metadata.height || 0;

    if (origW === 0 || origH === 0) return null;

    const maxFit = Math.floor(targetSize * 0.85);
    const scale = Math.min(maxFit / origW, maxFit / origH);
    const fitW = Math.round(origW * scale);
    const fitH = Math.round(origH * scale);

    const resized = await sharp(buffer)
      .resize(fitW, fitH, { fit: 'inside', withoutEnlargement: false, kernel: 'lanczos3' })
      .toBuffer();

    // Use compressionLevel 0 (no compression) to ensure file size >900KB for Amazon/eBay
    const padded = await sharp({
      create: {
        width: targetSize,
        height: targetSize,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite([{ input: resized, gravity: 'centre' }])
      .png({ compressionLevel: 0 }) // No compression = larger files (>900KB)
      .toBuffer();

    return { buffer: padded, width: targetSize, height: targetSize };
  } catch (err) {
    console.error(`[WhitePad] Error: ${err}`);
    return null;
  }
}

// ===== UPSCALE LOGIC =====

function getUpscaleFactor(width: number, height: number): number {
  const minDim = Math.min(width, height);
  const totalPixels = width * height;

  if (minDim >= 2000) return 0; // Already large enough
  if (minDim >= 1000) {
    if (totalPixels > 2_000_000) return 0;
    return 2;
  }
  if (totalPixels > 2_000_000) return 2;
  return 4;
}

/**
 * Process a single image in compressed mode — no bg removal, no upscaling.
 * Just resize to 1000x1000 on white background, output as JPEG for small file size.
 * Cost: $0 (no Replicate calls)
 */
async function processCompressedImage(
  sku: string,
  buffer: Buffer,
  width: number,
  height: number,
  index: number
): Promise<{ s3Url: string; s3Key: string; width: number; height: number; sizeKB: number; cost: number } | null> {
  try {
    const sharp = await getSharp();
    if (!sharp) return null;

    const COMPRESSED_SIZE = 1000;
    const maxFit = Math.floor(COMPRESSED_SIZE * 0.85);
    const scale = Math.min(maxFit / (width || 1), maxFit / (height || 1));
    const fitW = Math.round((width || 500) * scale);
    const fitH = Math.round((height || 500) * scale);

    const resized = await sharp(buffer)
      .resize(fitW, fitH, { fit: 'inside', withoutEnlargement: false, kernel: 'lanczos3' })
      .toBuffer();

    const padded = await sharp({
      create: {
        width: COMPRESSED_SIZE,
        height: COMPRESSED_SIZE,
        channels: 3,
        background: { r: 255, g: 255, b: 255 },
      },
    })
      .composite([{ input: resized, gravity: 'centre' }])
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer();

    const s3Key = `scrapes/${sku}/COMPRESSED_${index}_${COMPRESSED_SIZE}x${COMPRESSED_SIZE}_${nanoid(6)}.jpg`;
    const { url: s3Url } = await storagePut(s3Key, padded, 'image/jpeg');
    const sizeKB = padded.length / 1024;

    console.log(`[Compressed] ✓ ${s3Key} (${sizeKB.toFixed(0)}KB, $0)`);
    return { s3Url, s3Key, width: COMPRESSED_SIZE, height: COMPRESSED_SIZE, sizeKB, cost: 0 };
  } catch (err) {
    console.error(`[Compressed] Failed for image ${index}: ${err}`);
    return null;
  }
}

// ===== MAIN PIPELINE =====

/**
 * Process a single image through the studio pipeline:
 * 1. Upload original to S3 (temp)
 * 2. Upscale if needed via Real-ESRGAN
 * 3. Pad on white background at studio dimensions (2000x2000)
 * 
 * NO background removal — rembg causes edge artifacts on product images.
 * Most retailer images already have white/light backgrounds.
 */
async function processStudioImage(
  sku: string,
  buffer: Buffer,
  width: number,
  height: number,
  index: number,
  source: string
): Promise<{ s3Url: string; s3Key: string; width: number; height: number; sizeKB: number; cost: number } | null> {
  try {
    let cost = 0;

    // Step 1: Convert to PNG for best quality through the pipeline
    const sharp = await getSharp();
    let pngBuffer = buffer;
    if (sharp) {
      try {
        pngBuffer = await sharp(buffer).png().toBuffer();
      } catch { /* use original */ }
    }

    // Step 2: Check if upscaling is needed
    let upscaleBuffer = pngBuffer;
    let currentW = width;
    let currentH = height;

    if (sharp) {
      try {
        const meta = await sharp(pngBuffer).metadata();
        currentW = meta.width || width;
        currentH = meta.height || height;
      } catch { /* use original dims */ }
    }

    const scaleFactor = getUpscaleFactor(currentW, currentH);
    if (scaleFactor > 0) {
      // Upload to S3 so Replicate can access it
      const upscaleKey = `scrapes/temp_upscale_${nanoid(8)}.png`;
      const { url: upscaleUrl } = await storagePut(upscaleKey, pngBuffer, 'image/png');

      const upscaled = await aiUpscale(upscaleUrl, scaleFactor);
      if (upscaled && upscaled.length > pngBuffer.length) {
        upscaleBuffer = upscaled;
        cost += 0.002; // Real-ESRGAN cost
        
        if (sharp) {
          try {
            const meta = await sharp(upscaled).metadata();
            currentW = meta.width || currentW * scaleFactor;
            currentH = meta.height || currentH * scaleFactor;
          } catch { /* use calculated */ }
        }
        console.log(`[Studio] Upscaled to ${currentW}x${currentH}`);
      } else {
        console.log(`[Studio] Upscale failed, using ${currentW}x${currentH}`);
      }
    } else {
      console.log(`[Studio] No upscale needed (${currentW}x${currentH} already large)`);
    }

    // Step 3: White pad — center on white background at 2000x2000
    const finalResult = await simpleWhitePad(upscaleBuffer, STUDIO_SIZE);

    if (!finalResult) {
      console.error(`[Studio] White pad failed for image ${index}`);
      return null;
    }

    // Step 4: Upload final studio image to S3
    const s3Key = `scrapes/${sku}/STUDIO_${source}_${index}_${STUDIO_SIZE}x${STUDIO_SIZE}_${nanoid(6)}.png`;
    const { url: s3Url } = await storagePut(s3Key, finalResult.buffer, 'image/png');
    const sizeKB = finalResult.buffer.length / 1024;

    console.log(`[Studio] ✓ ${s3Key} (${sizeKB.toFixed(0)}KB, cost: $${cost.toFixed(4)})`);
    return { s3Url, s3Key, width: finalResult.width, height: finalResult.height, sizeKB, cost };
  } catch (err) {
    console.error(`[Studio] Failed for image ${index}: ${err}`);
    return null;
  }
}

// Minimum number of images we want in the output
const TARGET_IMAGE_COUNT = 5;

/**
 * Main HQ Pipeline v2 — STUDIO QUALITY, NO AI GENERATION
 */
export type QualityMode = 'studio' | 'compressed';

export async function processImagesHQ(
  sku: string,
  scrapedImageUrls: string[],
  productName?: string | null,
  brand?: string | null,
  qualityMode: QualityMode = 'studio'
): Promise<HQPipelineResult> {
  const result: HQPipelineResult = {
    sku,
    images: [],
    productName: productName || null,
    brand: brand || null,
    totalCost: 0,
    processingSteps: [],
  };

  console.log(`[HQ Pipeline] Processing ${scrapedImageUrls.length} scraped images for SKU ${sku}`);

  if (scrapedImageUrls.length === 0) {
    result.processingSteps.push('No images to process');
    console.log(`[HQ Pipeline] No images for SKU ${sku}`);
    return result;
  }

  // ===== STEP 1: Pre-filter by URL patterns (FREE, instant) =====
  result.processingSteps.push('Pre-filtering by URL patterns...');
  const preFiltered = preFilterByUrl(scrapedImageUrls);
  console.log(`[HQ Pipeline] Pre-filter: ${scrapedImageUrls.length} → ${preFiltered.length} images`);

  const urlsToScore = preFiltered.length > 0 ? preFiltered : scrapedImageUrls;
  if (preFiltered.length === 0) {
    result.processingSteps.push('Pre-filter fallback: using all original URLs');
  }

  // ===== STEP 2: Score images IN PARALLEL =====
  const scoreStart = Date.now();
  result.processingSteps.push('Scoring images...');
  const imagesToScore = urlsToScore.slice(0, 25); // Cast wider net

  const scoreResults = await Promise.all(
    imagesToScore.map(async (url) => {
      const scoreResult = await scoreImage(url);
      return { url, ...scoreResult };
    })
  );
  const scoreElapsed = ((Date.now() - scoreStart) / 1000).toFixed(1);
  result.processingSteps.push(`Scored ${imagesToScore.length} images in ${scoreElapsed}s`);

  // Filter and sort by score
  let scoredImages = scoreResults
    .filter(img => img.score >= 40 && img.buffer !== null)
    .sort((a, b) => b.score - a.score);

  // Fallback: use any downloaded image
  if (scoredImages.length === 0) {
    result.processingSteps.push('Score fallback: using any downloaded images');
    scoredImages = scoreResults
      .filter(img => img.buffer !== null && img.sizeKB > 2)
      .sort((a, b) => b.sizeKB - a.sizeKB);
  }

  // Deduplicate by similar dimensions
  const deduped: typeof scoredImages = [];
  for (const img of scoredImages) {
    const isDupe = deduped.some(existing => {
      if (img.width > 0 && existing.width > 0) {
        const wRatio = img.width / existing.width;
        const hRatio = img.height / existing.height;
        return Math.abs(wRatio - hRatio) < 0.1 && wRatio > 0.8 && wRatio < 1.2;
      }
      return false;
    });
    if (!isDupe) deduped.push(img);
  }
  scoredImages = deduped.length > 0 ? deduped : scoredImages;

  for (const img of scoredImages.slice(0, 5)) {
    console.log(`[HQ Pipeline] ✓ Score ${img.score}: ${img.url.substring(0, 60)}... (${img.width}x${img.height}, ${img.sizeKB.toFixed(1)}KB)`);
  }

  if (scoredImages.length === 0) {
    result.processingSteps.push('No images could be downloaded');
    console.error(`[HQ Pipeline] No downloadable images for SKU ${sku}`);
    return result;
  }

  // ===== STEP 3: Studio processing — top images IN PARALLEL =====
  const topImages = scoredImages.slice(0, Math.min(TARGET_IMAGE_COUNT + 1, scoredImages.length)); // Take 1 extra in case one fails
  const studioStart = Date.now();
  result.processingSteps.push(`${qualityMode === 'studio' ? 'Studio' : 'Compressed'} processing ${topImages.length} images...`);

  const studioResults = await Promise.allSettled(
    topImages.map((img, idx) =>
      qualityMode === 'compressed'
        ? processCompressedImage(sku, img.buffer!, img.width, img.height, idx + 1)
        : processStudioImage(sku, img.buffer!, img.width, img.height, idx + 1, 'studio')
    )
  );

  const studioElapsed = ((Date.now() - studioStart) / 1000).toFixed(1);

  for (let i = 0; i < studioResults.length; i++) {
    const settled = studioResults[i];
    if (settled.status === 'fulfilled' && settled.value) {
      const uploaded = settled.value;
      result.images.push({
        originalUrl: topImages[i].url,
        processedUrl: uploaded.s3Url,
        width: uploaded.width,
        height: uploaded.height,
        sizeKB: uploaded.sizeKB,
        source: 'scraper',
        isHQ: true,
        score: topImages[i].score,
      });
      result.totalCost += uploaded.cost;
    }

    // Stop once we have enough
    if (result.images.length >= TARGET_IMAGE_COUNT) break;
  }

  result.processingSteps.push(`Studio: ${result.images.length}/${topImages.length} images in ${studioElapsed}s, cost: $${result.totalCost.toFixed(4)}`);
  console.log(`[HQ Pipeline] Studio complete: ${result.images.length} images in ${studioElapsed}s, cost: $${result.totalCost.toFixed(4)}`);

  result.processingSteps.push(`Pipeline complete: ${result.images.length} studio images`);
  return result;
}

/**
 * Upload processed HQ images to S3 — images are already in S3 from the pipeline
 */
export async function uploadHQImages(
  sku: string,
  images: ProcessedImage[]
): Promise<{ s3Key: string; s3Url: string; width: number; height: number }[]> {
  if (images.length === 0) {
    console.log(`[HQ Pipeline] No images to upload for SKU ${sku}`);
    return [];
  }

  // Images are already uploaded during processStudioImage, just return the URLs
  const results = images.map(img => {
    const s3Key = img.processedUrl.split('/').slice(-4).join('/');
    return { s3Key, s3Url: img.processedUrl, width: img.width, height: img.height };
  });

  console.log(`[HQ Upload] ${results.length} images already in S3`);
  return results;
}
