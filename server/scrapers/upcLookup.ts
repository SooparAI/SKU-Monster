// UPC Database Lookup - Get product info and images from UPC/EAN codes
// Uses upcitemdb.com API (free tier: 100 requests/day)

export interface UpcLookupResult {
  found: boolean;
  productName: string;
  brand: string;
  description: string;
  images: string[];
  offers: Array<{
    merchant: string;
    price: number;
    link: string;
  }>;
}

export async function lookupUpc(upc: string): Promise<UpcLookupResult> {
  const emptyResult: UpcLookupResult = {
    found: false,
    productName: "",
    brand: "",
    description: "",
    images: [],
    offers: [],
  };

  try {
    // Clean UPC - remove any non-numeric characters
    const cleanUpc = upc.replace(/\D/g, "");
    
    if (cleanUpc.length < 8 || cleanUpc.length > 14) {
      console.log(`[UPC Lookup] Invalid UPC length: ${cleanUpc.length}`);
      return emptyResult;
    }

    console.log(`[UPC Lookup] Looking up UPC: ${cleanUpc}`);
    
    const response = await fetch(
      `https://api.upcitemdb.com/prod/trial/lookup?upc=${cleanUpc}`,
      {
        headers: {
          "Accept": "application/json",
          "User-Agent": "SKU-Image-Scraper/1.0",
        },
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!response.ok) {
      console.error(`[UPC Lookup] API error: ${response.status}`);
      return emptyResult;
    }

    const data = await response.json();
    
    if (data.code !== "OK" || !data.items || data.items.length === 0) {
      console.log(`[UPC Lookup] No results found for UPC: ${cleanUpc}`);
      return emptyResult;
    }

    const item = data.items[0];
    
    // Filter out low-quality/placeholder images
    const validImages = (item.images || []).filter((url: string) => {
      const lowerUrl = url.toLowerCase();
      return (
        url.length > 10 &&
        !lowerUrl.includes("placeholder") &&
        !lowerUrl.includes("no-image") &&
        !lowerUrl.includes("default") &&
        (lowerUrl.endsWith(".jpg") || lowerUrl.endsWith(".jpeg") || lowerUrl.endsWith(".png") || lowerUrl.endsWith(".webp") || lowerUrl.includes(".jpg") || lowerUrl.includes(".jpeg") || lowerUrl.includes(".png"))
      );
    });

    // Extract offers with valid links
    const validOffers = (item.offers || [])
      .filter((offer: any) => offer.merchant && offer.price > 0)
      .map((offer: any) => ({
        merchant: offer.merchant,
        price: offer.price,
        link: offer.link || "",
      }));

    const result: UpcLookupResult = {
      found: true,
      productName: item.title || "",
      brand: item.brand || "",
      description: item.description || "",
      images: validImages,
      offers: validOffers,
    };

    console.log(`[UPC Lookup] Found: ${result.productName}`);
    console.log(`[UPC Lookup] Brand: ${result.brand}`);
    console.log(`[UPC Lookup] Images: ${result.images.length}`);
    console.log(`[UPC Lookup] Offers: ${result.offers.length}`);

    return result;
  } catch (err) {
    console.error(`[UPC Lookup] Error: ${err}`);
    return emptyResult;
  }
}

// Extract product name keywords for verification
export function extractProductKeywords(productName: string, brand: string): string[] {
  const keywords: string[] = [];
  
  // Add brand
  if (brand) {
    keywords.push(brand.toLowerCase());
  }
  
  // Extract key words from product name (skip common words)
  const skipWords = new Set([
    "by", "for", "the", "a", "an", "oz", "ml", "spray", "eau", "de", "parfum",
    "perfume", "cologne", "women", "men", "unisex", "new", "edp", "edt",
  ]);
  
  const words = productName.toLowerCase().split(/\s+/);
  for (const word of words) {
    const clean = word.replace(/[^a-z0-9]/g, "");
    if (clean.length > 2 && !skipWords.has(clean)) {
      keywords.push(clean);
    }
  }
  
  return Array.from(new Set(keywords));
}
