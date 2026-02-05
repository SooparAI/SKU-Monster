import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch for testing
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Import after mocking
import { fetchProxies, getNextProxy, getProxyForPuppeteer, getProxyStats, clearProxyCache } from './asocksProxy';

describe('Asocks Proxy Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearProxyCache();
  });

  it('should fetch proxies from all pages', async () => {
    // Mock first page response
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        success: true,
        message: {
          countProxies: 2,
          pagination: { page: 1, pageCount: 2, pageSize: 50, totalCount: 4 },
          proxies: [
            { id: 1, name: 'PL1', proxy: '1.1.1.1:9999', login: 'user1', password: 'pass1', countryCode: 'PL', status: 2 },
            { id: 2, name: 'US1', proxy: '2.2.2.2:9999', login: 'user2', password: 'pass2', countryCode: 'US', status: 2 },
          ]
        }
      })
    });
    
    // Mock second page response
    mockFetch.mockResolvedValueOnce({
      json: () => Promise.resolve({
        success: true,
        message: {
          countProxies: 2,
          pagination: { page: 2, pageCount: 2, pageSize: 50, totalCount: 4 },
          proxies: [
            { id: 3, name: 'PL2', proxy: '3.3.3.3:9999', login: 'user3', password: 'pass3', countryCode: 'PL', status: 2 },
            { id: 4, name: 'US2', proxy: '4.4.4.4:9999', login: 'user4', password: 'pass4', countryCode: 'US', status: 2 },
          ]
        }
      })
    });

    const proxies = await fetchProxies();
    
    expect(proxies).toHaveLength(4);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should prioritize US proxies when preferUS is true', async () => {
    // Mock API response with mixed proxies
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({
        success: true,
        message: {
          countProxies: 3,
          pagination: { page: 1, pageCount: 1, pageSize: 50, totalCount: 3 },
          proxies: [
            { id: 1, name: 'PL1', proxy: '1.1.1.1:9999', login: 'pl-user', password: 'pass', countryCode: 'PL', status: 2 },
            { id: 2, name: 'US1', proxy: '2.2.2.2:9999', login: 'us-user', password: 'pass', countryCode: 'US', status: 2 },
            { id: 3, name: 'CA1', proxy: '3.3.3.3:9999', login: 'ca-user', password: 'pass', countryCode: 'CA', status: 2 },
          ]
        }
      })
    });

    const proxyUrl = await getNextProxy(true);
    
    // Should get US or CA proxy (preferred countries)
    expect(proxyUrl).toMatch(/us-user|ca-user/);
  });

  it('should return proxy stats correctly', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({
        success: true,
        message: {
          countProxies: 4,
          pagination: { page: 1, pageCount: 1, pageSize: 50, totalCount: 4 },
          proxies: [
            { id: 1, name: 'PL1', proxy: '1.1.1.1:9999', login: 'user1', password: 'pass', countryCode: 'PL', status: 2 },
            { id: 2, name: 'US1', proxy: '2.2.2.2:9999', login: 'user2', password: 'pass', countryCode: 'US', status: 2 },
            { id: 3, name: 'US2', proxy: '3.3.3.3:9999', login: 'user3', password: 'pass', countryCode: 'US', status: 2 },
            { id: 4, name: 'GB1', proxy: '4.4.4.4:9999', login: 'user4', password: 'pass', countryCode: 'GB', status: 2 },
          ]
        }
      })
    });

    const stats = await getProxyStats();
    
    expect(stats.total).toBe(4);
    expect(stats.us).toBe(3); // US, US, GB are all preferred
    expect(stats.other).toBe(1); // PL is not preferred
  });

  it('should return Puppeteer-compatible proxy format', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({
        success: true,
        message: {
          countProxies: 1,
          pagination: { page: 1, pageCount: 1, pageSize: 50, totalCount: 1 },
          proxies: [
            { id: 1, name: 'US1', proxy: '10.0.0.1:9999', login: 'testuser', password: 'testpass', countryCode: 'US', status: 2 },
          ]
        }
      })
    });

    const proxy = await getProxyForPuppeteer(true);
    
    expect(proxy).not.toBeNull();
    expect(proxy?.server).toBe('http://10.0.0.1:9999');
    expect(proxy?.username).toBe('testuser');
    expect(proxy?.password).toBe('testpass');
  });

  it('should filter out inactive proxies', async () => {
    mockFetch.mockResolvedValue({
      json: () => Promise.resolve({
        success: true,
        message: {
          countProxies: 3,
          pagination: { page: 1, pageCount: 1, pageSize: 50, totalCount: 3 },
          proxies: [
            { id: 1, name: 'Active1', proxy: '1.1.1.1:9999', login: 'user1', password: 'pass', countryCode: 'US', status: 2 },
            { id: 2, name: 'Inactive', proxy: '2.2.2.2:9999', login: 'user2', password: 'pass', countryCode: 'US', status: 0 },
            { id: 3, name: 'Active2', proxy: '3.3.3.3:9999', login: 'user3', password: 'pass', countryCode: 'US', status: 1 },
          ]
        }
      })
    });

    const proxies = await fetchProxies();
    
    // Should only include status 1 or 2
    expect(proxies).toHaveLength(2);
    expect(proxies.every(p => p.status === 1 || p.status === 2)).toBe(true);
  });
});
