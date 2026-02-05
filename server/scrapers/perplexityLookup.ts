// Perplexity API integration for smart SKU product lookup
// This queries Perplexity to find which stores carry a product before scraping

import { storeConfigs } from "./storeConfigs";

const PERPLEXITY_API_KEY = process.env.PERPLEXITY_API_KEY;
const PERPLEXITY_API_URL = "https://api.perplexity.ai/chat/completions";

export interface ProductLookupResult {
  productName: string;
  brand: string;
  matchedStores: string[];
  suggestedStores: Array<{
    name: string;
    url: string;
    matched: boolean;
  }>;
  rawResponse: string;
}

export async function lookupProductBySku(sku: string): Promise<ProductLookupResult> {
  if (!PERPLEXITY_API_KEY) {
    console.log("[Perplexity] No API key configured, skipping lookup");
    return {
      productName: "",
      brand: "",
      matchedStores: [],
      suggestedStores: [],
      rawResponse: "No API key configured",
    };
  }

  const prompt = `I have a fragrance/perfume product with SKU/EAN/UPC: ${sku}

Please identify:
1. The exact product name and brand
2. The top 5 online stores where this product can be purchased

Format your response EXACTLY like this:
PRODUCT_NAME: [full product name]
BRAND: [brand name]
STORES:
1. [Store Name] - [URL]
2. [Store Name] - [URL]
3. [Store Name] - [URL]
4. [Store Name] - [URL]
5. [Store Name] - [URL]

If you cannot identify the product, respond with:
PRODUCT_NOT_FOUND: true`;

  try {
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
            content: "You are a helpful assistant that identifies fragrance products by their SKU/EAN/UPC codes and finds where they can be purchased online. Always provide accurate product information and real store URLs.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        max_tokens: 1000,
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[Perplexity] API error:", response.status, errorText);
      throw new Error(`Perplexity API error: ${response.status}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || "";
    
    console.log("[Perplexity] Raw response:", content);

    // Parse the response
    return parsePerplexityResponse(content, sku);
  } catch (error) {
    console.error("[Perplexity] Lookup failed:", error);
    return {
      productName: "",
      brand: "",
      matchedStores: [],
      suggestedStores: [],
      rawResponse: `Error: ${error}`,
    };
  }
}

function parsePerplexityResponse(content: string, sku: string): ProductLookupResult {
  const result: ProductLookupResult = {
    productName: "",
    brand: "",
    matchedStores: [],
    suggestedStores: [],
    rawResponse: content,
  };

  // Check if product not found
  if (content.includes("PRODUCT_NOT_FOUND: true") || content.toLowerCase().includes("cannot identify")) {
    return result;
  }

  // Extract product name
  const productMatch = content.match(/PRODUCT_NAME:\s*(.+)/i);
  if (productMatch) {
    result.productName = productMatch[1].trim();
  }

  // Extract brand
  const brandMatch = content.match(/BRAND:\s*(.+)/i);
  if (brandMatch) {
    result.brand = brandMatch[1].trim();
  }

  // Extract stores
  const storeRegex = /\d+\.\s*([^-\n]+)\s*-\s*(https?:\/\/[^\s\n]+)/gi;
  let storeMatch;
  const storeMatches: Array<[string, string, string]> = [];
  while ((storeMatch = storeRegex.exec(content)) !== null) {
    storeMatches.push([storeMatch[0], storeMatch[1], storeMatch[2]]);
  }
  const ourStoreNames = storeConfigs.map(s => s.name.toLowerCase());
  const ourStoreDomains = storeConfigs.map(s => {
    try {
      return new URL(s.baseUrl).hostname.replace("www.", "");
    } catch {
      return "";
    }
  });

  for (const match of storeMatches) {
    const storeName = match[1]?.trim() || "";
    const storeUrl = match[2]?.trim() || "";
    
    // Check if this store matches any of our configured scrapers
    let matched = false;
    let matchedStoreName = "";
    
    // Match by name
    const storeNameLower = storeName.toLowerCase();
    for (let i = 0; i < storeConfigs.length; i++) {
      const configName = ourStoreNames[i];
      const configDomain = ourStoreDomains[i];
      
      // Check name match
      if (storeNameLower.includes(configName) || configName.includes(storeNameLower)) {
        matched = true;
        matchedStoreName = storeConfigs[i].name;
        break;
      }
      
      // Check domain match
      try {
        const urlDomain = new URL(storeUrl).hostname.replace("www.", "");
        if (urlDomain === configDomain || urlDomain.includes(configDomain) || configDomain.includes(urlDomain)) {
          matched = true;
          matchedStoreName = storeConfigs[i].name;
          break;
        }
      } catch {
        // Invalid URL, skip domain check
      }
    }

    result.suggestedStores.push({
      name: storeName,
      url: storeUrl,
      matched,
    });

    if (matched && matchedStoreName) {
      result.matchedStores.push(matchedStoreName);
    }
  }

  console.log(`[Perplexity] Found product: ${result.productName} by ${result.brand}`);
  console.log(`[Perplexity] Matched ${result.matchedStores.length} of ${result.suggestedStores.length} suggested stores`);

  return result;
}

// Test function for validating API key
export async function testPerplexityConnection(): Promise<boolean> {
  if (!PERPLEXITY_API_KEY) {
    return false;
  }

  try {
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
            role: "user",
            content: "Say 'OK' if you can read this.",
          },
        ],
        max_tokens: 10,
      }),
    });

    return response.ok;
  } catch {
    return false;
  }
}
