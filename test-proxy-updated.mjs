// Test updated proxy loading with pagination
const ASOCKS_API_KEY = '2f74d4c2d93ff6db9016142cb76ed56f';
const PREFERRED_COUNTRIES = ['US', 'CA', 'GB', 'AU'];

async function testProxies() {
  const allProxies = [];
  let page = 1;
  let totalPages = 1;
  
  do {
    const response = await fetch(
      `https://api.asocks.com/v2/proxy/ports?apiKey=${ASOCKS_API_KEY}&page=${page}`
    );
    const data = await response.json();
    
    if (data.success && data.message?.proxies) {
      const activeProxies = data.message.proxies.filter(p => p.status === 1 || p.status === 2);
      allProxies.push(...activeProxies);
      
      if (data.message.pagination) {
        totalPages = data.message.pagination.pageCount;
      }
    }
    page++;
  } while (page <= totalPages);
  
  // Separate by country preference
  const usProxies = allProxies.filter(p => PREFERRED_COUNTRIES.includes(p.countryCode));
  const otherProxies = allProxies.filter(p => !PREFERRED_COUNTRIES.includes(p.countryCode));
  
  console.log(`Total proxies: ${allProxies.length}`);
  console.log(`US/Preferred proxies: ${usProxies.length}`);
  console.log(`Other proxies: ${otherProxies.length}`);
  
  // Show first 3 US proxies
  console.log('\nFirst 3 US proxies:');
  usProxies.slice(0, 3).forEach((p, i) => {
    console.log(`  ${i+1}. ${p.proxy} (${p.countryCode}) - ${p.login}`);
  });
}

testProxies();
