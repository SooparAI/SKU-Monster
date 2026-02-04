// Store configurations for SKU-based image scraping
// Generated from parallel research of 20 fragrance retail stores

export interface StoreConfig {
  name: string;
  baseUrl: string;
  searchUrlTemplate: string;
  selectors: {
    productLink: string;
    productImage: string;
    noResults: string;
    pagination?: string;
  };
  headers?: Record<string, string>;
  rateLimit: number;
  notes: string;
  isActive: boolean;
}

export const storeConfigs: StoreConfig[] = [
  {
    name: "Jomashop",
    baseUrl: "https://www.jomashop.com",
    searchUrlTemplate: "https://www.jomashop.com/search?q={sku}",
    selectors: {
      productLink: "a.product-card-link",
      productImage: "img.slide-item-main-image, .product-gallery img",
      noResults: "div.search-empty-container",
    },
    rateLimit: 1000,
    notes: "Luxury watches and fragrances. Dynamic loading may require wait.",
    isActive: true,
  },
  {
    name: "FragranceX",
    baseUrl: "https://www.fragrancex.com",
    searchUrlTemplate: "https://www.fragrancex.com/search/search_results?sText={sku}",
    selectors: {
      productLink: ".div-featured-img > a",
      productImage: "#main-product-image, #thumbnail-carousel a img",
      noResults: ".nomatch",
    },
    rateLimit: 1500,
    notes: "Discount fragrance retailer. Good SKU search support.",
    isActive: true,
  },
  {
    name: "FragranceNet",
    baseUrl: "https://www.fragrancenet.com",
    searchUrlTemplate: "https://www.fragrancenet.com/search?q={sku}",
    selectors: {
      productLink: "div.result a",
      productImage: "img.hover-zoom-image, .product-image img",
      noResults: "div.n-found",
    },
    rateLimit: 1000,
    notes: "Online fragrance store with good search.",
    isActive: true,
  },
  {
    name: "Maxaroma",
    baseUrl: "https://www.maxaroma.com",
    searchUrlTemplate: "https://www.maxaroma.com/p4u/key-{sku}/view",
    selectors: {
      productLink: "a.product-image-photo",
      productImage: "div.fotorama__stage__frame img, .gallery-placeholder img",
      noResults: "p.note-msg",
    },
    rateLimit: 1000,
    notes: "Fragrance and beauty retailer.",
    isActive: true,
  },
  {
    name: "Walmart",
    baseUrl: "https://www.walmart.com",
    searchUrlTemplate: "https://www.walmart.com/search?q={sku}",
    selectors: {
      productLink: "a[data-testid='product-title-link']",
      productImage: "img.hover-zoom-hero-image, img[data-testid='product-image']",
      noResults: "div[data-testid='zero-results']",
    },
    rateLimit: 2000,
    notes: "Major US retailer. Strong anti-bot protection - may require special handling.",
    isActive: false, // Disabled due to anti-bot protection
  },
  {
    name: "Amazon",
    baseUrl: "https://www.amazon.com",
    searchUrlTemplate: "https://www.amazon.com/s?k={sku}",
    selectors: {
      productLink: "a.a-link-normal.s-no-outline",
      productImage: "img.s-image, #landingImage, #imgTagWrapperId img",
      noResults: ".s-no-results-message",
    },
    rateLimit: 2000,
    notes: "E-commerce marketplace. Strong anti-bot measures - may have limited success.",
    isActive: false, // Disabled due to anti-bot protection
  },
  {
    name: "Sephora",
    baseUrl: "https://www.sephora.com",
    searchUrlTemplate: "https://www.sephora.com/search?keyword={sku}",
    selectors: {
      productLink: "a[data-test-id='product-link']",
      productImage: "img[data-test-id='product-image'], .product-image img",
      noResults: "[data-test-id='no-results']",
    },
    rateLimit: 2000,
    notes: "Beauty retailer. May have anti-bot measures.",
    isActive: false, // Disabled due to anti-bot protection
  },
  {
    name: "Nordstrom",
    baseUrl: "https://www.nordstrom.com",
    searchUrlTemplate: "https://www.nordstrom.com/browse/search?keyword={sku}",
    selectors: {
      productLink: "a[href*='/s/']",
      productImage: "img[alt*='product'], .product-photo img",
      noResults: "div[data-test-id='no-results']",
    },
    rateLimit: 1000,
    notes: "Department store. Anti-bot protection may apply.",
    isActive: false, // Disabled due to anti-bot protection
  },
  {
    name: "Macy's",
    baseUrl: "https://www.macys.com",
    searchUrlTemplate: "https://www.macys.com/shop/featured/{sku}",
    selectors: {
      productLink: "a.brand-and-name",
      productImage: "img[data-auto='product-image'], .product-image img",
      noResults: "div.no-results-container",
    },
    rateLimit: 1500,
    notes: "Department store.",
    isActive: true,
  },
  {
    name: "Ulta Beauty",
    baseUrl: "https://www.ulta.com",
    searchUrlTemplate: "https://www.ulta.com/search?search={sku}",
    selectors: {
      productLink: ".product-card-link",
      productImage: ".MediaWrapper__Image img, .product-image img",
      noResults: "h1:contains('We couldn\\'t find any results')",
    },
    rateLimit: 1000,
    notes: "Beauty retailer. Dynamic loading for search results.",
    isActive: true,
  },
  {
    name: "BeautyTheShop",
    baseUrl: "https://www.beautytheshop.com",
    searchUrlTemplate: "https://www.beautytheshop.com/es/buscar?search={sku}",
    selectors: {
      productLink: ".product-image-container a",
      productImage: "#product-image-container img, #product-image-thumbs img",
      noResults: ".search-no-results",
    },
    rateLimit: 1000,
    notes: "Online beauty store. Spanish interface.",
    isActive: true,
  },
  {
    name: "50-ml.com",
    baseUrl: "https://50-ml.com",
    searchUrlTemplate: "https://50-ml.com/catalogsearch/result?q={sku}",
    selectors: {
      productLink: "a.product.photo",
      productImage: "img.fotorama__img, .product-image img",
      noResults: "div.message.info.empty",
    },
    rateLimit: 1000,
    notes: "Niche fragrance retailer. SKU search may be limited.",
    isActive: true,
  },
  {
    name: "Maple Prime",
    baseUrl: "https://mapleprime.com",
    searchUrlTemplate: "https://mapleprime.com/pages/search?q={sku}",
    selectors: {
      productLink: ".snize-product-list-item-image a",
      productImage: ".product-gallery__media img, .product-image img",
      noResults: ".snize-page-title",
    },
    rateLimit: 1000,
    notes: "Fragrance retailer. Shopify-based.",
    isActive: true,
  },
  {
    name: "Luxe Fora",
    baseUrl: "https://luxefora.com",
    searchUrlTemplate: "https://luxefora.com/search?q={sku}",
    selectors: {
      productLink: "a.full-unstyled-link",
      productImage: "div.product__media-item img, .product-image img",
      noResults: "h2.template-search__title",
    },
    rateLimit: 1000,
    notes: "Luxury fragrance store. Shopify-powered.",
    isActive: true,
  },
  {
    name: "Fandi Perfume",
    baseUrl: "https://fandi-perfume.com",
    searchUrlTemplate: "https://fandi-perfume.com/search?q={sku}",
    selectors: {
      productLink: ".product-card a",
      productImage: ".product-gallery img, .product-image img",
      noResults: ".search-no-results",
    },
    rateLimit: 1000,
    notes: "Middle East fragrance retailer. SKU search may be limited.",
    isActive: false, // May not support SKU search
  },
  {
    name: "Paris Gallery",
    baseUrl: "https://parisgallery.ae",
    searchUrlTemplate: "https://parisgallery.ae/search?q={sku}&options%5Bprefix%5D=last",
    selectors: {
      productLink: "a.grid-view-item__link",
      productImage: "img.product-single__photo-img, .product-image img",
      noResults: "h1.template-search__title",
    },
    rateLimit: 1000,
    notes: "UAE luxury retailer.",
    isActive: true,
  },
  {
    name: "Elegance Style",
    baseUrl: "https://elegancestyle.ae",
    searchUrlTemplate: "https://elegancestyle.ae/catalogsearch/result/?q={sku}",
    selectors: {
      productLink: "a.product-item-link",
      productImage: "img.gallery-placeholder__image, .product-image img",
      noResults: ".message.info.empty",
    },
    rateLimit: 1000,
    notes: "UAE beauty retailer. Magento-based.",
    isActive: true,
  },
  {
    name: "V Perfumes",
    baseUrl: "https://www.vperfumes.com",
    searchUrlTemplate: "https://www.vperfumes.com/ae-en/products?search={sku}",
    selectors: {
      productLink: "div.product-card > a",
      productImage: "figure.relative img, .product-image img",
      noResults: "div.text-center.my-5 > h3",
    },
    rateLimit: 1000,
    notes: "UAE fragrance retailer.",
    isActive: true,
  },
  {
    name: "Alluring Auras",
    baseUrl: "https://www.alluringauras.com",
    searchUrlTemplate: "https://www.alluringauras.com/?s={sku}&product_cat=&post_type=product",
    selectors: {
      productLink: "h3.tbay-woocommerce-title-product a",
      productImage: "div.woocommerce-product-gallery__image > a > img, .product-image img",
      noResults: "p.woocommerce-info",
    },
    rateLimit: 1000,
    notes: "Online fragrance store. WooCommerce-based.",
    isActive: true,
  },
  {
    name: "Eshtir.com",
    baseUrl: "https://www.eshtir.com",
    searchUrlTemplate: "https://www.eshtir.com/?s={sku}&post_type=product",
    selectors: {
      productLink: "a.woocommerce-LoopProduct-link",
      productImage: ".woocommerce-product-gallery__image img, .product-image img",
      noResults: ".woocommerce-info",
    },
    rateLimit: 1000,
    notes: "Middle East e-commerce. WooCommerce-based.",
    isActive: true,
  },
];

// Get all active stores
export function getActiveStores(): StoreConfig[] {
  return storeConfigs.filter(store => store.isActive);
}

// Get store by name
export function getStoreByName(name: string): StoreConfig | undefined {
  return storeConfigs.find(store => store.name.toLowerCase() === name.toLowerCase());
}

// Build search URL for a store and SKU
export function buildSearchUrl(store: StoreConfig, sku: string): string {
  return store.searchUrlTemplate.replace("{sku}", encodeURIComponent(sku));
}
