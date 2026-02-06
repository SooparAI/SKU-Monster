/**
 * Image Search Fallback - Uses Perplexity API to find product image URLs
 * No browser required - pure HTTP API calls
 * 
 * Used when UPC database doesn't return enough images
 */

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";

export interface ImageSearchResult {
  imageUrls: string[];
  productName: string;
  source: string;
}

/**
 * Search for product images using Perplexity AI
 * Returns direct image URLs that can be downloaded without a browser
 */
export async function searchProductImages(sku: string): Promise<ImageSearchResult> {
  const result: ImageSearchResult = {
    imageUrls: [],
    productName: "",
    source: "perplexity",
  };

  if (!PERPLEXITY_API_KEY) {
    console.log("[ImageSearch] No Perplexity API key, skipping");
    return result;
  }

  try {
    console.log(`[ImageSearch] Searching for product images: ${sku}`);

    const response = await fetch(PERPLEXITY_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${PERPLEXITY_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "sonar",
        messages: [
          {
            role: "system",
            content: `You are a product image finder. Given a UPC/EAN/SKU code, find the product and return DIRECT image URLs from retailer websites. 
Return ONLY high-quality product photos (not thumbnails, not icons).
Focus on large/high-resolution images from major retailers like Sephora, Nordstrom, FragranceNet, Macy's, etc.
For each image URL, make sure it's a direct link to the image file (ending in .jpg, .jpeg, .png, .webp or containing image parameters).`,
          },
          {
            role: "user",
            content: `Find the product with UPC/EAN/SKU: ${sku}

Return the product name and up to 10 direct image URLs in this exact format:
PRODUCT: [product name]
IMAGES:
1. [direct image URL]
2. [direct image URL]
3. [direct image URL]
...

Only include URLs that point directly to image files. Do not include webpage URLs.`,
          },
        ],
        max_tokens: 2000,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.error(`[ImageSearch] Perplexity API error: ${response.status}`);
      return result;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    
    console.log(`[ImageSearch] Raw response length: ${content.length}`);

    // Extract product name
    const productMatch = content.match(/PRODUCT:\s*(.+)/i);
    if (productMatch) {
      result.productName = productMatch[1].trim();
    }

    // Extract image URLs - look for any URL that looks like an image
    const urlRegex = /https?:\/\/[^\s\n\r"'<>]+\.(jpg|jpeg|png|webp|tif|tiff)(\?[^\s\n\r"'<>]*)?/gi;
    const matches = content.match(urlRegex) || [];
    
    // Also look for image URLs with format parameters (like Bloomingdale's fmt=jpeg)
    const paramUrlRegex = /https?:\/\/[^\s\n\r"'<>]+(?:fmt=(?:jpeg|jpg|png|webp)|\/images?\/[^\s\n\r"'<>]+)/gi;
    const paramMatches = content.match(paramUrlRegex) || [];
    
    const allUrls = Array.from(new Set([...matches, ...paramMatches]));
    
    // Filter out obviously bad URLs
    result.imageUrls = allUrls.filter(url => {
      const lower = url.toLowerCase();
      return (
        !lower.includes('logo') &&
        !lower.includes('icon') &&
        !lower.includes('favicon') &&
        !lower.includes('sprite') &&
        !lower.includes('placeholder') &&
        !lower.includes('1x1') &&
        url.length > 20
      );
    });

    console.log(`[ImageSearch] Found ${result.imageUrls.length} image URLs for "${result.productName}"`);
    for (const url of result.imageUrls.slice(0, 5)) {
      console.log(`[ImageSearch]   ${url.substring(0, 80)}...`);
    }

    return result;
  } catch (error) {
    console.error(`[ImageSearch] Error: ${error}`);
    return result;
  }
}

/**
 * Search for product images using direct retailer API endpoints
 * These are public endpoints that don't require authentication
 */
export async function searchRetailerImages(sku: string): Promise<string[]> {
  const images: string[] = [];
  
  // Try Google Shopping image search via public endpoints
  const searches = [
    // FragranceNet direct search
    `https://www.fragrancenet.com/search?q=${sku}`,
    // FragranceX direct search  
    `https://www.fragrancex.com/search?q=${sku}`,
  ];
  
  // Try fetching product pages and extracting og:image meta tags
  for (const searchUrl of searches) {
    try {
      const response = await fetch(searchUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html',
        },
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      });
      
      if (!response.ok) continue;
      
      const html = await response.text();
      
      // Extract og:image and product image URLs from HTML
      const ogImageMatch = html.match(/property="og:image"\s+content="([^"]+)"/i) ||
                           html.match(/content="([^"]+)"\s+property="og:image"/i);
      if (ogImageMatch) {
        images.push(ogImageMatch[1]);
      }
      
      // Extract large product images from img tags
      const imgRegex = /src="(https?:\/\/[^"]+(?:product|item|large|zoom|main|hero)[^"]*\.(?:jpg|jpeg|png|webp)[^"]*)"/gi;
      let imgMatch;
      while ((imgMatch = imgRegex.exec(html)) !== null) {
        if (!images.includes(imgMatch[1])) {
          images.push(imgMatch[1]);
        }
      }
      
      if (images.length >= 5) break;
    } catch {
      // Ignore individual retailer failures
    }
  }
  
  console.log(`[RetailerSearch] Found ${images.length} images from retailer pages`);
  return images;
}
