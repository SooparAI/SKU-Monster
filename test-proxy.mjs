// Test US proxy loading
const ASOCKS_API_KEY = '2f74d4c2d93ff6db9016142cb76ed56f';

async function testProxies() {
  const response = await fetch(
    `https://api.asocks.com/v2/proxy/ports?apiKey=${ASOCKS_API_KEY}`
  );
  const data = await response.json();
  
  if (data.success && data.message?.proxies) {
    const proxies = data.message.proxies;
    
    // Count by country
    const byCountry = {};
    proxies.forEach(p => {
      const country = p.countryCode || p.country_code || 'XX';
      byCountry[country] = (byCountry[country] || 0) + 1;
    });
    
    console.log('Total proxies:', proxies.length);
    console.log('By country:', byCountry);
    
    // Show first US proxy
    const usProxy = proxies.find(p => (p.countryCode || p.country_code) === 'US');
    if (usProxy) {
      console.log('\nFirst US proxy:');
      console.log('  Server:', usProxy.server || usProxy.proxy);
      console.log('  Login:', usProxy.login);
      console.log('  Country:', usProxy.countryCode || usProxy.country_code);
    }
  }
}

testProxies();
