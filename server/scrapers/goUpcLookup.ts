/**
 * Go-UPC API Integration for Product Image Lookup
 * https://go-upc.com/api
 * 
 * Pricing: ~$0.005-0.015 per lookup depending on plan
 */

const GO_UPC_API_KEY = process.env.GO_UPC_API_KEY || '';

interface GoUpcProduct {
  code: string;
  codeType: string;
  product: {
    name: string;
    description: string;
    imageUrl: string;
    brand: string;
    category: string;
    manufacturer: string;
  } | null;
}

interface GoUpcResult {
  found: boolean;
  productName: string | null;
  brand: string | null;
  imageUrl: string | null;
  description: string | null;
}

/**
 * Look up a product by UPC/EAN/SKU code using Go-UPC API
 */
export async function lookupGoUpc(sku: string): Promise<GoUpcResult> {
  if (!GO_UPC_API_KEY) {
    console.log('[Go-UPC] API key not configured, skipping lookup');
    return { found: false, productName: null, brand: null, imageUrl: null, description: null };
  }

  try {
    const response = await fetch(`https://go-upc.com/api/v1/code/${encodeURIComponent(sku)}`, {
      headers: {
        'Authorization': `Bearer ${GO_UPC_API_KEY}`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        console.log(`[Go-UPC] Product not found for SKU: ${sku}`);
        return { found: false, productName: null, brand: null, imageUrl: null, description: null };
      }
      throw new Error(`Go-UPC API error: ${response.status} ${response.statusText}`);
    }

    const data: GoUpcProduct = await response.json();

    if (!data.product) {
      console.log(`[Go-UPC] No product data for SKU: ${sku}`);
      return { found: false, productName: null, brand: null, imageUrl: null, description: null };
    }

    console.log(`[Go-UPC] Found product: ${data.product.name} (${data.product.brand})`);
    
    return {
      found: true,
      productName: data.product.name,
      brand: data.product.brand,
      imageUrl: data.product.imageUrl,
      description: data.product.description,
    };
  } catch (error) {
    console.error(`[Go-UPC] Error looking up SKU ${sku}:`, error);
    return { found: false, productName: null, brand: null, imageUrl: null, description: null };
  }
}

/**
 * Check if Go-UPC image is high quality (>100KB typically indicates decent quality)
 */
export async function checkImageQuality(imageUrl: string): Promise<{ isHQ: boolean; sizeKB: number }> {
  try {
    const response = await fetch(imageUrl, { method: 'HEAD' });
    const contentLength = response.headers.get('content-length');
    
    if (!contentLength) {
      // If no content-length, download and check
      const imgResponse = await fetch(imageUrl);
      const buffer = await imgResponse.arrayBuffer();
      const sizeKB = buffer.byteLength / 1024;
      return { isHQ: sizeKB > 100, sizeKB };
    }
    
    const sizeKB = parseInt(contentLength) / 1024;
    return { isHQ: sizeKB > 100, sizeKB };
  } catch (error) {
    console.error('[Go-UPC] Error checking image quality:', error);
    return { isHQ: false, sizeKB: 0 };
  }
}
