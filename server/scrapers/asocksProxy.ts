// Asocks Proxy Integration
// Fetches and rotates through available proxies from Asocks API v2
// Prioritizes US proxies for better compatibility with US-based fragrance sites

const ASOCKS_API_KEY = process.env.ASOCKS_API_KEY || '2f74d4c2d93ff6db9016142cb76ed56f';

// Preferred countries in order of priority (US first for US-based stores)
const PREFERRED_COUNTRIES = ['US', 'CA', 'GB', 'AU'];

interface AsocksProxy {
  id: number;
  name: string;
  proxy: string;
  template: string;
  login: string;
  password: string;
  countryCode: string;
  status: number;
  refresh_link: string;
}

interface AsocksResponse {
  success: boolean;
  message: {
    countProxies: number;
    pagination?: {
      page: number;
      pageCount: number;
      pageSize: number;
      totalCount: number;
    };
    proxies: AsocksProxy[];
  };
}

let cachedProxies: AsocksProxy[] = [];
let usProxies: AsocksProxy[] = [];
let otherProxies: AsocksProxy[] = [];
let lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let usIndex = 0;
let otherIndex = 0;

export async function fetchProxies(): Promise<AsocksProxy[]> {
  const now = Date.now();
  if (cachedProxies.length > 0 && now - lastFetch < CACHE_TTL) {
    return cachedProxies;
  }

  try {
    // Fetch all pages to get all proxies including US ones
    const allProxies: AsocksProxy[] = [];
    let page = 1;
    let totalPages = 1;
    
    do {
      const response = await fetch(
        `https://api.asocks.com/v2/proxy/ports?apiKey=${ASOCKS_API_KEY}&page=${page}`
      );
      const data: AsocksResponse = await response.json();
      
      if (data.success && data.message?.proxies) {
        // Filter only active proxies (status 1 or 2)
        const activeProxies = data.message.proxies.filter(p => p.status === 1 || p.status === 2);
        allProxies.push(...activeProxies);
        
        // Get pagination info
        if (data.message.pagination) {
          totalPages = data.message.pagination.pageCount;
        }
      }
      page++;
    } while (page <= totalPages);
    
    cachedProxies = allProxies;
    
    // Separate US/preferred proxies from others for prioritization
    usProxies = cachedProxies.filter(p => 
      PREFERRED_COUNTRIES.includes(p.countryCode)
    );
    otherProxies = cachedProxies.filter(p => 
      !PREFERRED_COUNTRIES.includes(p.countryCode)
    );
    
    lastFetch = now;
    console.log(`[Asocks] Loaded ${cachedProxies.length} active proxies (${usProxies.length} US/preferred, ${otherProxies.length} other)`);
  } catch (error) {
    console.error('[Asocks] Failed to fetch proxies:', error);
  }

  return cachedProxies;
}

// Get next proxy with US preference
export async function getNextProxy(preferUS: boolean = true): Promise<string | null> {
  await fetchProxies();
  
  let proxy: AsocksProxy | null = null;
  
  if (preferUS && usProxies.length > 0) {
    // Use US proxies first
    proxy = usProxies[usIndex % usProxies.length];
    usIndex++;
    console.log(`[Asocks] Using US proxy ${usIndex}/${usProxies.length}: ${proxy.proxy} (${proxy.countryCode})`);
  } else if (otherProxies.length > 0) {
    // Fall back to other proxies
    proxy = otherProxies[otherIndex % otherProxies.length];
    otherIndex++;
    console.log(`[Asocks] Using other proxy ${otherIndex}/${otherProxies.length}: ${proxy.proxy} (${proxy.countryCode})`);
  } else if (cachedProxies.length > 0) {
    // Last resort: any available proxy
    proxy = cachedProxies[(usIndex + otherIndex) % cachedProxies.length];
    console.log(`[Asocks] Using fallback proxy: ${proxy.proxy} (${proxy.countryCode})`);
  }
  
  if (!proxy) {
    console.log('[Asocks] No proxies available');
    return null;
  }

  // Return proxy URL in format: http://login:password@host:port
  const [host, port] = proxy.proxy.split(':');
  return `http://${proxy.login}:${proxy.password}@${host}:${port}`;
}

export async function getProxyForPuppeteer(preferUS: boolean = true): Promise<{ server: string; username: string; password: string } | null> {
  await fetchProxies();
  
  let proxy: AsocksProxy | null = null;
  
  if (preferUS && usProxies.length > 0) {
    // Use US proxies first
    proxy = usProxies[usIndex % usProxies.length];
    usIndex++;
    console.log(`[Asocks] Puppeteer using US proxy ${usIndex}/${usProxies.length}: ${proxy.proxy} (${proxy.countryCode})`);
  } else if (otherProxies.length > 0) {
    // Fall back to other proxies
    proxy = otherProxies[otherIndex % otherProxies.length];
    otherIndex++;
    console.log(`[Asocks] Puppeteer using other proxy ${otherIndex}/${otherProxies.length}: ${proxy.proxy} (${proxy.countryCode})`);
  } else if (cachedProxies.length > 0) {
    // Last resort: any available proxy
    proxy = cachedProxies[(usIndex + otherIndex) % cachedProxies.length];
    console.log(`[Asocks] Puppeteer using fallback proxy: ${proxy.proxy} (${proxy.countryCode})`);
  }
  
  if (!proxy) {
    console.log('[Asocks] No proxies available for Puppeteer');
    return null;
  }
  
  return {
    server: `http://${proxy.proxy}`,
    username: proxy.login,
    password: proxy.password,
  };
}

export async function refreshProxy(proxyId: number): Promise<boolean> {
  try {
    const proxy = cachedProxies.find(p => p.id === proxyId);
    if (!proxy) return false;

    await fetch(proxy.refresh_link);
    console.log(`[Asocks] Refreshed proxy ${proxyId}`);
    return true;
  } catch (error) {
    console.error(`[Asocks] Failed to refresh proxy ${proxyId}:`, error);
    return false;
  }
}

// Get proxy stats
export async function getProxyStats(): Promise<{ total: number; us: number; other: number }> {
  await fetchProxies();
  return {
    total: cachedProxies.length,
    us: usProxies.length,
    other: otherProxies.length
  };
}

// Force refresh the proxy cache
export function clearProxyCache(): void {
  cachedProxies = [];
  usProxies = [];
  otherProxies = [];
  lastFetch = 0;
  usIndex = 0;
  otherIndex = 0;
  console.log('[Asocks] Proxy cache cleared');
}
