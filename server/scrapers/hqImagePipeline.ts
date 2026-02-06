/**
 * HQ Image Processing Pipeline - OPTIMIZED
 * 
 * Strategy:
 * 1. Pre-filter URLs by pattern (FREE, instant)
 * 2. Score images in PARALLEL (FREE, ~2-3s total)
 * 3. Upscale top 3 images in PARALLEL (~10-15s total)
 * 4. Upload to S3
 * 
 * Target: <30s total, <$0.002 per SKU
 */

import { storagePut } from '../storage';
import { nanoid } from 'nanoid';
import sharp from 'sharp';

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || '';

interface ProcessedImage {
  originalUrl: string;
  processedUrl: string;
  width: number;
  height: number;
  sizeKB: number;
  source: 'scraper' | 'upscaled';
  isHQ: boolean;
  score: number;
}

interface HQPipelineResult {
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
  'close', 'search', 'menu', 'nav', 'header', 'footer',
  'thumb', 'thumbnail', '_xs', '_sm', '_tiny', 'mini',
  'w=50', 'w=100', 'w=150', 'h=50', 'h=100', 'h=150',
  '50x50', '100x100', '150x150',
  'placeholder', 'loading', 'lazy', 'blank', 'empty',
  'no-image', 'coming-soon', 'out-of-stock', 'sold-out',
  'payment', 'visa', 'mastercard', 'paypal', 'amex', 'klarna', 'tabby',
  'trust', 'secure', 'ssl', 'certificate', 'badge', 'verified',
  'social', 'facebook', 'twitter', 'instagram', 'tiktok', 'youtube', 'pinterest',
  'pixel', 'tracking', '1x1', 'spacer', 'beacon',
  'star', 'rating', 'review',
  'shipping', 'delivery', 'return', 'guarantee',
  'avatar', 'profile', 'user',
  'banner', 'promo', 'ad-', 'advertisement',
  'cart', 'checkout', 'bag',
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
    if (!/\.(jpg|jpeg|png|webp)(\?|$)/i.test(url)) return false;
    return true;
  });
}

/**
 * Score an image - downloads once and returns buffer for reuse
 */
async function scoreImage(imageUrl: string): Promise<{
  score: number;
  width: number;
  height: number;
  sizeKB: number;
  buffer: Buffer | null;
}> {
  try {
    const response = await fetch(imageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(8000), // 8s timeout per image
    });
    
    if (!response.ok) return { score: 0, width: 0, height: 0, sizeKB: 0, buffer: null };
    
    const buffer = Buffer.from(await response.arrayBuffer());
    const sizeKB = buffer.length / 1024;
    
    const metadata = await sharp(buffer).metadata();
    const { width = 0, height = 0 } = metadata;
    
    let score = 50;
    
    // File size scoring
    if (sizeKB < 5) score -= 50;
    else if (sizeKB < 15) score -= 20;
    else if (sizeKB >= 100) score += 25;
    else if (sizeKB >= 50) score += 15;
    
    // Dimension scoring
    if (width < 200 || height < 200) score -= 40;
    else if (width >= 800 && height >= 800) score += 30;
    else if (width >= 500 && height >= 500) score += 15;
    
    // Aspect ratio (perfume bottles are square/portrait)
    const aspectRatio = width / height;
    if (aspectRatio >= 0.6 && aspectRatio <= 1.2) score += 20;
    else if (aspectRatio > 2.5 || aspectRatio < 0.4) score -= 30;
    
    // URL pattern scoring
    const urlLower = imageUrl.toLowerCase();
    for (const pattern of PRODUCT_PATTERNS) {
      if (urlLower.includes(pattern)) { score += 5; break; }
    }
    
    // Quick content analysis
    try {
      const stats = await sharp(buffer).stats();
      const channels = stats.channels;
      const avgStdDev = channels.reduce((sum, ch) => sum + ch.stdev, 0) / channels.length;
      if (avgStdDev < 10) score -= 30;
      else if (avgStdDev > 40) score += 10;
      
      const avgMean = channels.reduce((sum, ch) => sum + ch.mean, 0) / channels.length;
      if (avgMean > 200 && avgStdDev > 30) score += 15;
    } catch { /* ignore */ }
    
    return { score: Math.max(0, Math.min(100, score)), width, height, sizeKB, buffer };
  } catch {
    return { score: 0, width: 0, height: 0, sizeKB: 0, buffer: null };
  }
}

/**
 * Upscale image using Real-ESRGAN via Replicate API
 */
async function upscaleImage(imageUrl: string, scale: number = 4): Promise<string | null> {
  if (!REPLICATE_API_TOKEN) return null;
  
  const MAX_RETRIES = 3;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const waitTime = 10000 + attempt * 5000; // 10s, 15s, 20s
        console.log(`[Upscale] Retry ${attempt}/${MAX_RETRIES}, waiting ${waitTime/1000}s...`);
        await new Promise(r => setTimeout(r, waitTime));
      }
      
      console.log(`[Upscale] Starting: ${imageUrl.substring(0, 60)}...`);
      
      const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${REPLICATE_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          version: 'f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa',
          input: { image: imageUrl, scale, face_enhance: false },
        }),
      });
      
      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        if (createResponse.status === 429 && attempt < MAX_RETRIES - 1) {
          console.log(`[Upscale] Rate limited, will retry...`);
          continue;
        }
        console.error(`[Upscale] Create failed: ${errorText}`);
        return null;
      }
    
    const prediction = await createResponse.json();
    
    // Poll for completion (max 45 seconds)
    for (let i = 0; i < 22; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { 'Authorization': `Token ${REPLICATE_API_TOKEN}` },
      });
      
      const status = await statusResponse.json();
      
      if (status.status === 'succeeded') {
        console.log(`[Upscale] Done: ${status.output}`);
        return status.output;
      } else if (status.status === 'failed') {
        console.error(`[Upscale] Failed: ${status.error}`);
        return null;
      }
    }
    
    console.error('[Upscale] Timeout');
    return null;
    } catch (error) {
      console.error(`[Upscale] Error: ${error}`);
      if (attempt < MAX_RETRIES - 1) continue;
      return null;
    }
  }
  return null;
}

/**
 * Main HQ Pipeline - OPTIMIZED with parallel processing
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
  
  console.log(`[HQ Pipeline] Processing ${scrapedImageUrls.length} images for SKU ${sku}`);
  
  // Step 1: Pre-filter by URL patterns (FREE, instant)
  result.processingSteps.push('Pre-filtering by URL patterns...');
  const preFiltered = preFilterByUrl(scrapedImageUrls);
  console.log(`[HQ Pipeline] Pre-filter: ${scrapedImageUrls.length} → ${preFiltered.length} images`);
  
  if (preFiltered.length === 0) {
    result.processingSteps.push('No valid images after pre-filtering');
    return result;
  }
  
  // Step 2: Score images IN PARALLEL (only first 10 to save time)
  result.processingSteps.push('Scoring images...');
  const imagesToScore = preFiltered.slice(0, 10);
  
  const scoreResults = await Promise.all(
    imagesToScore.map(async (url) => {
      const scoreResult = await scoreImage(url);
      return { url, ...scoreResult };
    })
  );
  
  // Filter and sort by score
  const scoredImages = scoreResults
    .filter(img => img.score >= 40 && img.buffer !== null)
    .sort((a, b) => b.score - a.score);
  
  for (const img of scoredImages) {
    console.log(`[HQ Pipeline] ✓ Score ${img.score}: ${img.url.substring(0, 60)}... (${img.width}x${img.height}, ${img.sizeKB.toFixed(1)}KB)`);
  }
  
  // Take top 3
  const topImages = scoredImages.slice(0, 3);
  console.log(`[HQ Pipeline] Selected top ${topImages.length} images`);
  result.processingSteps.push(`Selected ${topImages.length} best images (scores: ${topImages.map(i => i.score).join(', ')})`);
  
  if (topImages.length === 0) {
    result.processingSteps.push('No images passed quality threshold');
    return result;
  }
  
  // Step 3: Separate HQ images from those needing upscale
  const alreadyHQ: typeof topImages = [];
  const needUpscale: typeof topImages = [];
  
  for (const img of topImages) {
    if ((img.width >= 1500 || img.height >= 1500) && img.sizeKB >= 80) {
      console.log(`[HQ Pipeline] Already HQ: ${img.width}x${img.height}`);
      alreadyHQ.push(img);
    } else {
      needUpscale.push(img);
    }
  }
  
  // Add already-HQ images
  for (const img of alreadyHQ) {
    result.images.push({
      originalUrl: img.url,
      processedUrl: img.url,
      width: img.width,
      height: img.height,
      sizeKB: img.sizeKB,
      source: 'scraper',
      isHQ: true,
      score: img.score,
    });
  }
  
  // Step 4: Upscale images IN PARALLEL
  if (needUpscale.length > 0 && REPLICATE_API_TOKEN) {
    result.processingSteps.push(`Upscaling ${needUpscale.length} images in parallel...`);
    console.log(`[HQ Pipeline] Upscaling ${needUpscale.length} images in parallel...`);
    
    const upscaleResults = await Promise.all(
      needUpscale.map(async (img) => {
        const upscaledUrl = await upscaleImage(img.url, 4);
        return { img, upscaledUrl };
      })
    );
    
    // Process upscaled results in parallel too
    const processedUpscales = await Promise.all(
      upscaleResults.map(async ({ img, upscaledUrl }) => {
        if (upscaledUrl) {
          try {
            const response = await fetch(upscaledUrl);
            const buffer = Buffer.from(await response.arrayBuffer());
            const metadata = await sharp(buffer).metadata();
            const sizeKB = buffer.length / 1024;
            
            console.log(`[HQ Pipeline] Upscaled: ${metadata.width}x${metadata.height}, ${sizeKB.toFixed(1)}KB`);
            
            return {
              originalUrl: img.url,
              processedUrl: upscaledUrl,
              width: metadata.width || 0,
              height: metadata.height || 0,
              sizeKB,
              source: 'upscaled' as const,
              isHQ: true,
              score: img.score,
            };
          } catch {
            return {
              originalUrl: img.url,
              processedUrl: img.url,
              width: img.width,
              height: img.height,
              sizeKB: img.sizeKB,
              source: 'scraper' as const,
              isHQ: false,
              score: img.score,
            };
          }
        }
        return {
          originalUrl: img.url,
          processedUrl: img.url,
          width: img.width,
          height: img.height,
          sizeKB: img.sizeKB,
          source: 'scraper' as const,
          isHQ: false,
          score: img.score,
        };
      })
    );
    
    for (const processed of processedUpscales) {
      result.images.push(processed);
      if (processed.source === 'upscaled') result.totalCost += 0.0004;
    }
  } else if (needUpscale.length > 0) {
    console.log('[HQ Pipeline] Skipping upscaling - no Replicate API token');
    for (const img of needUpscale) {
      result.images.push({
        originalUrl: img.url,
        processedUrl: img.url,
        width: img.width,
        height: img.height,
        sizeKB: img.sizeKB,
        source: 'scraper',
        isHQ: false,
        score: img.score,
      });
    }
  }
  
  result.processingSteps.push(`Pipeline complete: ${result.images.length} images, cost: $${result.totalCost.toFixed(4)}`);
  console.log(`[HQ Pipeline] Complete: ${result.images.length} images, cost: $${result.totalCost.toFixed(4)}`);
  
  return result;
}

/**
 * Upload processed HQ images to S3 - IN PARALLEL
 */
export async function uploadHQImages(
  sku: string,
  images: ProcessedImage[]
): Promise<{ s3Key: string; s3Url: string; width: number; height: number }[]> {
  const uploadResults = await Promise.all(
    images.map(async (img, i) => {
      try {
        const response = await fetch(img.processedUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        
        if (!response.ok) return null;
        
        const buffer = Buffer.from(await response.arrayBuffer());
        const contentType = response.headers.get('content-type') || 'image/jpeg';
        
        let ext = 'jpg';
        if (contentType.includes('png')) ext = 'png';
        else if (contentType.includes('webp')) ext = 'webp';
        
        const s3Key = `scrapes/${sku}/HQ_${img.source}_${i + 1}_${nanoid(6)}.${ext}`;
        const { url } = await storagePut(s3Key, buffer, contentType);
        
        console.log(`[HQ Pipeline] Uploaded: ${s3Key} (${img.width}x${img.height}, ${img.sizeKB.toFixed(1)}KB)`);
        return { s3Key, s3Url: url, width: img.width, height: img.height };
      } catch (error) {
        console.error(`[HQ Pipeline] Upload failed: ${error}`);
        return null;
      }
    })
  );
  
  return uploadResults.filter((r): r is NonNullable<typeof r> => r !== null);
}
