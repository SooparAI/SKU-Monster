/**
 * Real-ESRGAN Image Upscaling using Replicate API
 * Upscales images to 4K quality
 * 
 * Cost: ~$0.0004 per image on T4 GPU (~1.8 seconds per image)
 */

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || '';

interface UpscaleResult {
  success: boolean;
  originalUrl: string;
  upscaledUrl: string | null;
  scale: number;
  error?: string;
}

/**
 * Upscale an image using Real-ESRGAN
 * @param imageUrl - URL of the image to upscale
 * @param scale - Upscale factor (2 or 4, default 4 for 4K output)
 */
export async function upscaleImage(imageUrl: string, scale: number = 4): Promise<UpscaleResult> {
  if (!REPLICATE_API_TOKEN) {
    console.log('[Upscaler] API token not configured, returning original');
    return { success: false, originalUrl: imageUrl, upscaledUrl: null, scale, error: 'No API token' };
  }

  try {
    console.log(`[Upscaler] Upscaling image ${scale}x: ${imageUrl}`);
    
    // Use Real-ESRGAN model on Replicate (nightmareai/real-esrgan)
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Real-ESRGAN model version
        version: '42fed1c4974146d4d2414e2be2c5277c7fcf05fcc3a73abf41610695738c1d7b',
        input: {
          image: imageUrl,
          scale: scale,
          face_enhance: false, // Not needed for product images
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Replicate API error: ${response.status} - ${errorText}`);
    }

    const prediction = await response.json();
    
    // Poll for result (typically takes 1-3 seconds)
    let result = prediction;
    let attempts = 0;
    const maxAttempts = 60; // 30 seconds max wait
    
    while ((result.status === 'starting' || result.status === 'processing') && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 500));
      const pollResponse = await fetch(result.urls.get, {
        headers: { 'Authorization': `Token ${REPLICATE_API_TOKEN}` },
      });
      result = await pollResponse.json();
      attempts++;
    }

    if (result.status !== 'succeeded') {
      throw new Error(`Upscaling failed: ${result.status} - ${result.error || 'Unknown error'}`);
    }

    const upscaledUrl = result.output;
    console.log(`[Upscaler] Successfully upscaled to: ${upscaledUrl}`);
    
    return {
      success: true,
      originalUrl: imageUrl,
      upscaledUrl,
      scale,
    };
  } catch (error) {
    console.error(`[Upscaler] Error upscaling image:`, error);
    return {
      success: false,
      originalUrl: imageUrl,
      upscaledUrl: null,
      scale,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Batch upscale multiple images
 * Processes in parallel batches to optimize cost and speed
 */
export async function batchUpscale(
  imageUrls: string[],
  scale: number = 4,
  maxConcurrent: number = 3
): Promise<UpscaleResult[]> {
  console.log(`[Upscaler] Batch upscaling ${imageUrls.length} images at ${scale}x...`);
  
  const results: UpscaleResult[] = [];
  
  // Process in parallel batches
  for (let i = 0; i < imageUrls.length; i += maxConcurrent) {
    const batch = imageUrls.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(
      batch.map(url => upscaleImage(url, scale))
    );
    results.push(...batchResults);
  }
  
  const successful = results.filter(r => r.success).length;
  console.log(`[Upscaler] Successfully upscaled ${successful}/${imageUrls.length} images`);
  
  return results;
}

/**
 * Smart upscale - only upscale if image is below target resolution
 * Saves cost by not upscaling already-large images
 */
export async function smartUpscale(
  imageUrl: string,
  targetWidth: number = 2000, // 4K-ish
  targetHeight: number = 2000
): Promise<UpscaleResult> {
  try {
    // First, check the image dimensions
    const response = await fetch(imageUrl);
    const buffer = await response.arrayBuffer();
    
    // Try to get dimensions from the image
    const uint8Array = new Uint8Array(buffer);
    const dimensions = getImageDimensions(uint8Array);
    
    if (dimensions) {
      const { width, height } = dimensions;
      console.log(`[Upscaler] Original dimensions: ${width}x${height}`);
      
      // If already large enough, skip upscaling
      if (width >= targetWidth || height >= targetHeight) {
        console.log(`[Upscaler] Image already at target resolution, skipping upscale`);
        return {
          success: true,
          originalUrl: imageUrl,
          upscaledUrl: imageUrl, // Return original
          scale: 1,
        };
      }
      
      // Calculate optimal scale factor
      const scaleX = Math.ceil(targetWidth / width);
      const scaleY = Math.ceil(targetHeight / height);
      const scale = Math.min(Math.max(scaleX, scaleY), 4); // Max 4x
      
      return upscaleImage(imageUrl, scale);
    }
    
    // If can't determine dimensions, default to 4x upscale
    return upscaleImage(imageUrl, 4);
  } catch (error) {
    console.error('[Upscaler] Error in smart upscale:', error);
    return upscaleImage(imageUrl, 4);
  }
}

/**
 * Get image dimensions from buffer (supports JPEG, PNG, WebP)
 */
function getImageDimensions(buffer: Uint8Array): { width: number; height: number } | null {
  // JPEG
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xFF) break;
      const marker = buffer[offset + 1];
      if (marker === 0xC0 || marker === 0xC2) {
        const height = (buffer[offset + 5] << 8) | buffer[offset + 6];
        const width = (buffer[offset + 7] << 8) | buffer[offset + 8];
        return { width, height };
      }
      const length = (buffer[offset + 2] << 8) | buffer[offset + 3];
      offset += 2 + length;
    }
  }
  
  // PNG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    const width = (buffer[16] << 24) | (buffer[17] << 16) | (buffer[18] << 8) | buffer[19];
    const height = (buffer[20] << 24) | (buffer[21] << 16) | (buffer[22] << 8) | buffer[23];
    return { width, height };
  }
  
  // WebP
  if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
    // VP8
    if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x20) {
      const width = ((buffer[26] | (buffer[27] << 8)) & 0x3FFF);
      const height = ((buffer[28] | (buffer[29] << 8)) & 0x3FFF);
      return { width, height };
    }
    // VP8L
    if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x4C) {
      const bits = buffer[21] | (buffer[22] << 8) | (buffer[23] << 16) | (buffer[24] << 24);
      const width = (bits & 0x3FFF) + 1;
      const height = ((bits >> 14) & 0x3FFF) + 1;
      return { width, height };
    }
    // VP8X
    if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x58) {
      const width = ((buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)) & 0xFFFFFF) + 1;
      const height = ((buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)) & 0xFFFFFF) + 1;
      return { width, height };
    }
  }
  
  return null;
}
