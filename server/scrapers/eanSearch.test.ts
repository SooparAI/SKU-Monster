import { describe, it, expect } from 'vitest';

describe('EAN-Search.org API Key Validation', () => {
  it('should authenticate with the API key and look up a known barcode', async () => {
    const apiKey = process.env.EAN_SEARCH_API_KEY;
    expect(apiKey).toBeTruthy();

    // Use a well-known barcode to validate the key works
    const resp = await fetch(
      `https://api.ean-search.org/api?token=${apiKey}&op=barcode-lookup&ean=5901234123457&format=json`,
      { signal: AbortSignal.timeout(15000) }
    );
    
    expect(resp.ok).toBe(true);
    const data = await resp.json();
    console.log('EAN-Search response:', JSON.stringify(data));
    
    // Should NOT return "Invalid token" error
    const hasError = Array.isArray(data) && data[0]?.error === 'Invalid token';
    expect(hasError).toBe(false);
  }, 20000);
});
