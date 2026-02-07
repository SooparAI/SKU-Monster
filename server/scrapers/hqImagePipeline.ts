/**
 * HQ Image Processing Pipeline - AI GENERATION VERSION
 * 
 * Strategy:
 * 1. Pre-filter URLs by pattern (FREE, instant)
 * 2. Score images in PARALLEL - works with or without sharp (FREE, ~2-3s total)
 * 3. Pick the BEST reference image
 * 4. Generate clean product image via AI (Forge ImageService) at 1024x1024
 * 5. AI upscale 1024→4096 via Replicate Real-ESRGAN (~$0.002/image, ~4s)
 * 6. Upload to S3
 * 
 * Key features:
 * - Uses AI to generate clean white-background product photos from scraped references
 * - Real-ESRGAN neural network upscaling preserves text, logos, and fine details
 * - Output is retailer-ready (Amazon, Walmart, eBay compliant)
 * - Falls back to sharp lanczos3 if Real-ESRGAN unavailable, then 1024x1024
 * - Falls back to original scraped images if AI generation fails
 * - Comprehensive error logging for debugging
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
  try {
    const replicate = new Replicate({ auth: REPLICATE_TOKEN });
    console.log(`[AI Upscale] Upscaling ${scale}x via Real-ESRGAN: ${imageUrl.substring(0, 60)}...`);
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
    console.error(`[AI Upscale] Real-ESRGAN failed: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

// Forge API config (from environment)
const FORGE_API_URL = process.env.BUILT_IN_FORGE_API_URL || '';
const FORGE_API_KEY = process.env.BUILT_IN_FORGE_API_KEY || '';

interface ProcessedImage {
  originalUrl: string;
  processedUrl: string;
  width: number;
  height: number;
  sizeKB: number;
  source: 'scraper' | 'ai_generated';
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
      signal: AbortSignal.timeout(10000),
    });
    
    if (!response.ok) {
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
    
    // Dimension scoring
    if (width > 0 && height > 0) {
      if (width < 200 || height < 200) score -= 40;
      else if (width >= 800 && height >= 800) score += 30;
      else if (width >= 500 && height >= 500) score += 15;
      
      const aspectRatio = width / height;
      if (aspectRatio >= 0.6 && aspectRatio <= 1.2) score += 20;
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
        if (avgMean > 200 && avgStdDev > 30) score += 15;
      } catch { /* ignore */ }
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
 * Generate a clean 4K product image using AI (Forge ImageService)
 * Takes a reference image URL and generates a retailer-ready product photo
 */
async function generateProductImage(
  referenceImageUrl: string,
  productName: string | null,
  brand: string | null,
  variant: 'main' | 'angle' | 'detail'
): Promise<{ buffer: Buffer; width: number; height: number } | null> {
  if (!FORGE_API_URL || !FORGE_API_KEY) {
    console.log('[AI Gen] Forge API not configured, skipping AI generation');
    return null;
  }

  const productDesc = [brand, productName].filter(Boolean).join(' ') || 'this product';
  
  // Different prompts for different angles/variants
  const prompts: Record<string, string> = {
    main: `Generate a professional e-commerce product photograph of ${productDesc}. This must be an exact 1:1 faithful reproduction of the product shown in the reference image. Requirements:
- Pure white background (#FFFFFF), absolutely no shadows, no reflections, no gradients
- Product centered in frame, filling approximately 80-85% of the image area
- Preserve ALL labels, text, branding, logos, colors, and packaging details EXACTLY as shown in the reference
- Professional studio lighting: soft, even, diffused light from multiple angles to eliminate all shadows
- Ultra-sharp focus on every detail of the product
- Square 1:1 aspect ratio
- Suitable for Amazon, Walmart, eBay, and all major retailer product listings
- No props, no lifestyle elements, no decorations, no surface — product only floating on pure white`,

    angle: `Generate a professional e-commerce product photograph of ${productDesc} from a slightly different angle than the reference image. Requirements:
- Pure white background (#FFFFFF), no shadows, no reflections
- Show the product from a 30-45 degree angle to reveal depth and side details
- Preserve ALL branding, text, colors, and design elements exactly as the original product
- Professional studio lighting, ultra-sharp focus
- Square 1:1 aspect ratio
- Retailer-compliant product photography standard
- No props, no background elements — product only on pure white`,

    detail: `Generate a professional e-commerce product photograph of ${productDesc} showing a close-up detail view. Requirements:
- Pure white background (#FFFFFF), no shadows
- Focus on the product's key distinguishing features (cap, label, texture, branding details)
- Preserve ALL text, logos, and design elements with perfect accuracy
- Macro-style professional studio photography
- Square 1:1 aspect ratio
- Ultra-sharp, high detail rendering
- No props — product detail only on pure white`,
  };

  const prompt = prompts[variant] || prompts.main;

  try {
    console.log(`[AI Gen] Generating ${variant} image for ${productDesc}...`);
    
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
        original_images: [{
          url: referenceImageUrl,
          mimeType: 'image/jpeg'
        }]
      }),
      signal: AbortSignal.timeout(90000), // 90s hard timeout for AI image generation
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
    console.log(`[AI Gen] Generated ${variant}: 1024x1024, ${(aiBuffer.length / 1024).toFixed(1)}KB`);

    // Upload 1024x1024 to S3 first so Real-ESRGAN can access it
    const tempKey = `scrapes/temp_upscale_${nanoid(8)}.png`;
    const { url: tempS3Url } = await storagePut(tempKey, aiBuffer, 'image/png');
    console.log(`[AI Gen] Temp upload for upscaling: ${tempS3Url.substring(0, 60)}...`);

    // AI upscale with Real-ESRGAN (4x = 1024→4096)
    const upscaledBuffer = await aiUpscale(tempS3Url, 4);
    if (upscaledBuffer && upscaledBuffer.length > aiBuffer.length) {
      // Verify dimensions with sharp if available
      let w = 4096, h = 4096;
      const sharp = await getSharp();
      if (sharp) {
        try {
          const meta = await sharp(upscaledBuffer).metadata();
          w = meta.width || 4096;
          h = meta.height || 4096;
        } catch { /* use defaults */ }
      }
      console.log(`[AI Gen] Real-ESRGAN upscaled to ${w}x${h}, ${(upscaledBuffer.length / 1024).toFixed(1)}KB`);
      return { buffer: upscaledBuffer, width: w, height: h };
    }

    // Fallback: try sharp lanczos3 if Real-ESRGAN failed
    const sharp2 = await getSharp();
    if (sharp2) {
      try {
        const upscaled = await sharp2(aiBuffer)
          .resize(4096, 4096, { kernel: 'lanczos3', fit: 'fill' })
          .png({ quality: 100, compressionLevel: 6 })
          .toBuffer();
        console.log(`[AI Gen] Sharp fallback upscale to 4096x4096, ${(upscaled.length / 1024).toFixed(1)}KB`);
        return { buffer: upscaled, width: 4096, height: 4096 };
      } catch (e) {
        console.warn(`[AI Gen] Sharp upscale also failed: ${e}`);
      }
    }

    // Last resort: return 1024x1024
    console.warn(`[AI Gen] No upscaling available, returning 1024x1024`);
    return { buffer: aiBuffer, width: 1024, height: 1024 };
  } catch (err) {
    console.error(`[AI Gen] Error generating ${variant} image: ${err}`);
    return null;
  }
}

/**
 * Main HQ Pipeline - AI GENERATION with fallbacks
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
  
  if (scrapedImageUrls.length === 0) {
    result.processingSteps.push('No images to process');
    return result;
  }
  
  // Step 1: Pre-filter by URL patterns (FREE, instant)
  result.processingSteps.push('Pre-filtering by URL patterns...');
  const preFiltered = preFilterByUrl(scrapedImageUrls);
  console.log(`[HQ Pipeline] Pre-filter: ${scrapedImageUrls.length} → ${preFiltered.length} images`);
  
  const urlsToScore = preFiltered.length > 0 ? preFiltered : scrapedImageUrls;
  if (preFiltered.length === 0) {
    console.log(`[HQ Pipeline] Pre-filter removed all images, using originals as fallback`);
    result.processingSteps.push('Pre-filter fallback: using all original URLs');
  }
  
  // Step 2: Score images IN PARALLEL (first 10)
  const scoreStart = Date.now();
  result.processingSteps.push('Scoring images...');
  const imagesToScore = urlsToScore.slice(0, 10);
  
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
  
  for (const img of scoredImages) {
    console.log(`[HQ Pipeline] ✓ Score ${img.score}: ${img.url.substring(0, 60)}... (${img.width}x${img.height}, ${img.sizeKB.toFixed(1)}KB)`);
  }
  
  if (scoredImages.length === 0) {
    result.processingSteps.push('No images could be downloaded');
    console.error(`[HQ Pipeline] CRITICAL: No images could be downloaded for SKU ${sku}`);
    return result;
  }
  
  // Step 3: Pick the best reference image for AI generation
  const bestRef = scoredImages[0];
  console.log(`[HQ Pipeline] Best reference: ${bestRef.url.substring(0, 80)}... (score: ${bestRef.score})`);
  
  // First, upload the best reference to S3 so the AI API can access it reliably
  let referenceUrl = bestRef.url;
  if (bestRef.buffer) {
    try {
      const refKey = `scrapes/${sku}/ref_${nanoid(6)}.jpg`;
      const { url: s3RefUrl } = await storagePut(refKey, bestRef.buffer, 'image/jpeg');
      referenceUrl = s3RefUrl;
      console.log(`[HQ Pipeline] Reference uploaded to S3: ${s3RefUrl.substring(0, 60)}...`);
    } catch (e) {
      console.warn(`[HQ Pipeline] Failed to upload reference to S3, using original URL: ${e}`);
    }
  }
  
  // Step 4: Generate AI product images (3 variants) IN PARALLEL
  const variants: Array<'main' | 'angle' | 'detail'> = ['main', 'angle', 'detail'];
  result.processingSteps.push('Generating 3 AI product images in parallel (each: Forge gen ~15s + S3 upload + Real-ESRGAN upscale ~4-60s)...');
  
  const aiStartTime = Date.now();
  const aiResults = await Promise.allSettled(
    variants.map(variant => generateProductImage(referenceUrl, productName || null, brand || null, variant))
  );
  const aiElapsed = ((Date.now() - aiStartTime) / 1000).toFixed(1);
  console.log(`[HQ Pipeline] AI generation + upscaling completed in ${aiElapsed}s`);
  result.processingSteps.push(`AI gen + upscale completed in ${aiElapsed}s`);
  
  let aiSuccessCount = 0;
  
  // Upload all successful AI images to S3 in parallel
  const uploadPromises = aiResults.map(async (settled, idx) => {
    const variant = variants[idx];
    if (settled.status === 'rejected' || !settled.value) {
      console.warn(`[HQ Pipeline] AI generation failed for ${variant} variant`);
      return;
    }
    const aiResult = settled.value;
    try {
      const s3Key = `scrapes/${sku}/AI_${variant}_${aiResult.width}x${aiResult.height}_${nanoid(6)}.png`;
      const { url: s3Url } = await storagePut(s3Key, aiResult.buffer, 'image/png');
      
      result.images.push({
        originalUrl: referenceUrl,
        processedUrl: s3Url,
        width: aiResult.width,
        height: aiResult.height,
        sizeKB: aiResult.buffer.length / 1024,
        source: 'ai_generated',
        isHQ: true,
        score: 100,
      });
      
      aiSuccessCount++;
      console.log(`[HQ Pipeline] ✓ AI ${variant}: ${aiResult.width}x${aiResult.height}, ${(aiResult.buffer.length / 1024).toFixed(1)}KB → ${s3Key}`);
    } catch (err) {
      console.error(`[HQ Pipeline] Failed to upload AI ${variant} image: ${err}`);
    }
  });
  
  await Promise.allSettled(uploadPromises);
  result.processingSteps.push(`AI generated ${aiSuccessCount}/3 images in ${((Date.now() - aiStartTime) / 1000).toFixed(1)}s`);
  
  // Step 5: Fallback - if AI generation failed, upload best scraped images directly
  if (result.images.length === 0) {
    console.log(`[HQ Pipeline] AI generation failed, falling back to scraped images`);
    result.processingSteps.push('AI fallback: using original scraped images');
    
    const topImages = scoredImages.slice(0, 3);
    for (const img of topImages) {
      result.images.push({
        originalUrl: img.url,
        processedUrl: img.url,
        width: img.width,
        height: img.height,
        sizeKB: img.sizeKB,
        source: 'scraper',
        isHQ: img.width >= 1500 || img.height >= 1500,
        score: img.score,
      });
    }
  }
  
  result.processingSteps.push(`Pipeline complete: ${result.images.length} images (${aiSuccessCount} AI-generated)`);
  console.log(`[HQ Pipeline] Complete: ${result.images.length} images (${aiSuccessCount} AI-generated)`);
  
  return result;
}

/**
 * Upload processed HQ images to S3 - IN PARALLEL
 * For AI-generated images, they're already uploaded, so we just return the existing URLs
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
        // AI-generated images are already uploaded to S3 during generation
        if (img.source === 'ai_generated' && img.processedUrl.includes('cloudfront.net')) {
          const s3Key = img.processedUrl.split('/').slice(-3).join('/'); // Extract key from URL
          console.log(`[HQ Upload] ✓ AI image already in S3: ${s3Key} (${img.width}x${img.height})`);
          return { s3Key, s3Url: img.processedUrl, width: img.width, height: img.height };
        }
        
        // Download and re-upload scraped images
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
