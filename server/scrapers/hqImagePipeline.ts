/**
 * HQ Image Processing Pipeline - SCRAPE-FIRST VERSION
 * 
 * Strategy (prioritizes real product photos over AI generation):
 * 1. Pre-filter scraped URLs by pattern (FREE, instant)
 * 2. Score images in PARALLEL - picks the best real product photos
 * 3. Upload top 3-5 scraped images to S3
 * 4. AI upscale each via Replicate Real-ESRGAN to 4K (~$0.002/image)
 * 5. FALLBACK ONLY: If < 3 good scraped images, use Forge AI to generate extras
 * 
 * Key principle:
 * - Real product photos from retailers are ALWAYS better than AI-generated copies
 * - Real-ESRGAN preserves original detail, text, logos, and fine features
 * - Forge AI generates blurry 1024x1024 reproductions — only use as last resort
 */

import { storagePut } from '../storage';
import { nanoid } from 'nanoid';
import Replicate from 'replicate';

// Dynamic sharp import - may not be available in all environments
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

// Replicate Real-ESRGAN for AI upscaling
const REPLICATE_TOKEN = process.env.REPLICATE_API_TOKEN || '';
const REAL_ESRGAN_MODEL = 'nightmareai/real-esrgan:f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa';

/**
 * AI upscale using Replicate Real-ESRGAN (~$0.002/image, ~4s)
 * Takes an S3 URL and returns a 4x upscaled buffer
 */
async function aiUpscale(imageUrl: string, scale: number = 4): Promise<Buffer | null> {
  if (!REPLICATE_TOKEN) {
    console.warn('[AI Upscale] REPLICATE_API_TOKEN not set, skipping AI upscale');
    return null;
  }
  
  const MAX_RETRIES = 3;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const replicate = new Replicate({ auth: REPLICATE_TOKEN });
      console.log(`[AI Upscale] Upscaling ${scale}x via Real-ESRGAN (attempt ${attempt}/${MAX_RETRIES}): ${imageUrl.substring(0, 60)}...`);
      const start = Date.now();
      
      // Use AbortController for timeout (Replicate cold starts can take 30-60s)
      const controller = new AbortController();
      const replicateTimeout = setTimeout(() => controller.abort(), 120000); // 120s timeout
      
      let output: any;
      try {
        output = await replicate.run(REAL_ESRGAN_MODEL, {
          input: {
            image: imageUrl,
            scale,
            face_enhance: false,
          }
        });
      } finally {
        clearTimeout(replicateTimeout);
      }

    // Output is a ReadableStream — collect it into a buffer
    let buffer: Buffer;
    if (output instanceof ReadableStream || (output && typeof output.getReader === 'function')) {
      const reader = (output as ReadableStream).getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      buffer = Buffer.concat(chunks);
    } else if (typeof output === 'string') {
      // Sometimes returns a URL
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
      // Retry on 429 rate limiting
      if (errMsg.includes('429') && attempt < MAX_RETRIES) {
        const retryAfter = errMsg.match(/resets in ~(\d+)s/);
        const waitSec = retryAfter ? parseInt(retryAfter[1]) + 2 : 15;
        console.warn(`[AI Upscale] Rate limited (429), waiting ${waitSec}s before retry ${attempt + 1}/${MAX_RETRIES}...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
        continue;
      }
      console.error(`[AI Upscale] Real-ESRGAN failed (attempt ${attempt}): ${errMsg}`);
      if (attempt < MAX_RETRIES) {
        console.log(`[AI Upscale] Retrying in 5s...`);
        await new Promise(r => setTimeout(r, 5000));
        continue;
      }
      return null;
    }
  }
  return null; // Should not reach here
}

// Forge API config (from environment) — FALLBACK ONLY
const FORGE_API_URL = process.env.BUILT_IN_FORGE_API_URL || '';
const FORGE_API_KEY = process.env.BUILT_IN_FORGE_API_KEY || '';

export interface ProcessedImage {
  originalUrl: string;
  processedUrl: string;
  width: number;
  height: number;
  sizeKB: number;
  source: 'scraper' | 'ai_generated';
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

// Non-product URL patterns to filter out
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
  'avatar',
  'promo', 'ad-', 'advertisement',
  'cart', 'checkout',
  'similar', 'recommend', 'related', 'also-like', 'you-may',
  'recently-viewed', 'cross-sell', 'upsell',
];

// Product-positive URL patterns
const PRODUCT_PATTERNS = [
  'product', 'item', 'perfume', 'fragrance', 'cologne', 'eau', 'spray',
  'bottle', 'main', 'hero', 'primary', 'large', 'zoom', 'full', 'hires',
];

/**
 * Pre-filter URLs by pattern (FREE - instant)
 */
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

/**
 * Score an image - downloads once and returns buffer for reuse
 */
// Browser-like headers for downloading images from retailer CDNs
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
  // Add Referer based on the image domain
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
  // Try up to 2 times with different strategies
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const headers = attempt === 0 
        ? getBrowserHeaders(imageUrl)
        : { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', 'Accept': '*/*' };
      
      const response = await fetch(imageUrl, {
        headers,
        signal: AbortSignal.timeout(15000), // 15s timeout (increased from 10s)
        redirect: 'follow',
      });
      
      if (!response.ok) {
        if (attempt === 0) {
          console.log(`[HQ Score] HTTP ${response.status} for ${imageUrl.substring(0, 60)}... (retrying)`);
          continue;
        }
        console.log(`[HQ Score] HTTP ${response.status} for ${imageUrl.substring(0, 60)}...`);
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
      } catch (e) {
        console.log(`[HQ Score] sharp metadata failed: ${e}`);
      }
    }
    
    // File size scoring
    if (sizeKB < 2) score -= 50;
    else if (sizeKB < 10) score -= 20;
    else if (sizeKB >= 200) score += 30;
    else if (sizeKB >= 50) score += 15;
    
    // Dimension scoring — heavily favor large images
    if (width > 0 && height > 0) {
      if (width < 200 || height < 200) score -= 40;
      else if (width >= 1500 && height >= 1500) score += 40; // Bonus for already-large images
      else if (width >= 800 && height >= 800) score += 30;
      else if (width >= 500 && height >= 500) score += 15;
      
      const aspectRatio = width / height;
      if (aspectRatio >= 0.6 && aspectRatio <= 1.2) score += 20; // Square-ish is ideal for product photos
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
        if (avgStdDev < 10) score -= 30; // Very uniform = probably not a product photo
        else if (avgStdDev > 40) score += 10;
        
        const avgMean = channels.reduce((sum: number, ch: any) => sum + ch.mean, 0) / channels.length;
        if (avgMean > 200 && avgStdDev > 30) score += 15; // White background with detail = product photo
      } catch { /* ignore */ }
    }
    
    const finalScore = Math.max(0, Math.min(100, score));
    console.log(`[HQ Score] ${finalScore}: ${imageUrl.substring(0, 60)}... (${width}x${height}, ${sizeKB.toFixed(1)}KB)`);
    return { score: finalScore, width, height, sizeKB, buffer };
    } catch (err) {
      if (attempt === 0) {
        console.log(`[HQ Score] Error on attempt 1 for ${imageUrl.substring(0, 60)}...: ${err instanceof Error ? err.message : err} (retrying)`);
        continue;
      }
      console.error(`[HQ Score] Error scoring ${imageUrl.substring(0, 60)}: ${err}`);
      return { score: 0, width: 0, height: 0, sizeKB: 0, buffer: null };
    }
  }
  // All attempts failed
  return { score: 0, width: 0, height: 0, sizeKB: 0, buffer: null };
}

/**
 * Determine the best upscale factor based on current dimensions
 * Target: at least 2000px on the shortest side (e-commerce standard)
 */
function getUpscaleFactor(width: number, height: number): number {
  const minDim = Math.min(width, height);
  const maxDim = Math.max(width, height);
  const totalPixels = width * height;
  
  if (minDim >= 2000) return 0; // Already large enough, no upscale needed
  
  // Real-ESRGAN GPU memory limit: ~2,096,704 pixels max input
  // Skip upscale if the image would exceed GPU memory at any scale factor
  if (minDim >= 1000) {
    // 2x upscale: check if input fits in GPU memory
    if (totalPixels > 2_000_000) return 0; // Too large for GPU, use as-is
    return 2; // 1000-1414 → 2x = 2000-2828
  }
  
  // 4x upscale for small images
  if (totalPixels > 2_000_000) return 2; // Fallback to 2x if too large for 4x
  return 4; // < 1000 → 4x
}

/**
 * Upload a scraped image to S3 and optionally upscale with Real-ESRGAN
 * Returns the final S3 URL and dimensions
 */
async function uploadAndUpscaleImage(
  sku: string,
  buffer: Buffer,
  width: number,
  height: number,
  index: number,
  source: string
): Promise<{ s3Url: string; s3Key: string; width: number; height: number; sizeKB: number; upscaled: boolean } | null> {
  try {
    const ext = 'png'; // Use PNG for best quality
    
    // Determine if upscaling is needed
    const scaleFactor = getUpscaleFactor(width, height);
    
    if (scaleFactor === 0) {
      // Already large enough — upload directly
      const s3Key = `scrapes/${sku}/HQ_${source}_${index}_${width}x${height}_${nanoid(6)}.${ext}`;
      const { url: s3Url } = await storagePut(s3Key, buffer, 'image/png');
      console.log(`[HQ Upload] ✓ Already HQ (${width}x${height}), uploaded directly: ${s3Key}`);
      return { s3Url, s3Key, width, height, sizeKB: buffer.length / 1024, upscaled: false };
    }
    
    // Upload original to S3 first so Real-ESRGAN can access it
    const tempKey = `scrapes/temp_upscale_${nanoid(8)}.${ext}`;
    const { url: tempS3Url } = await storagePut(tempKey, buffer, 'image/png');
    
    // AI upscale with Real-ESRGAN
    console.log(`[HQ Pipeline] Upscaling ${width}x${height} by ${scaleFactor}x...`);
    const upscaledBuffer = await aiUpscale(tempS3Url, scaleFactor);
    
    if (upscaledBuffer && upscaledBuffer.length > buffer.length) {
      // Verify dimensions with sharp if available
      let newW = width * scaleFactor;
      let newH = height * scaleFactor;
      const sharp = await getSharp();
      if (sharp) {
        try {
          const meta = await sharp(upscaledBuffer).metadata();
          newW = meta.width || newW;
          newH = meta.height || newH;
        } catch { /* use calculated */ }
      }
      
      const s3Key = `scrapes/${sku}/HQ_${source}_${index}_${newW}x${newH}_${nanoid(6)}.${ext}`;
      const { url: s3Url } = await storagePut(s3Key, upscaledBuffer, 'image/png');
      console.log(`[HQ Upload] ✓ Upscaled ${width}x${height} → ${newW}x${newH} (${(upscaledBuffer.length / 1024).toFixed(1)}KB): ${s3Key}`);
      return { s3Url, s3Key, width: newW, height: newH, sizeKB: upscaledBuffer.length / 1024, upscaled: true };
    }
    
    // Upscale failed — use the original (already uploaded as temp)
    console.warn(`[HQ Pipeline] Upscale failed, using original ${width}x${height}`);
    const s3Key = `scrapes/${sku}/HQ_${source}_${index}_${width}x${height}_${nanoid(6)}.${ext}`;
    const { url: s3Url } = await storagePut(s3Key, buffer, 'image/png');
    return { s3Url, s3Key, width, height, sizeKB: buffer.length / 1024, upscaled: false };
  } catch (err) {
    console.error(`[HQ Upload] Failed for image ${index}: ${err}`);
    return null;
  }
}

/**
 * FALLBACK: Generate a product image using Forge AI (only when not enough scraped images)
 */
async function generateProductImage(
  referenceImageUrl: string,
  productName: string | null,
  brand: string | null
): Promise<{ buffer: Buffer; width: number; height: number } | null> {
  if (!FORGE_API_URL || !FORGE_API_KEY) {
    console.log('[AI Gen] Forge API not configured, skipping AI generation');
    return null;
  }

  const productDesc = [brand, productName].filter(Boolean).join(' ') || 'this product';
  
  const prompt = `Generate a professional e-commerce product photograph of ${productDesc}. This must be an exact 1:1 faithful reproduction of the product shown in the reference image. Requirements:
- Pure white background (#FFFFFF), absolutely no shadows, no reflections, no gradients
- Product centered in frame, filling approximately 80-85% of the image area
- Preserve ALL labels, text, branding, logos, colors, and packaging details EXACTLY as shown in the reference
- Professional studio lighting: soft, even, diffused light from multiple angles to eliminate all shadows
- Ultra-sharp focus on every detail
- Square 1:1 aspect ratio
- No props, no decorations — product only on pure white`;

  try {
    console.log(`[AI Gen] FALLBACK: Generating image for ${productDesc}...`);
    
    const baseUrl = FORGE_API_URL.endsWith('/') ? FORGE_API_URL : FORGE_API_URL + '/';
    const fullUrl = new URL('images.v1.ImageService/GenerateImage', baseUrl).toString();
    
    const response = await fetch(fullUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'connect-protocol-version': '1',
        authorization: `Bearer ${FORGE_API_KEY}`,
      },
      body: JSON.stringify({
        prompt,
        ...(referenceImageUrl ? {
          original_images: [{
            url: referenceImageUrl,
            mimeType: 'image/jpeg'
          }]
        } : {})
      }),
      signal: AbortSignal.timeout(90000), // 90s hard timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[AI Gen] API error (${response.status}): ${errorText.substring(0, 200)}`);
      return null;
    }

    const result = await response.json() as {
      image: { b64Json: string; mimeType: string };
    };

    if (!result.image?.b64Json) {
      console.error('[AI Gen] No image data in response');
      return null;
    }

    const aiBuffer = Buffer.from(result.image.b64Json, 'base64');
    console.log(`[AI Gen] Generated: 1024x1024, ${(aiBuffer.length / 1024).toFixed(1)}KB`);
    return { buffer: aiBuffer, width: 1024, height: 1024 };
  } catch (err) {
    console.error(`[AI Gen] Error: ${err}`);
    return null;
  }
}

// Minimum number of images we want in the output
const TARGET_IMAGE_COUNT = 3;

/**
 * Main HQ Pipeline - SCRAPE-FIRST with AI fallback
 */
export async function processImagesHQ(
  sku: string,
  scrapedImageUrls: string[],
  productName?: string | null,
  brand?: string | null
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
    // No scraped URLs at all — go straight to AI generation if we have product info
    // Reject garbage product names that would produce nonsensical AI images
    const badNames = new Set(['unknown', 'unknown product', 'no product found', 'not found', 'n/a', 'na', '', 'unable to identify', 'product not found']);
    const nameLower = (productName || '').toLowerCase().trim();
    const isValidProductName = productName && !badNames.has(nameLower) &&
      !nameLower.startsWith('unknown product') && !nameLower.startsWith('no product') &&
      !nameLower.startsWith('unable to') && !nameLower.startsWith('not found') &&
      !nameLower.includes('no matching information') && productName.length > 3;
    if (isValidProductName) {
      console.log(`[HQ Pipeline] No scraped images for ${sku}, attempting full AI generation for: ${productName}`);
      result.processingSteps.push('No scraped images — attempting AI generation from product name...');
      
      const aiStart = Date.now();
      const aiPromises = Array.from({ length: TARGET_IMAGE_COUNT }, () =>
        generateProductImage('', productName || null, brand || null)
      );
      
      const aiResults = await Promise.allSettled(aiPromises);
      
      for (const settled of aiResults) {
        if (settled.status === 'fulfilled' && settled.value) {
          const aiResult = settled.value;
          const uploaded = await uploadAndUpscaleImage(
            sku, aiResult.buffer, aiResult.width, aiResult.height,
            result.images.length + 1, 'ai_generated'
          );
          if (uploaded) {
            result.images.push({
              originalUrl: '',
              processedUrl: uploaded.s3Url,
              width: uploaded.width,
              height: uploaded.height,
              sizeKB: uploaded.sizeKB,
              source: 'ai_generated',
              isHQ: uploaded.width >= 2000 || uploaded.height >= 2000,
              score: 50,
            });
            if (uploaded.upscaled) result.totalCost += 0.002;
          }
        }
      }
      
      const aiElapsed = ((Date.now() - aiStart) / 1000).toFixed(1);
      result.processingSteps.push(`AI generation from product name: ${result.images.length} images in ${aiElapsed}s`);
      console.log(`[HQ Pipeline] AI generation from product name: ${result.images.length} images in ${aiElapsed}s`);
      return result;
    }
    
    result.processingSteps.push('No images to process and no product info for AI generation');
    console.log(`[HQ Pipeline] No images and no product info for SKU ${sku}`);
    return result;
  }
  
  // ===== STEP 1: Pre-filter by URL patterns (FREE, instant) =====
  result.processingSteps.push('Pre-filtering by URL patterns...');
  const preFiltered = preFilterByUrl(scrapedImageUrls);
  console.log(`[HQ Pipeline] Pre-filter: ${scrapedImageUrls.length} → ${preFiltered.length} images`);
  
  const urlsToScore = preFiltered.length > 0 ? preFiltered : scrapedImageUrls;
  if (preFiltered.length === 0) {
    console.log(`[HQ Pipeline] Pre-filter removed all images, using originals as fallback`);
    result.processingSteps.push('Pre-filter fallback: using all original URLs');
  }
  
  // ===== STEP 2: Score images IN PARALLEL (first 25 — wider net for flaky CDNs) =====
  const scoreStart = Date.now();
  result.processingSteps.push('Scoring images...');
  const imagesToScore = urlsToScore.slice(0, 25); // Cast wider net since many CDNs block downloads
  
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
    console.log(`[HQ Pipeline] No images passed score threshold, using fallback`);
    result.processingSteps.push('Score fallback: using any downloaded images');
    scoredImages = scoreResults
      .filter(img => img.buffer !== null && img.sizeKB > 2)
      .sort((a, b) => b.sizeKB - a.sizeKB);
  }
  
  // Deduplicate by similar dimensions (avoid multiple copies of same image at different sizes)
  const deduped: typeof scoredImages = [];
  for (const img of scoredImages) {
    const isDupe = deduped.some(existing => {
      if (img.width > 0 && existing.width > 0) {
        const wRatio = img.width / existing.width;
        const hRatio = img.height / existing.height;
        // Same aspect ratio and similar size = likely same image
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
    // ALL downloads failed — fall through to AI generation below
    console.error(`[HQ Pipeline] CRITICAL: No images could be downloaded for SKU ${sku}, falling back to AI generation`);
    result.processingSteps.push('No images could be downloaded — falling back to AI generation');
  }
  
  // ===== STEP 3: Upload & upscale top scraped images IN PARALLEL =====
  const topImages = scoredImages.slice(0, 4); // Take top 3-4 only
  const upscaleStart = Date.now();
  result.processingSteps.push(`Uploading & upscaling top ${topImages.length} scraped images in parallel...`);
  
  const upscaleResults = await Promise.allSettled(
    topImages.map((img, idx) =>
      uploadAndUpscaleImage(sku, img.buffer!, img.width, img.height, idx + 1, 'scraped')
    )
  );
  
  const upscaleElapsed = ((Date.now() - upscaleStart) / 1000).toFixed(1);
  let upscaledCount = 0;
  
  for (let i = 0; i < upscaleResults.length; i++) {
    const settled = upscaleResults[i];
    if (settled.status === 'fulfilled' && settled.value) {
      const uploaded = settled.value;
      result.images.push({
        originalUrl: topImages[i].url,
        processedUrl: uploaded.s3Url,
        width: uploaded.width,
        height: uploaded.height,
        sizeKB: uploaded.sizeKB,
        source: 'scraper',
        isHQ: uploaded.width >= 2000 || uploaded.height >= 2000,
        score: topImages[i].score,
      });
      if (uploaded.upscaled) upscaledCount++;
      // Cost: ~$0.002 per Real-ESRGAN upscale
      if (uploaded.upscaled) result.totalCost += 0.002;
    }
  }
  
  result.processingSteps.push(`Uploaded ${result.images.length}/${topImages.length} images (${upscaledCount} upscaled) in ${upscaleElapsed}s`);
  console.log(`[HQ Pipeline] Uploaded ${result.images.length} scraped images (${upscaledCount} upscaled) in ${upscaleElapsed}s`);
  
  // ===== STEP 4: FALLBACK — If < TARGET_IMAGE_COUNT, generate AI extras =====
  if (result.images.length > 0 && result.images.length < TARGET_IMAGE_COUNT) {
    const needed = TARGET_IMAGE_COUNT - result.images.length;
    console.log(`[HQ Pipeline] Only ${result.images.length} scraped images, generating ${needed} AI extras as fallback`);
    result.processingSteps.push(`Fallback: generating ${needed} AI images (only ${result.images.length} scraped available)...`);
    
    // Use the best scraped image as reference for AI generation
    const bestRef = result.images[0];
    const aiStart = Date.now();
    
    const aiPromises = Array.from({ length: needed }, () =>
      generateProductImage(bestRef.processedUrl, productName || null, brand || null)
    );
    
    const aiResults = await Promise.allSettled(aiPromises);
    
    for (const settled of aiResults) {
      if (settled.status === 'fulfilled' && settled.value) {
        const aiResult = settled.value;
        // Upload AI image and upscale it too
        const uploaded = await uploadAndUpscaleImage(
          sku, aiResult.buffer, aiResult.width, aiResult.height,
          result.images.length + 1, 'ai_fallback'
        );
        if (uploaded) {
          result.images.push({
            originalUrl: bestRef.processedUrl,
            processedUrl: uploaded.s3Url,
            width: uploaded.width,
            height: uploaded.height,
            sizeKB: uploaded.sizeKB,
            source: 'ai_generated',
            isHQ: uploaded.width >= 2000 || uploaded.height >= 2000,
            score: 70, // AI-generated gets a lower score than real photos
          });
          if (uploaded.upscaled) result.totalCost += 0.002;
        }
      }
    }
    
    const aiElapsed = ((Date.now() - aiStart) / 1000).toFixed(1);
    result.processingSteps.push(`AI fallback: generated ${result.images.length - (topImages.length)} extras in ${aiElapsed}s`);
  } else if (result.images.length === 0) {
    // No scraped images at all — full AI generation as last resort
    console.log(`[HQ Pipeline] No scraped images available, full AI generation fallback`);
    result.processingSteps.push('Full AI fallback: no scraped images, generating from scratch...');
    
    // Use the best scored image URL (even if we couldn't download it) as reference
    const bestUrl = scoredImages[0]?.url || scrapedImageUrls[0];
    const aiStart = Date.now();
    
    const aiPromises = Array.from({ length: TARGET_IMAGE_COUNT }, () =>
      generateProductImage(bestUrl, productName || null, brand || null)
    );
    
    const aiResults = await Promise.allSettled(aiPromises);
    
    for (const settled of aiResults) {
      if (settled.status === 'fulfilled' && settled.value) {
        const aiResult = settled.value;
        const uploaded = await uploadAndUpscaleImage(
          sku, aiResult.buffer, aiResult.width, aiResult.height,
          result.images.length + 1, 'ai_generated'
        );
        if (uploaded) {
          result.images.push({
            originalUrl: bestUrl,
            processedUrl: uploaded.s3Url,
            width: uploaded.width,
            height: uploaded.height,
            sizeKB: uploaded.sizeKB,
            source: 'ai_generated',
            isHQ: uploaded.width >= 2000 || uploaded.height >= 2000,
            score: 60,
          });
          if (uploaded.upscaled) result.totalCost += 0.002;
        }
      }
    }
    
    const aiElapsed = ((Date.now() - aiStart) / 1000).toFixed(1);
    result.processingSteps.push(`Full AI fallback: generated ${result.images.length} images in ${aiElapsed}s`);
  }
  
  result.processingSteps.push(`Pipeline complete: ${result.images.length} images (${result.images.filter(i => i.source === 'scraper').length} scraped, ${result.images.filter(i => i.source === 'ai_generated').length} AI-generated)`);
  console.log(`[HQ Pipeline] Complete: ${result.images.length} images (${result.images.filter(i => i.source === 'scraper').length} scraped, ${result.images.filter(i => i.source === 'ai_generated').length} AI)`);
  
  return result;
}

/**
 * Upload processed HQ images to S3 - IN PARALLEL
 * For images already in S3 (from uploadAndUpscaleImage), just return existing URLs
 */
export async function uploadHQImages(
  sku: string,
  images: ProcessedImage[]
): Promise<{ s3Key: string; s3Url: string; width: number; height: number }[]> {
  if (images.length === 0) {
    console.log(`[HQ Pipeline] No images to upload for SKU ${sku}`);
    return [];
  }
  
  const uploadResults = await Promise.all(
    images.map(async (img, i) => {
      try {
        // Images already uploaded to S3 during the pipeline
        if (img.processedUrl.includes('cloudfront.net') || img.processedUrl.includes('s3.')) {
          const s3Key = img.processedUrl.split('/').slice(-4).join('/'); // Extract key from URL
          console.log(`[HQ Upload] ✓ Already in S3: ${s3Key} (${img.width}x${img.height})`);
          return { s3Key, s3Url: img.processedUrl, width: img.width, height: img.height };
        }
        
        // Download and re-upload if not in S3 yet (shouldn't happen with new pipeline)
        const response = await fetch(img.processedUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(15000),
        });
        
        if (!response.ok) {
          console.error(`[HQ Upload] HTTP ${response.status} downloading ${img.processedUrl.substring(0, 60)}`);
          return null;
        }
        
        const buffer = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        
        let ext = 'jpg';
        if (contentType.includes('png')) ext = 'png';
        else if (contentType.includes('webp')) ext = 'webp';
        
        const s3Key = `scrapes/${sku}/HQ_${img.source}_${i + 1}_${nanoid(6)}.${ext}`;
        const { url } = await storagePut(s3Key, buffer, contentType);
        
        console.log(`[HQ Upload] ✓ ${s3Key} (${img.width}x${img.height}, ${img.sizeKB.toFixed(1)}KB)`);
        return { s3Key, s3Url: url, width: img.width, height: img.height };
      } catch (error) {
        console.error(`[HQ Upload] Failed for image ${i + 1}: ${error}`);
        return null;
      }
    })
  );
  
  const successful = uploadResults.filter((r): r is NonNullable<typeof r> => r !== null);
  console.log(`[HQ Upload] ${successful.length}/${images.length} images uploaded successfully`);
  return successful;
}
