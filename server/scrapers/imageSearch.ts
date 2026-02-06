/**
 * Image Search Fallback - Uses Google Images and eBay to find product images
 * No browser required - pure HTTP fetch + HTML parsing
 * No API keys required - uses public search pages
 * No rate limits - works reliably in production
 */

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

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
  sku: string
): Promise<ImageSearchResult> {
  const result: ImageSearchResult = {
    imageUrls: [],
    productName: "",
    source: "google_images",
  };

  try {
    console.log(`[ImageSearch] Google Images search for: ${sku}`);

    const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(sku)}&tbm=isch`;
    const response = await fetch(googleUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15000),
      redirect: "follow",
    });

    if (!response.ok) {
      console.error(`[ImageSearch] Google Images error: ${response.status}`);
      return result;
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

    // Deduplicate
    const unique = Array.from(new Set(productUrls));
    result.imageUrls = unique.slice(0, 20); // Keep top 20

    console.log(
      `[ImageSearch] Google Images found ${result.imageUrls.length} product image URLs`
    );
    for (const url of result.imageUrls.slice(0, 5)) {
      console.log(`[ImageSearch]   ${url.substring(0, 100)}`);
    }

    return result;
  } catch (error) {
    console.error(`[ImageSearch] Google Images error: ${error}`);
    return result;
  }
}

/**
 * Search for product images on eBay (no API key needed)
 * Returns direct image URLs from eBay search results
 */
export async function searchEbayImages(sku: string): Promise<string[]> {
  const images: string[] = [];

  try {
    console.log(`[ImageSearch] eBay search for: ${sku}`);

    const ebayUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(sku)}`;
    const response = await fetch(ebayUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(10000),
      redirect: "follow",
    });

    if (!response.ok) {
      console.error(`[ImageSearch] eBay error: ${response.status}`);
      return images;
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

    images.push(...large, ...other);

    console.log(`[ImageSearch] eBay found ${images.length} image URLs`);
    for (const url of images.slice(0, 3)) {
      console.log(`[ImageSearch]   ${url.substring(0, 100)}`);
    }
  } catch (error) {
    console.error(`[ImageSearch] eBay error: ${error}`);
  }

  return images;
}

/**
 * Search for product images using direct retailer page fetches
 * Tries to extract og:image and product images from retailer HTML
 */
export async function searchRetailerImages(sku: string): Promise<string[]> {
  const images: string[] = [];

  // Try Amazon - often works without browser
  const amazonUrl = `https://www.amazon.com/s?k=${encodeURIComponent(sku)}`;
  try {
    const resp = await fetch(amazonUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(10000),
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
      images.push(...filtered.slice(0, 5));
      console.log(
        `[RetailerSearch] Amazon found ${filtered.length} image URLs`
      );
    }
  } catch {
    // Ignore
  }

  console.log(
    `[RetailerSearch] Total: ${images.length} images from retailers`
  );
  return images;
}
