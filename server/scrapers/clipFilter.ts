/**
 * CLIP-based Image Filtering using Replicate API
 * Filters out non-product images (logos, banners, icons, etc.)
 * 
 * Cost: ~$0.001 per image on CPU
 */

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN || '';

interface ClipResult {
  isProduct: boolean;
  confidence: number;
  label: string;
}

// Labels for classification
const PRODUCT_LABELS = [
  'a product photo of a perfume bottle',
  'a fragrance bottle on white background',
  'a cologne or perfume product image',
  'a cosmetic product photograph',
];

const NON_PRODUCT_LABELS = [
  'a website logo or icon',
  'a banner or advertisement',
  'a payment method icon',
  'a navigation menu or button',
  'a person or model photo',
  'a lifestyle or background image',
];

/**
 * Use CLIP to classify if an image is a product photo
 * Returns confidence score (0-1) that it's a product image
 */
export async function classifyWithClip(imageUrl: string): Promise<ClipResult> {
  if (!REPLICATE_API_TOKEN) {
    console.log('[CLIP] API token not configured, skipping classification');
    return { isProduct: true, confidence: 0.5, label: 'unknown' };
  }

  try {
    const allLabels = [...PRODUCT_LABELS, ...NON_PRODUCT_LABELS];
    
    // Use CLIP model on Replicate
    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Token ${REPLICATE_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // Using openai/clip-vit-large-patch14 via Replicate
        version: 'a9758cbfbd5f3c2094457d996681af52552901775aa2d6dd0b17fd15df959bef',
        input: {
          image: imageUrl,
          text: allLabels.join('|'),
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Replicate API error: ${response.status}`);
    }

    const prediction = await response.json();
    
    // Poll for result
    let result = prediction;
    while (result.status === 'starting' || result.status === 'processing') {
      await new Promise(resolve => setTimeout(resolve, 500));
      const pollResponse = await fetch(result.urls.get, {
        headers: { 'Authorization': `Token ${REPLICATE_API_TOKEN}` },
      });
      result = await pollResponse.json();
    }

    if (result.status !== 'succeeded') {
      throw new Error(`CLIP prediction failed: ${result.status}`);
    }

    // Parse CLIP output - it returns similarity scores for each label
    const scores = result.output;
    
    // Find the highest scoring label
    let maxScore = 0;
    let maxLabel = '';
    let isProduct = false;
    
    if (Array.isArray(scores)) {
      scores.forEach((score: number, index: number) => {
        if (score > maxScore) {
          maxScore = score;
          maxLabel = allLabels[index];
          isProduct = index < PRODUCT_LABELS.length;
        }
      });
    }

    console.log(`[CLIP] Image classified as "${maxLabel}" with confidence ${maxScore.toFixed(3)}`);
    
    return {
      isProduct,
      confidence: maxScore,
      label: maxLabel,
    };
  } catch (error) {
    console.error('[CLIP] Classification error:', error);
    // On error, assume it's a product to avoid filtering good images
    return { isProduct: true, confidence: 0.5, label: 'error' };
  }
}

/**
 * Batch filter images using CLIP
 * Returns only images classified as product photos with confidence > threshold
 */
export async function filterProductImages(
  imageUrls: string[],
  confidenceThreshold: number = 0.6
): Promise<{ url: string; confidence: number }[]> {
  console.log(`[CLIP] Filtering ${imageUrls.length} images...`);
  
  const results: { url: string; confidence: number }[] = [];
  
  // Process in parallel batches of 5 to avoid rate limiting
  const batchSize = 5;
  for (let i = 0; i < imageUrls.length; i += batchSize) {
    const batch = imageUrls.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map(async (url) => {
        const result = await classifyWithClip(url);
        return { url, ...result };
      })
    );
    
    for (const result of batchResults) {
      if (result.isProduct && result.confidence >= confidenceThreshold) {
        results.push({ url: result.url, confidence: result.confidence });
      } else {
        console.log(`[CLIP] Filtered out: ${result.url} (${result.label}, ${result.confidence.toFixed(3)})`);
      }
    }
  }
  
  console.log(`[CLIP] Kept ${results.length}/${imageUrls.length} images as product photos`);
  return results;
}

/**
 * Simple heuristic-based pre-filter to reduce CLIP API calls
 * Filters out obvious non-product images based on URL patterns
 */
export function preFilterByUrl(imageUrls: string[]): string[] {
  const nonProductPatterns = [
    /logo/i,
    /icon/i,
    /banner/i,
    /badge/i,
    /payment/i,
    /visa|mastercard|amex|paypal/i,
    /sprite/i,
    /avatar/i,
    /profile/i,
    /social/i,
    /facebook|twitter|instagram|pinterest/i,
    /arrow|chevron|caret/i,
    /button/i,
    /nav/i,
    /menu/i,
    /header|footer/i,
    /\d+x\d+/i, // Tiny dimension indicators like 50x50
  ];
  
  const filtered = imageUrls.filter(url => {
    const urlLower = url.toLowerCase();
    for (const pattern of nonProductPatterns) {
      if (pattern.test(urlLower)) {
        console.log(`[PreFilter] Removed by URL pattern: ${url}`);
        return false;
      }
    }
    return true;
  });
  
  console.log(`[PreFilter] Kept ${filtered.length}/${imageUrls.length} images after URL filtering`);
  return filtered;
}
