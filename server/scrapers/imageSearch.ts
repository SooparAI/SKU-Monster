/**
 * Image Search Fallback - Uses Google Images and eBay to find product images
 * No browser required - pure HTTP fetch + HTML parsing
 * No API keys required - uses public search pages
 * 
 * IMPORTANT: On deployed servers, Google/eBay/Amazon may block or rate-limit.
 * All searches run with generous timeouts and graceful fallbacks.
 */

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Generous timeouts for deployed server where network may be slower
const SEARCH_TIMEOUT_MS = 20000; // 20s for search pages
const DOWNLOAD_TIMEOUT_MS = 15000; // 15s for image downloads

export interface ImageSearchResult {
  imageUrls: string[];
  productName: string;
  source: string;
}

/**
 * Search for product images using Google Images (no API key needed)
 * Returns direct image URLs extracted from the search results page HTML
 */
export async function searchProductImages(
  sku: string,
  productName?: string | null
): Promise<ImageSearchResult> {
  const result: ImageSearchResult = {
    imageUrls: [],
    productName: "",
    source: "google_images",
  };

  // Try searching by SKU first, then by product name if that fails
  const queries = [sku];
  if (productName && productName.length > 5) {
    queries.push(`${productName} product`);
  }

  for (const query of queries) {
    if (result.imageUrls.length >= 5) break;

    try {
      console.log(`[ImageSearch] Google Images search for: ${query}`);

      const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=isch`;
      const response = await fetch(googleUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        redirect: "follow",
      });

      if (!response.ok) {
        console.error(`[ImageSearch] Google Images error: ${response.status}`);
        continue;
      }

      const html = await response.text();
      console.log(`[ImageSearch] Google Images HTML: ${html.length} bytes`);

      // Extract image URLs from the page - Google embeds them in the HTML
      const imgRegex =
        /https?:\/\/[^"'\s\\]+\.(?:jpg|jpeg|png|webp)(?:\?[^"'\s\\]*)?/gi;
      const allUrls = html.match(imgRegex) || [];

      // Filter out Google's own assets and keep product images
      const productUrls = allUrls.filter((url) => {
        const lower = url.toLowerCase();
        return (
          !lower.includes("google") &&
          !lower.includes("gstatic") &&
          !lower.includes("googleapis") &&
          !lower.includes("favicon") &&
          !lower.includes("logo") &&
          !lower.includes("icon") &&
          !lower.includes("sprite") &&
          !lower.includes("1x1") &&
          !lower.includes("pixel") &&
          !lower.includes("tracking") &&
          !lower.includes("analytics") &&
          url.length > 30
        );
      });

      // Deduplicate and merge with existing
      const existing = new Set(result.imageUrls);
      const unique = Array.from(new Set(productUrls)).filter(u => !existing.has(u));
      result.imageUrls.push(...unique);

      console.log(
        `[ImageSearch] Google Images found ${unique.length} new URLs (total: ${result.imageUrls.length})`
      );
    } catch (error) {
      console.error(`[ImageSearch] Google Images error for "${query}": ${error}`);
    }
  }

  // Cap at 20
  result.imageUrls = result.imageUrls.slice(0, 20);
  for (const url of result.imageUrls.slice(0, 5)) {
    console.log(`[ImageSearch]   ${url.substring(0, 100)}`);
  }

  return result;
}

/**
 * Search for product images on eBay (no API key needed)
 * Returns direct image URLs from eBay search results
 */
export async function searchEbayImages(sku: string, productName?: string | null): Promise<string[]> {
  const images: string[] = [];

  // Try SKU first, then product name
  const queries = [sku];
  if (productName && productName.length > 5) {
    queries.push(productName);
  }

  for (const query of queries) {
    if (images.length >= 5) break;

    try {
      console.log(`[ImageSearch] eBay search for: ${query}`);

      const ebayUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`;
      const response = await fetch(ebayUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html",
        },
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        redirect: "follow",
      });

      if (!response.ok) {
        console.error(`[ImageSearch] eBay error: ${response.status}`);
        continue;
      }

      const html = await response.text();

      // Extract eBay image URLs - they use i.ebayimg.com
      const ebayImgRegex =
        /https?:\/\/i\.ebayimg\.com\/[^"'\s]+\.(?:jpg|jpeg|png|webp)[^"'\s]*/gi;
      const matches = html.match(ebayImgRegex) || [];

      // Prefer larger images (s-l500 or s-l1600 over s-l140)
      const unique = Array.from(new Set(matches));
      const large = unique.filter(
        (url) => url.includes("s-l500") || url.includes("s-l1600")
      );
      const other = unique.filter(
        (url) => !url.includes("s-l140") && !large.includes(url)
      );

      const existing = new Set(images);
      const newImages = [...large, ...other].filter(u => !existing.has(u));
      images.push(...newImages);

      console.log(`[ImageSearch] eBay found ${newImages.length} new URLs (total: ${images.length})`);
    } catch (error) {
      console.error(`[ImageSearch] eBay error for "${query}": ${error}`);
    }
  }

  for (const url of images.slice(0, 3)) {
    console.log(`[ImageSearch]   ${url.substring(0, 100)}`);
  }

  return images;
}

/**
 * Search for product images using direct retailer page fetches
 * Tries to extract og:image and product images from retailer HTML
 */
export async function searchRetailerImages(sku: string, productName?: string | null): Promise<string[]> {
  const images: string[] = [];

  // Try Amazon - often works without browser
  const queries = [sku];
  if (productName && productName.length > 5) {
    queries.push(productName);
  }

  for (const query of queries) {
    if (images.length >= 5) break;

    const amazonUrl = `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
    try {
      const resp = await fetch(amazonUrl, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html",
        },
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        redirect: "follow",
      });

      if (resp.ok) {
        const html = await resp.text();
        // Amazon uses m.media-amazon.com for product images
        const amazonImgRegex =
          /https?:\/\/m\.media-amazon\.com\/images\/I\/[^"'\s]+\.(?:jpg|jpeg|png)[^"'\s]*/gi;
        const matches = html.match(amazonImgRegex) || [];
        const unique = Array.from(new Set(matches));
        // Filter out tiny images
        const filtered = unique.filter(
          (url) =>
            !url.includes("_SS40_") &&
            !url.includes("_SS50_") &&
            !url.includes("_SS100_")
        );
        const existing = new Set(images);
        const newImages = filtered.filter(u => !existing.has(u)).slice(0, 5);
        images.push(...newImages);
        console.log(
          `[RetailerSearch] Amazon found ${newImages.length} new URLs for "${query}"`
        );
      }
    } catch {
      // Ignore - Amazon often blocks
    }
  }

  console.log(
    `[RetailerSearch] Total: ${images.length} images from retailers`
  );
  return images;
}

/**
 * Run ALL image searches in parallel for maximum speed
 * Returns combined unique image URLs from all sources
 */
export async function searchAllImageSources(
  sku: string,
  productName?: string | null
): Promise<{ imageUrls: string[]; sources: Record<string, number> }> {
  console.log(`[ImageSearch] Running all searches in parallel for SKU: ${sku}${productName ? ` (${productName})` : ''}`);
  
  const startTime = Date.now();
  
  // Run all searches in parallel
  const [googleResult, ebayResult, amazonResult] = await Promise.allSettled([
    searchProductImages(sku, productName),
    searchEbayImages(sku, productName),
    searchRetailerImages(sku, productName),
  ]);

  const sources: Record<string, number> = {};
  const allUrls: string[] = [];

  if (googleResult.status === 'fulfilled') {
    allUrls.push(...googleResult.value.imageUrls);
    sources.google = googleResult.value.imageUrls.length;
  } else {
    console.error(`[ImageSearch] Google failed:`, googleResult.reason);
    sources.google = 0;
  }

  if (ebayResult.status === 'fulfilled') {
    allUrls.push(...ebayResult.value);
    sources.ebay = ebayResult.value.length;
  } else {
    console.error(`[ImageSearch] eBay failed:`, ebayResult.reason);
    sources.ebay = 0;
  }

  if (amazonResult.status === 'fulfilled') {
    allUrls.push(...amazonResult.value);
    sources.amazon = amazonResult.value.length;
  } else {
    console.error(`[ImageSearch] Amazon failed:`, amazonResult.reason);
    sources.amazon = 0;
  }

  // Deduplicate
  const unique = Array.from(new Set(allUrls));
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  
  console.log(`[ImageSearch] All searches complete in ${elapsed}s: ${unique.length} unique URLs (Google: ${sources.google}, eBay: ${sources.ebay}, Amazon: ${sources.amazon})`);

  return { imageUrls: unique, sources };
}
