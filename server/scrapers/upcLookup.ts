// UPC Database Lookup - Get product info and images from UPC/EAN codes
// Uses upcitemdb.com API (free tier: 100 requests/day)
// Falls back to Forge LLM (with web search) for product identification

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

// Fallback: Use Perplexity sonar-pro (with real web search) to identify products from barcodes
// This is called when upcitemdb.com doesn't have the product
export async function lookupBarcodeLookup(upc: string): Promise<UpcLookupResult> {
  const emptyResult: UpcLookupResult = {
    found: false,
    productName: "",
    brand: "",
    description: "",
    images: [],
    offers: [],
  };

  const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY || "";
  if (!PERPLEXITY_API_KEY) {
    console.log(`[BarcodeLookup] Perplexity API key not configured, skipping`);
    return emptyResult;
  }

  try {
    const cleanUpc = upc.replace(/\D/g, "");
    console.log(`[BarcodeLookup] Using Perplexity sonar-pro to identify barcode: ${cleanUpc}`);

    const resp = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${PERPLEXITY_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [
          {
            role: 'system',
            content: 'You are a barcode lookup assistant. When given a barcode number, search the web to find what product it belongs to. Return ONLY a JSON object with productName, brand, and description fields. If you truly cannot find the product, return empty strings.'
          },
          {
            role: 'user',
            content: `Look up barcode number ${cleanUpc}. Search barcodelookup.com/${cleanUpc} and fragrantica.com and other product databases to find the exact product name and brand. This is likely a fragrance/perfume product. Return JSON: {"productName":"full product name","brand":"brand name","description":"visual description of the product and its packaging"}`
          }
        ],
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!resp.ok) {
      console.log(`[BarcodeLookup] Perplexity API error: ${resp.status}`);
      return emptyResult;
    }

    const data = await resp.json() as any;
    const content = data.choices?.[0]?.message?.content || '';
    console.log(`[BarcodeLookup] Perplexity response: ${content.substring(0, 400)}`);

    const jsonMatch = content.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      // Try to extract product name from natural language response
      console.log(`[BarcodeLookup] No JSON found, trying to extract from text...`);
      return extractFromNaturalLanguage(content, cleanUpc);
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      console.log(`[BarcodeLookup] Failed to parse JSON, trying text extraction...`);
      return extractFromNaturalLanguage(content, cleanUpc);
    }

    if (!parsed.productName || parsed.productName.length < 3) {
      // Try text extraction as fallback
      const textResult = extractFromNaturalLanguage(content, cleanUpc);
      if (textResult.found) return textResult;
      console.log(`[BarcodeLookup] Product not identified`);
      return emptyResult;
    }

    // Filter out garbage responses
    const badNames = [
      'no product found', 'unknown product', 'not found', 'unable to identify',
      'cannot identify', 'no results', 'no matching', 'product not found',
      'i don\'t have', 'i cannot', 'i\'m unable', 'unable to browse',
      'cannot browse', 'don\'t have the ability',
    ];
    const nameLower = parsed.productName.toLowerCase();
    if (badNames.some(bad => nameLower.includes(bad))) {
      console.log(`[BarcodeLookup] Perplexity returned garbage name: "${parsed.productName}"`);
      return emptyResult;
    }

    console.log(`[BarcodeLookup] Perplexity identified: "${parsed.productName}" by "${parsed.brand}"`);
    return {
      found: true,
      productName: parsed.productName,
      brand: parsed.brand || "",
      description: parsed.description || "",
      images: [],
      offers: [],
    };
  } catch (err) {
    console.error(`[BarcodeLookup] Perplexity error: ${err}`);
    return emptyResult;
  }
}

// Extract product info from natural language Perplexity response when JSON parsing fails
function extractFromNaturalLanguage(text: string, upc: string): UpcLookupResult {
  const emptyResult: UpcLookupResult = {
    found: false, productName: "", brand: "", description: "", images: [], offers: [],
  };

  // Look for patterns like "The product is..." or "This barcode belongs to..."
  const patterns = [
    /(?:product|barcode|EAN|UPC)\s+(?:is|belongs to|corresponds to|refers to)\s+["']?([^"'\n.]+)/i,
    /(?:identified as|found to be|matches)\s+["']?([^"'\n.]+)/i,
    /\*\*([^*]+)\*\*/,  // Bold text often contains the product name
  ];

  let productName = "";
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1] && match[1].length > 5 && match[1].length < 200) {
      productName = match[1].trim();
      break;
    }
  }

  if (!productName) {
    console.log(`[BarcodeLookup] Could not extract product name from text`);
    return emptyResult;
  }

  // Try to extract brand
  let brand = "";
  const brandMatch = text.match(/(?:brand|manufacturer|by)\s*:?\s*["']?([A-Z][\w\s]+)/i);
  if (brandMatch) brand = brandMatch[1].trim();

  console.log(`[BarcodeLookup] Extracted from text: "${productName}" by "${brand}"`);
  return {
    found: true,
    productName,
    brand,
    description: "",
    images: [],
    offers: [],
  };
}

// LAST-RESORT FALLBACK: Use ean-search.org API to identify products from barcodes
// This has a strict 100 queries/month limit - only call when ALL other methods fail
export async function lookupEanSearch(upc: string): Promise<UpcLookupResult> {
  const emptyResult: UpcLookupResult = {
    found: false,
    productName: "",
    brand: "",
    description: "",
    images: [],
    offers: [],
  };

  const EAN_SEARCH_API_KEY = process.env.EAN_SEARCH_API_KEY || "";
  if (!EAN_SEARCH_API_KEY) {
    console.log(`[EAN-Search] API key not configured, skipping`);
    return emptyResult;
  }

  try {
    const cleanUpc = upc.replace(/\D/g, "");
    console.log(`[EAN-Search] ⚠️ LAST RESORT: Looking up barcode ${cleanUpc} (100 queries/month limit!)`);

    const resp = await fetch(
      `https://api.ean-search.org/api?token=${EAN_SEARCH_API_KEY}&op=barcode-lookup&ean=${cleanUpc}&format=json`,
      { signal: AbortSignal.timeout(15000) }
    );

    if (!resp.ok) {
      console.log(`[EAN-Search] API error: ${resp.status}`);
      return emptyResult;
    }

    const data = await resp.json() as any;
    console.log(`[EAN-Search] Response: ${JSON.stringify(data).substring(0, 300)}`);

    // API returns an array; check for errors
    if (Array.isArray(data) && data.length > 0) {
      if (data[0].error) {
        console.log(`[EAN-Search] Error: ${data[0].error}`);
        return emptyResult;
      }

      const item = data[0];
      if (item.name && item.name.length > 2) {
        console.log(`[EAN-Search] ✅ Found: "${item.name}" (category: ${item.categoryName || 'unknown'})`);
        return {
          found: true,
          productName: item.name,
          brand: "", // ean-search.org doesn't always return brand separately
          description: item.categoryName || "",
          images: [],
          offers: [],
        };
      }
    }

    console.log(`[EAN-Search] No results found for barcode: ${cleanUpc}`);
    return emptyResult;
  } catch (err) {
    console.error(`[EAN-Search] Error: ${err}`);
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
