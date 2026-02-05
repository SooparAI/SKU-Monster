import { describe, it, expect } from 'vitest';

describe('Replicate API', () => {
  it('should validate API token by checking account', async () => {
    const token = process.env.REPLICATE_API_TOKEN;
    expect(token).toBeDefined();
    expect(token).not.toBe('');
    
    // Test the token by fetching account info
    const response = await fetch('https://api.replicate.com/v1/account', {
      headers: {
        'Authorization': `Token ${token}`,
      },
    });
    
    console.log('Replicate API response status:', response.status);
    
    if (!response.ok) {
      const error = await response.text();
      console.error('Replicate API error:', error);
    }
    
    expect(response.ok).toBe(true);
    
    const account = await response.json();
    console.log('Replicate account:', account.username || account.type);
    expect(account).toBeDefined();
  });
});
