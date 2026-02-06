/**
 * HQ Image Processing Pipeline - CHEAP VERSION
 * 
 * Strategy:
 * 1. Smart filtering using image heuristics (FREE)
 * 2. Score and rank images to find the 2-3 best product images
 * 3. Upscale only the top 2-3 images to 4K (~$0.001 total)
 * 
 * Target cost: <$0.002 per SKU
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

// Non-product URL patterns to filter out (comprehensive list)
const NON_PRODUCT_PATTERNS = [
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
  // Banner/promo
  'banner', 'promo', 'ad-', 'advertisement',
  // Cart/checkout
  'cart', 'checkout', 'bag',
  // Recommendation section indicators in URLs
  'similar', 'recommend', 'related', 'also-like', 'you-may',
  'recently-viewed', 'cross-sell', 'upsell',
];

// Product-positive URL patterns
const PRODUCT_PATTERNS = [
  'product', 'item', 'perfume', 'fragrance', 'cologne', 'eau', 'spray',
  'bottle', 'main', 'hero', 'primary', 'large', 'zoom', 'full', 'hires',
];

/**
 * Pre-filter URLs by pattern (FREE - no API calls)
 */
function preFilterByUrl(urls: string[]): string[] {
  return urls.filter(url => {
    const urlLower = url.toLowerCase();
    
    // Reject if contains non-product patterns
    for (const pattern of NON_PRODUCT_PATTERNS) {
      if (urlLower.includes(pattern)) {
        return false;
      }
    }
    
    // Must have image extension
    if (!/\.(jpg|jpeg|png|webp)(\?|$)/i.test(url)) {
      return false;
    }
    
    return true;
  });
}

/**
 * Score an image based on multiple factors (FREE - local analysis)
 * Higher score = more likely to be a good product image
 */
async function scoreImage(imageUrl: string): Promise<{
  score: number;
  width: number;
  height: number;
  sizeKB: number;
  reasons: string[];
}> {
  const reasons: string[] = [];
  let score = 50; // Base score
  
  try {
    const response = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
      signal: AbortSignal.timeout(10000),
    });
    
    if (!response.ok) {
      return { score: 0, width: 0, height: 0, sizeKB: 0, reasons: ['Failed to fetch'] };
    }
    
    const buffer = Buffer.from(await response.arrayBuffer());
    const sizeKB = buffer.length / 1024;
    
    // Get image metadata
    const metadata = await sharp(buffer).metadata();
    const { width = 0, height = 0 } = metadata;
    
    // === SIZE SCORING ===
    
    // File size scoring
    if (sizeKB < 5) {
      score -= 50;
      reasons.push('Too small file (<5KB)');
    } else if (sizeKB < 15) {
      score -= 20;
      reasons.push('Small file (<15KB)');
    } else if (sizeKB >= 50) {
      score += 15;
      reasons.push('Good file size (50KB+)');
    } else if (sizeKB >= 100) {
      score += 25;
      reasons.push('Large file size (100KB+)');
    }
    
    // Dimension scoring
    if (width < 200 || height < 200) {
      score -= 40;
      reasons.push('Dimensions too small');
    } else if (width >= 800 && height >= 800) {
      score += 30;
      reasons.push('Large dimensions (800px+)');
    } else if (width >= 500 && height >= 500) {
      score += 15;
      reasons.push('Good dimensions (500px+)');
    }
    
    // === ASPECT RATIO SCORING ===
    const aspectRatio = width / height;
    
    // Perfume bottles are usually portrait or square
    if (aspectRatio >= 0.6 && aspectRatio <= 1.2) {
      score += 20;
      reasons.push('Good aspect ratio (square/portrait)');
    } else if (aspectRatio > 2.5 || aspectRatio < 0.4) {
      score -= 30;
      reasons.push('Bad aspect ratio (likely banner)');
    }
    
    // === URL PATTERN SCORING ===
    const urlLower = imageUrl.toLowerCase();
    
    // Positive patterns
    for (const pattern of PRODUCT_PATTERNS) {
      if (urlLower.includes(pattern)) {
        score += 5;
        reasons.push(`URL contains "${pattern}"`);
      }
    }
    
    // === IMAGE CONTENT ANALYSIS ===
    try {
      const stats = await sharp(buffer).stats();
      const channels = stats.channels;
      const avgStdDev = channels.reduce((sum, ch) => sum + ch.stdev, 0) / channels.length;
      
      // Low variance = likely placeholder or solid color
      if (avgStdDev < 10) {
        score -= 30;
        reasons.push('Low color variance (placeholder?)');
      } else if (avgStdDev > 40) {
        score += 10;
        reasons.push('Good color variance');
      }
      
      // Check for white/light background (common for product photos)
      const avgMean = channels.reduce((sum, ch) => sum + ch.mean, 0) / channels.length;
      if (avgMean > 200 && avgStdDev > 30) {
        score += 15;
        reasons.push('Light background with detail (product photo style)');
      }
    } catch {
      // Stats analysis failed, continue without it
    }
    
    return { score: Math.max(0, Math.min(100, score)), width, height, sizeKB, reasons };
    
  } catch (error) {
    return { score: 0, width: 0, height: 0, sizeKB: 0, reasons: [`Error: ${error}`] };
  }
}

/**
 * Upscale image using Real-ESRGAN via Replicate API
 */
async function upscaleImage(imageUrl: string, scale: number = 4): Promise<string | null> {
  if (!REPLICATE_API_TOKEN) {
    console.log('[Upscale] No Replicate API token configured');
    return null;
  }
  
  try {
    console.log(`[Upscale] Starting upscale for: ${imageUrl.substring(0, 60)}...`);
    
    // Create prediction
    const createResponse = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        version: 'f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa', // Real-ESRGAN
        input: {
          image: imageUrl,
          scale: scale,
          face_enhance: false,
        },
      }),
    });
    
    if (!createResponse.ok) {
      const error = await createResponse.text();
      console.error(`[Upscale] Failed to create prediction: ${error}`);
      return null;
    }
    
    const prediction = await createResponse.json();
    const predictionId = prediction.id;
    
    // Poll for completion (max 60 seconds)
    for (let i = 0; i < 30; i++) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
        headers: {
          'Authorization': `Token ${REPLICATE_API_TOKEN}`,
        },
      });
      
      const status = await statusResponse.json();
      
      if (status.status === 'succeeded') {
        console.log(`[Upscale] Success: ${status.output}`);
        return status.output;
      } else if (status.status === 'failed') {
        console.error(`[Upscale] Failed: ${status.error}`);
        return null;
      }
    }
    
    console.error('[Upscale] Timeout waiting for upscale');
    return null;
    
  } catch (error) {
    console.error(`[Upscale] Error: ${error}`);
    return null;
  }
}

/**
 * Main HQ Pipeline - Process images cheaply
 * 
 * Steps:
 * 1. Pre-filter by URL patterns (FREE)
 * 2. Score and rank images (FREE - local analysis)
 * 3. Take top 2-3 images
 * 4. Upscale only those 2-3 images (~$0.001)
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
  
  // Step 1: Pre-filter by URL patterns (FREE)
  result.processingSteps.push('Pre-filtering by URL patterns...');
  const preFiltered = preFilterByUrl(scrapedImageUrls);
  console.log(`[HQ Pipeline] Pre-filter: ${scrapedImageUrls.length} → ${preFiltered.length} images`);
  
  if (preFiltered.length === 0) {
    result.processingSteps.push('No valid images after pre-filtering');
    return result;
  }
  
  // Step 2: Score and rank images (FREE - local analysis)
  result.processingSteps.push('Scoring images...');
  const scoredImages: { url: string; score: number; width: number; height: number; sizeKB: number }[] = [];
  
  // Only analyze first 15 images to save time
  for (const url of preFiltered.slice(0, 15)) {
    const scoreResult = await scoreImage(url);
    if (scoreResult.score >= 40) { // Minimum threshold
      scoredImages.push({
        url,
        score: scoreResult.score,
        width: scoreResult.width,
        height: scoreResult.height,
        sizeKB: scoreResult.sizeKB,
      });
      console.log(`[HQ Pipeline] ✓ Score ${scoreResult.score}: ${url.substring(0, 60)}... (${scoreResult.width}x${scoreResult.height}, ${scoreResult.sizeKB.toFixed(1)}KB)`);
    } else {
      console.log(`[HQ Pipeline] ✗ Score ${scoreResult.score} (too low): ${url.substring(0, 60)}...`);
    }
  }
  
  // Sort by score descending
  scoredImages.sort((a, b) => b.score - a.score);
  
  // Take top 3 images
  const topImages = scoredImages.slice(0, 3);
  console.log(`[HQ Pipeline] Selected top ${topImages.length} images for processing`);
  result.processingSteps.push(`Selected ${topImages.length} best images (scores: ${topImages.map(i => i.score).join(', ')})`);
  
  if (topImages.length === 0) {
    result.processingSteps.push('No images passed quality threshold');
    return result;
  }
  
  // Step 3: Check which images need upscaling
  const imagesToUpscale: typeof topImages = [];
  
  for (const img of topImages) {
    // If already large enough (1500px+) and decent file size, keep as-is
    if ((img.width >= 1500 || img.height >= 1500) && img.sizeKB >= 80) {
      console.log(`[HQ Pipeline] Already HQ: ${img.width}x${img.height}, ${img.sizeKB.toFixed(1)}KB`);
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
    } else {
      imagesToUpscale.push(img);
    }
  }
  
  // Step 4: Upscale images that need it (only 2-3 max)
  if (imagesToUpscale.length > 0 && REPLICATE_API_TOKEN) {
    result.processingSteps.push(`Upscaling ${imagesToUpscale.length} images to 4K...`);
    console.log(`[HQ Pipeline] Upscaling ${imagesToUpscale.length} images...`);
    
    for (const img of imagesToUpscale) {
      const upscaledUrl = await upscaleImage(img.url, 4);
      
      if (upscaledUrl) {
        try {
          // Download upscaled image and get dimensions
          const response = await fetch(upscaledUrl);
          const buffer = Buffer.from(await response.arrayBuffer());
          const metadata = await sharp(buffer).metadata();
          const sizeKB = buffer.length / 1024;
          
          result.images.push({
            originalUrl: img.url,
            processedUrl: upscaledUrl,
            width: metadata.width || 0,
            height: metadata.height || 0,
            sizeKB,
            source: 'upscaled',
            isHQ: true,
            score: img.score,
          });
          
          result.totalCost += 0.0004; // Real-ESRGAN cost estimate
          console.log(`[HQ Pipeline] Upscaled: ${metadata.width}x${metadata.height}, ${sizeKB.toFixed(1)}KB`);
        } catch (error) {
          console.error(`[HQ Pipeline] Error processing upscaled image: ${error}`);
          // Fall back to original
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
      } else {
        // Upscaling failed, use original
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
  } else if (imagesToUpscale.length > 0) {
    result.processingSteps.push('Upscaling skipped (no Replicate API token)');
    console.log('[HQ Pipeline] Skipping upscaling - no Replicate API token configured');
    
    // Add original images without upscaling
    for (const img of imagesToUpscale) {
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
 * Upload processed HQ images to S3
 */
export async function uploadHQImages(
  sku: string,
  images: ProcessedImage[]
): Promise<{ s3Key: string; s3Url: string; width: number; height: number }[]> {
  const uploaded: { s3Key: string; s3Url: string; width: number; height: number }[] = [];
  
  for (let i = 0; i < images.length; i++) {
    const img = images[i];
    try {
      const response = await fetch(img.processedUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      
      if (!response.ok) continue;
      
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || 'image/jpeg';
      
      let ext = 'jpg';
      if (contentType.includes('png')) ext = 'png';
      else if (contentType.includes('webp')) ext = 'webp';
      
      const s3Key = `scrapes/${sku}/HQ_${img.source}_${i + 1}_${nanoid(6)}.${ext}`;
      const { url } = await storagePut(s3Key, buffer, contentType);
      
      uploaded.push({
        s3Key,
        s3Url: url,
        width: img.width,
        height: img.height,
      });
      
      console.log(`[HQ Pipeline] Uploaded: ${s3Key} (${img.width}x${img.height}, ${img.sizeKB.toFixed(1)}KB)`);
    } catch (error) {
      console.error(`[HQ Pipeline] Failed to upload image: ${error}`);
    }
  }
  
  return uploaded;
}
