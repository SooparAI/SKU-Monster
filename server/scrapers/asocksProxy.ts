// Asocks Proxy Integration
// Fetches and rotates through available proxies from Asocks API

const ASOCKS_API_KEY = process.env.ASOCKS_API_KEY || '2f74d4c2d93ff6db9016142cb76ed56f';

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
  data: {
    data: AsocksProxy[];
  };
}

let cachedProxies: AsocksProxy[] = [];
let lastFetch = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
let currentIndex = 0;

export async function fetchProxies(): Promise<AsocksProxy[]> {
  const now = Date.now();
  if (cachedProxies.length > 0 && now - lastFetch < CACHE_TTL) {
    return cachedProxies;
  }

  try {
    const response = await fetch(
      `https://api.asocks.com/proxy/list?apiKey=${ASOCKS_API_KEY}`
    );
    const data: AsocksResponse = await response.json();
    
    if (data.success && data.data?.data) {
      // Filter only active proxies (status 1 or 2)
      cachedProxies = data.data.data.filter(p => p.status === 1 || p.status === 2);
      lastFetch = now;
      console.log(`[Asocks] Loaded ${cachedProxies.length} active proxies`);
    }
  } catch (error) {
    console.error('[Asocks] Failed to fetch proxies:', error);
  }

  return cachedProxies;
}

export async function getNextProxy(): Promise<string | null> {
  const proxies = await fetchProxies();
  if (proxies.length === 0) {
    return null;
  }

  const proxy = proxies[currentIndex % proxies.length];
  currentIndex++;

  // Return proxy URL in format: http://login:password@host:port
  const [host, port] = proxy.proxy.split(':');
  return `http://${proxy.login}:${proxy.password}@${host}:${port}`;
}

export async function getProxyForPuppeteer(): Promise<{ server: string; username: string; password: string } | null> {
  const proxies = await fetchProxies();
  if (proxies.length === 0) {
    return null;
  }

  const proxy = proxies[currentIndex % proxies.length];
  currentIndex++;

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
