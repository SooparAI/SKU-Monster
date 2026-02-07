/**
 * Image Search - Uses Perplexity API to find product info + retailer URLs,
 * then extracts images from those retailer pages.
 * 
 * This approach works reliably on deployed servers where Google/eBay/Amazon
 * block direct search page scraping. Perplexity API does the web search for us,
 * returns retailer URLs, and we fetch images from those specific product pages.
 */

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const PERPLEXITY_TIMEOUT_MS = 25000; // 25s for Perplexity API
const PAGE_FETCH_TIMEOUT_MS = 12000; // 12s for retailer page fetches

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || "";
export interface ImageSearchResult {
  imageUrls: string[];
  productName: string;
  brand: string;
  source: string;
}

// Non-product URL patterns to filter out
const EXCLUDE_PATTERNS: readonly string[] = [
  'logo', 'icon', 'sprite', 'button', 'arrow', 'chevron',
  'close', 'search', 'menu', 'header', 'footer', 'nav',
  'pixel', 'tracking', '1x1', 'spacer', 'beacon',
  'facebook', 'twitter', 'instagram', 'tiktok', 'youtube', 'pinterest',
  'payment', 'visa', 'mastercard', 'paypal', 'amex', 'klarna',
  'trust', 'certificate', 'badge', 'verified',
  'avatar', 'profile', 'user-',
  'promo', 'ad-', 'advertisement', 'banner',
  'cart', 'checkout', 'shipping',
  'placeholder', 'loading', 'blank', 'empty', 'no-image',
  'favicon', 'apple-touch',
];

/**
 * Extract image URLs from HTML, filtering out non-product images
 */
function extractImagesFromHtml(html: string, pageUrl: string): string[] {
  // Match image URLs in src, data-src, content attributes
  const imgRegex = /https?:\/\/[^"'\s\\<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s\\<>]*)?/gi;
  const allUrls: string[] = html.match(imgRegex) || [];

  // Also extract og:image
  const ogMatch = html.match(/property="og:image"\s+content="([^"]+)"/i) ||
                  html.match(/content="([^"]+)"\s+property="og:image"/i);
  if (ogMatch && ogMatch[1]) {
    allUrls.unshift(ogMatch[1]); // Prioritize og:image
  }

  // Filter and deduplicate
  const seen = new Set<string>();
  const filtered: string[] = [];

  for (const url of allUrls) {
    const lower = url.toLowerCase();
    
    // Skip excluded patterns
    if (EXCLUDE_PATTERNS.some(p => lower.includes(p))) continue;
    
    // Skip very short URLs (likely tracking pixels)
    if (url.length < 30) continue;
    
    // Skip data URIs
    if (lower.startsWith('data:')) continue;
    
    // Normalize and deduplicate
    const normalized = url.split('?')[0]; // Remove query params for dedup
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    
    filtered.push(url);
  }

  return filtered;
}

/**
 * Use Perplexity API to identify product and find retailer URLs
 */
async function perplexityProductSearch(sku: string): Promise<{
  productName: string;
  brand: string;
  description: string;
  retailerUrls: string[];
  imageUrls: string[];
}> {
  if (!PERPLEXITY_API_KEY) {
    console.log('[ImageSearch] Perplexity API key not configured');
    return { productName: '', brand: '', description: '', retailerUrls: [], imageUrls: [] };
  }

  try {
    console.log(`[ImageSearch] Perplexity search for SKU: ${sku}`);
    
    const resp = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PERPLEXITY_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: `You are a product identification assistant. Given a barcode/UPC/EAN number, identify the product. Return ONLY valid JSON with these fields:
{
  "productName": "full product name",
  "brand": "brand name",
  "description": "brief visual description of the product packaging/bottle/box for image generation",
  "retailerUrls": ["up to 5 retailer product page URLs where this product can be found"]
}
Return ONLY the JSON object, no markdown, no explanation.`
          },
          {
            role: 'user',
            content: `Identify the product with barcode/UPC: ${sku}`
          }
        ],
      }),
      signal: AbortSignal.timeout(PERPLEXITY_TIMEOUT_MS),
    });

    if (!resp.ok) {
      console.error(`[ImageSearch] Perplexity API error: ${resp.status}`);
      return { productName: '', brand: '', description: '', retailerUrls: [], imageUrls: [] };
    }

    const data = await resp.json() as any;
    const content = data.choices?.[0]?.message?.content || '';
    
    // Extract JSON from response (might have markdown wrapping)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[ImageSearch] Perplexity response not JSON:', content.substring(0, 200));
      // Try to extract product name from plain text
      return { productName: content.substring(0, 100), brand: '', description: content, retailerUrls: [], imageUrls: [] };
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    // Also extract image URLs from Perplexity's citations/search results if available
    const imageUrls: string[] = [];
    
    console.log(`[ImageSearch] Perplexity identified: ${parsed.productName} by ${parsed.brand} (${(parsed.retailerUrls || []).length} retailer URLs)`);
    
    return {
      productName: parsed.productName || '',
      brand: parsed.brand || '',
      description: parsed.description || '',
      retailerUrls: (parsed.retailerUrls || []).slice(0, 5),
      imageUrls,
    };
  } catch (error) {
    console.error(`[ImageSearch] Perplexity error: ${error}`);
    return { productName: '', brand: '', description: '', retailerUrls: [], imageUrls: [] };
  }
}

/**
 * Fetch images from a retailer product page URL
 */
async function fetchRetailerPageImages(url: string): Promise<string[]> {
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
      redirect: 'follow',
    });

    if (!resp.ok) {
      console.log(`[ImageSearch] Retailer page ${resp.status}: ${url.substring(0, 60)}`);
      return [];
    }

    const html = await resp.text();
    const images = extractImagesFromHtml(html, url);
    console.log(`[ImageSearch] Retailer page: ${images.length} images from ${url.substring(0, 60)}`);
    return images;
  } catch (error) {
    console.log(`[ImageSearch] Retailer page error: ${url.substring(0, 60)} - ${error instanceof Error ? error.message : error}`);
    return [];
  }
}

/**
 * Use Forge LLM as backup product identification
 */
async function llmProductIdentify(sku: string): Promise<{
  productName: string;
  brand: string;
  description: string;
}> {
  const FORGE_API_URL = process.env.BUILT_IN_FORGE_API_URL || '';
  const FORGE_API_KEY = process.env.BUILT_IN_FORGE_API_KEY || '';
  
  if (!FORGE_API_URL || !FORGE_API_KEY) {
    return { productName: '', brand: '', description: '' };
  }

  try {
    const url = FORGE_API_URL.replace(/\/$/, '') + '/v1/chat/completions';
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${FORGE_API_KEY}`,
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'system',
            content: 'You identify products from barcodes. Return ONLY JSON: {"productName":"...","brand":"...","description":"visual description of product packaging"}'
          },
          {
            role: 'user',
            content: `What product has barcode ${sku}? Return JSON only.`
          }
        ],
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) return { productName: '', brand: '', description: '' };
    
    const data = await resp.json() as any;
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { productName: '', brand: '', description: '' };
    
    const parsed = JSON.parse(jsonMatch[0]);
    console.log(`[ImageSearch] LLM identified: ${parsed.productName} by ${parsed.brand}`);
    return {
      productName: parsed.productName || '',
      brand: parsed.brand || '',
      description: parsed.description || '',
    };
  } catch (error) {
    console.error(`[ImageSearch] LLM identify error: ${error}`);
    return { productName: '', brand: '', description: '' };
  }
}

/**
 * Run the full image search pipeline:
 * 1. Perplexity API → product info + retailer URLs
 * 2. Fetch images from retailer pages in parallel
 * 3. LLM fallback for product identification if Perplexity fails
 * 
 * Returns combined unique image URLs and product info
 */
export async function searchAllImageSources(
  sku: string,
  existingProductName?: string | null
): Promise<{
  imageUrls: string[];
  productName: string;
  brand: string;
  description: string;
  sources: Record<string, number>;
}> {
  console.log(`[ImageSearch] Starting search for SKU: ${sku}${existingProductName ? ` (known: ${existingProductName})` : ''}`);
  const startTime = Date.now();
  const sources: Record<string, number> = {};
  const allImageUrls: string[] = [];
  
  let productName = existingProductName || '';
  let brand = '';
  let description = '';

  // Step 1: Perplexity search for product identification + retailer URLs
  const perplexityResult = await perplexityProductSearch(sku);
  
  if (perplexityResult.productName) {
    productName = perplexityResult.productName;
    brand = perplexityResult.brand;
    description = perplexityResult.description;
  }

  // Step 2: Fetch images from retailer URLs in parallel
  if (perplexityResult.retailerUrls.length > 0) {
    console.log(`[ImageSearch] Fetching images from ${perplexityResult.retailerUrls.length} retailer pages...`);
    
    const retailerResults = await Promise.allSettled(
      perplexityResult.retailerUrls.map(url => fetchRetailerPageImages(url))
    );

    for (const result of retailerResults) {
      if (result.status === 'fulfilled') {
        allImageUrls.push(...result.value);
      }
    }
    
    sources.retailers = allImageUrls.length;
    console.log(`[ImageSearch] Retailer pages: ${allImageUrls.length} images total`);
  }

  // Step 3: If Perplexity didn't identify the product, use LLM as fallback
  if (!productName && !existingProductName) {
    console.log(`[ImageSearch] Perplexity didn't identify product, trying LLM...`);
    const llmResult = await llmProductIdentify(sku);
    if (llmResult.productName) {
      productName = llmResult.productName;
      brand = llmResult.brand;
      description = llmResult.description;
    }
  }

  // Deduplicate all URLs
  const unique = Array.from(new Set(allImageUrls));
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log(`[ImageSearch] Complete in ${elapsed}s: ${unique.length} unique images, product: "${productName}" by "${brand}"`);

  return {
    imageUrls: unique,
    productName: productName || '',
    brand: brand || '',
    description: description || '',
    sources,
  };
}

// Keep legacy exports for backward compatibility but they now just call the main function
export async function searchProductImages(sku: string, productName?: string | null): Promise<ImageSearchResult> {
  const result = await searchAllImageSources(sku, productName);
  return {
    imageUrls: result.imageUrls,
    productName: result.productName,
    brand: result.brand,
    source: 'perplexity',
  };
}

export async function searchEbayImages(_sku: string, _productName?: string | null): Promise<string[]> {
  return []; // No longer used - Perplexity handles everything
}

export async function searchRetailerImages(_sku: string, _productName?: string | null): Promise<string[]> {
  return []; // No longer used - Perplexity handles everything
}
