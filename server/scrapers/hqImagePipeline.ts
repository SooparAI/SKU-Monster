/**
 * HQ Image Processing Pipeline - RESILIENT VERSION
 * 
 * Strategy:
 * 1. Pre-filter URLs by pattern (FREE, instant)
 * 2. Score images in PARALLEL - works with or without sharp (FREE, ~2-3s total)
 * 3. Upscale top 3 images SEQUENTIALLY (~10-15s total)
 * 4. Upload to S3
 * 
 * Key resilience features:
 * - Works without sharp (falls back to size-only scoring)
 * - Works without Replicate (skips upscaling, uses originals)
 * - If all images fail scoring, uses them anyway
 * - Comprehensive error logging for debugging
 * 
 * Target: <30s total, <$0.002 per SKU
 */

import { storagePut } from '../storage';
import { nanoid } from 'nanoid';

// Try to import sharp - it may not be available in all environments
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
    console.warn('[HQ Pipeline] sharp not available, using fallback scoring (size-only)');
    sharpModule = null;
  }
  return sharpModule;
}

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
// IMPORTANT: Use exact parameter matches (w=50&) to avoid false positives like w=500 matching w=50
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
 * More lenient: accepts common image formats including dynamic image servers
 */
function preFilterByUrl(urls: string[]): string[] {
  return urls.filter(url => {
    const urlLower = url.toLowerCase();
    for (const pattern of NON_PRODUCT_PATTERNS) {
      if (urlLower.includes(pattern)) return false;
    }
    // Accept URLs with image extensions OR dynamic image servers (like Bloomingdale's .tif?fmt=jpeg)
    const hasImageExt = /\.(jpg|jpeg|png|webp|tif|tiff)(\?|$)/i.test(url);
    const hasImageParam = /fmt=(jpeg|jpg|png|webp)/i.test(url);
    const hasImageContentHint = /\/images?\//i.test(url) || /\/media\//i.test(url);
    if (!hasImageExt && !hasImageParam && !hasImageContentHint) return false;
    return true;
  });
}

/**
 * Score an image - downloads once and returns buffer for reuse
 * Works with or without sharp module
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
      signal: AbortSignal.timeout(10000), // 10s timeout per image
    });
    
    if (!response.ok) {
      console.log(`[HQ Score] HTTP ${response.status} for ${imageUrl.substring(0, 60)}...`);
      return { score: 0, width: 0, height: 0, sizeKB: 0, buffer: null };
    }
    
    const buffer = Buffer.from(await response.arrayBuffer());
    const sizeKB = buffer.length / 1024;
    
    let width = 0;
    let height = 0;
    let score = 50; // Base score
    
    // Try to get dimensions with sharp
    const sharp = await getSharp();
    if (sharp) {
      try {
        const metadata = await sharp(buffer).metadata();
        width = metadata.width || 0;
        height = metadata.height || 0;
      } catch (e) {
        console.log(`[HQ Score] sharp metadata failed for ${imageUrl.substring(0, 60)}: ${e}`);
      }
    }
    
    // File size scoring (works without sharp)
    if (sizeKB < 2) score -= 50;       // Tiny = probably icon
    else if (sizeKB < 10) score -= 20;  // Small = probably thumbnail
    else if (sizeKB >= 200) score += 30; // Large = likely product photo
    else if (sizeKB >= 50) score += 15;  // Medium = reasonable
    
    // Dimension scoring (only if sharp available)
    if (width > 0 && height > 0) {
      if (width < 200 || height < 200) score -= 40;
      else if (width >= 800 && height >= 800) score += 30;
      else if (width >= 500 && height >= 500) score += 15;
      
      // Aspect ratio (perfume bottles are square/portrait)
      const aspectRatio = width / height;
      if (aspectRatio >= 0.6 && aspectRatio <= 1.2) score += 20;
      else if (aspectRatio > 2.5 || aspectRatio < 0.4) score -= 30;
    } else {
      // No dimensions available - give benefit of doubt based on file size
      if (sizeKB >= 30) score += 10;
    }
    
    // URL pattern scoring (works without sharp)
    const urlLower = imageUrl.toLowerCase();
    for (const pattern of PRODUCT_PATTERNS) {
      if (urlLower.includes(pattern)) { score += 5; break; }
    }
    
    // Quick content analysis (only if sharp available)
    if (sharp) {
      try {
        const stats = await sharp(buffer).stats();
        const channels = stats.channels;
        const avgStdDev = channels.reduce((sum: number, ch: any) => sum + ch.stdev, 0) / channels.length;
        if (avgStdDev < 10) score -= 30;
        else if (avgStdDev > 40) score += 10;
        
        const avgMean = channels.reduce((sum: number, ch: any) => sum + ch.mean, 0) / channels.length;
        if (avgMean > 200 && avgStdDev > 30) score += 15;
      } catch { /* ignore stats errors */ }
    }
    
    const finalScore = Math.max(0, Math.min(100, score));
    console.log(`[HQ Score] ${finalScore}: ${imageUrl.substring(0, 60)}... (${width}x${height}, ${sizeKB.toFixed(1)}KB)`);
    return { score: finalScore, width, height, sizeKB, buffer };
  } catch (err) {
    console.error(`[HQ Score] Error scoring ${imageUrl.substring(0, 60)}: ${err}`);
    return { score: 0, width: 0, height: 0, sizeKB: 0, buffer: null };
  }
}

/**
 * Upscale image using Real-ESRGAN via Replicate API
 */
async function upscaleImage(imageUrl: string, scale: number = 4): Promise<string | null> {
  if (!REPLICATE_API_TOKEN) return null;
  
  const MAX_RETRIES = 2;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const waitTime = 3000 + attempt * 3000; // 3s, 6s
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
 * Main HQ Pipeline - RESILIENT with fallbacks
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
  console.log(`[HQ Pipeline] sharp available: ${!!sharpModule}, Replicate available: ${!!REPLICATE_API_TOKEN}`);
  
  if (scrapedImageUrls.length === 0) {
    result.processingSteps.push('No images to process');
    return result;
  }
  
  // Step 1: Pre-filter by URL patterns (FREE, instant)
  result.processingSteps.push('Pre-filtering by URL patterns...');
  const preFiltered = preFilterByUrl(scrapedImageUrls);
  console.log(`[HQ Pipeline] Pre-filter: ${scrapedImageUrls.length} → ${preFiltered.length} images`);
  
  // FALLBACK: If pre-filter removes everything, use all original URLs
  const urlsToScore = preFiltered.length > 0 ? preFiltered : scrapedImageUrls;
  if (preFiltered.length === 0) {
    console.log(`[HQ Pipeline] Pre-filter removed all images, using originals as fallback`);
    result.processingSteps.push('Pre-filter fallback: using all original URLs');
  }
  
  // Step 2: Score images IN PARALLEL (only first 10 to save time)
  result.processingSteps.push('Scoring images...');
  const imagesToScore = urlsToScore.slice(0, 10);
  
  const scoreResults = await Promise.all(
    imagesToScore.map(async (url) => {
      const scoreResult = await scoreImage(url);
      return { url, ...scoreResult };
    })
  );
  
  // Filter and sort by score
  let scoredImages = scoreResults
    .filter(img => img.score >= 40 && img.buffer !== null)
    .sort((a, b) => b.score - a.score);
  
  // FALLBACK: If no images pass scoring, use any that downloaded successfully
  if (scoredImages.length === 0) {
    console.log(`[HQ Pipeline] No images passed score threshold, using fallback (any downloaded image)`);
    result.processingSteps.push('Score fallback: using any successfully downloaded images');
    scoredImages = scoreResults
      .filter(img => img.buffer !== null && img.sizeKB > 2) // Just needs to be downloaded and not tiny
      .sort((a, b) => b.sizeKB - a.sizeKB); // Sort by size (bigger = probably better)
  }
  
  for (const img of scoredImages) {
    console.log(`[HQ Pipeline] ✓ Score ${img.score}: ${img.url.substring(0, 60)}... (${img.width}x${img.height}, ${img.sizeKB.toFixed(1)}KB)`);
  }
  
  // Take top 3
  const topImages = scoredImages.slice(0, 3);
  console.log(`[HQ Pipeline] Selected top ${topImages.length} images`);
  result.processingSteps.push(`Selected ${topImages.length} best images (scores: ${topImages.map(i => i.score).join(', ')})`);
  
  if (topImages.length === 0) {
    result.processingSteps.push('No images could be downloaded');
    console.error(`[HQ Pipeline] CRITICAL: No images could be downloaded for SKU ${sku}`);
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
  
  // Step 4: Upscale images SEQUENTIALLY to avoid rate limits
  if (needUpscale.length > 0 && REPLICATE_API_TOKEN) {
    result.processingSteps.push(`Upscaling ${needUpscale.length} images...`);
    console.log(`[HQ Pipeline] Upscaling ${needUpscale.length} images sequentially...`);
    
    const upscaleResults: { img: typeof needUpscale[0]; upscaledUrl: string | null }[] = [];
    for (const img of needUpscale) {
      const upscaledUrl = await upscaleImage(img.url, 4);
      upscaleResults.push({ img, upscaledUrl });
    }
    
    // Process upscaled results
    const processedUpscales = await Promise.all(
      upscaleResults.map(async ({ img, upscaledUrl }) => {
        if (upscaledUrl) {
          try {
            const response = await fetch(upscaledUrl);
            const buffer = Buffer.from(await response.arrayBuffer());
            let upWidth = 0;
            let upHeight = 0;
            const sizeKB = buffer.length / 1024;
            
            // Try sharp for metadata, fallback to estimated dimensions
            const sharpForMeta = await getSharp();
            if (sharpForMeta) {
              try {
                const metadata = await sharpForMeta(buffer).metadata();
                upWidth = metadata.width || 0;
                upHeight = metadata.height || 0;
              } catch { /* ignore */ }
            }
            
            // Estimate dimensions if sharp not available
            if (upWidth === 0 && img.width > 0) {
              upWidth = img.width * 4;
              upHeight = img.height * 4;
            }
            
            console.log(`[HQ Pipeline] Upscaled: ${upWidth}x${upHeight}, ${sizeKB.toFixed(1)}KB`);
            
            return {
              originalUrl: img.url,
              processedUrl: upscaledUrl,
              width: upWidth,
              height: upHeight,
              sizeKB,
              source: 'upscaled' as const,
              isHQ: true,
              score: img.score,
            };
          } catch (err) {
            console.error(`[HQ Pipeline] Failed to process upscaled image: ${err}`);
            // Fall back to original
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
        // Upscale failed - use original
        console.log(`[HQ Pipeline] Upscale failed for ${img.url.substring(0, 60)}, using original`);
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
    console.log(`[HQ Pipeline] Skipping upscaling - ${!REPLICATE_API_TOKEN ? 'no Replicate API token' : 'not needed'}`);
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
  if (images.length === 0) {
    console.log(`[HQ Pipeline] No images to upload for SKU ${sku}`);
    return [];
  }
  
  const uploadResults = await Promise.all(
    images.map(async (img, i) => {
      try {
        const response = await fetch(img.processedUrl, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
          signal: AbortSignal.timeout(15000), // 15s timeout for download
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
