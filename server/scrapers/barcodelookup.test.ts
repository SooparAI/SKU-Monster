import { describe, it, expect } from 'vitest';
import { lookupBarcodeLookup, lookupEanSearch } from './upcLookup';

describe('Barcode Lookup Fallbacks', () => {
  it('lookupBarcodeLookup should return a result (Perplexity sonar-pro)', async () => {
    // Note: Perplexity may return incorrect products for niche barcodes
    // This test just validates the function runs without errors
    const result = await lookupBarcodeLookup('3274872474666');
    
    console.log('Product:', result.productName);
    console.log('Brand:', result.brand);
    console.log('Found:', result.found);
    
    // Perplexity should return *something* (may be wrong product)
    expect(typeof result.found).toBe('boolean');
    expect(typeof result.productName).toBe('string');
  }, 60000);

  it('lookupEanSearch should find a known product', async () => {
    // Use a well-known barcode to validate (NOT a rare fragrance - save those queries)
    const result = await lookupEanSearch('5901234123457');
    
    console.log('Product:', result.productName);
    console.log('Found:', result.found);
    
    expect(result.found).toBe(true);
    expect(result.productName).toContain('WENGER');
  }, 20000);
});
