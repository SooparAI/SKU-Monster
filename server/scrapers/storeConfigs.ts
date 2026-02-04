// Store configurations for SKU image scraping
// Fine-tuned by parallel agents to extract ONLY high-quality product images

export interface StoreConfig {
  name: string;
  baseUrl: string;
  searchUrlTemplate: string;
  selectors: {
    productLink: string;
    productImage: string;
    noResults: string;
    productFound: string;
    pagination?: string;
  };
  imageConfig: {
    highResAttribute: string;
    urlPatternFilter: RegExp;
    minWidth: number;
    minHeight: number;
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
      productLink: ".product-container a",
      productImage: ".img-fluid.product-main-image-gallery, img#product-main-image-gallery",
      noResults: ".search-result-title:contains('0 results')",
      productFound: ".product-name, #product-main-image-gallery",
    },
    imageConfig: {
      highResAttribute: "src",
      urlPatternFilter: /logo|icon|banner|sprite|thumb|placeholder/i,
      minWidth: 300,
      minHeight: 300,
    },
    rateLimit: 500,
    notes: "Luxury watches and fragrances. Uses main gallery image.",
    isActive: true,
  },
  {
    name: "FragranceX",
    baseUrl: "https://www.fragrancex.com",
    searchUrlTemplate: "https://www.fragrancex.com/search?q={sku}",
    selectors: {
      productLink: "div.grid-x a, a[href*='/products/']",
      productImage: "div.product-image-wrap img, img[src*='products/parent'], img[src*='products/sku']",
      noResults: ".r-zero-results-wrap, .no-results",
      productFound: "#product-layout, .product-page",
    },
    imageConfig: {
      highResAttribute: "src",
      urlPatternFilter: /logo|icon|banner|sprite|thumb|placeholder|_small|_tiny|assets\/ui/i,
      minWidth: 300,
      minHeight: 300,
    },
    rateLimit: 500,
    notes: "Dynamic loading. Target parent/medium images for highest resolution.",
    isActive: true,
  },
  {
    name: "FragranceNet",
    baseUrl: "https://www.fragrancenet.com",
    searchUrlTemplate: "https://www.fragrancenet.com/search/{sku}",
    selectors: {
      productLink: "a.g-a.result-imagelink, div.result a",
      productImage: "meta[property='og:image'], img.img-responsive.main-image",
      noResults: ".alert-danger, .n-found",
      productFound: "div.g-a.pdp-top-section, .product-details",
    },
    imageConfig: {
      highResAttribute: "content",
      urlPatternFilter: /logo|icon|banner|sprite|thumb|placeholder/i,
      minWidth: 300,
      minHeight: 300,
    },
    rateLimit: 500,
    notes: "Uses og:image meta tag for high-res images.",
    isActive: true,
  },
  {
    name: "Maxaroma",
    baseUrl: "https://www.maxaroma.com",
    searchUrlTemplate: "https://www.maxaroma.com/search?q={sku}",
    selectors: {
      productLink: ".product-item-info > .product-item-name > a, a.product-image-photo",
      productImage: ".product-image-gallery > img, .gallery-placeholder img",
      noResults: ".note-msg, .no-records",
      productFound: ".product-view, .product-details-main",
    },
    imageConfig: {
      highResAttribute: "data-zoom-image",
      urlPatternFilter: /logo|icon|banner|sprite|thumb|placeholder/i,
      minWidth: 300,
      minHeight: 300,
    },
    rateLimit: 500,
    notes: "Has data-zoom-image attribute for high-res.",
    isActive: true,
  },
  {
    name: "Macy's",
    baseUrl: "https://www.macys.com",
    searchUrlTemplate: "https://www.macys.com/shop/featured/{sku}",
    selectors: {
      productLink: "a.product-desc-link, .productThumbnail a",
      productImage: "div.main-image-container img, .product-image img",
      noResults: ".runway-header, .no-results",
      productFound: "div.product-details, .product-name",
    },
    imageConfig: {
      highResAttribute: "data-src",
      urlPatternFilter: /logo|icon|banner|sprite|thumb|placeholder/i,
      minWidth: 300,
      minHeight: 300,
    },
    rateLimit: 500,
    notes: "Uses data-src for lazy-loaded high-res images.",
    isActive: true,
  },
  {
    name: "Ulta Beauty",
    baseUrl: "https://www.ulta.com",
    searchUrlTemplate: "https://www.ulta.com/search?search={sku}",
    selectors: {
      productLink: "a.ProductCard, .product-card a",
      productImage: ".MediaWrapper__Image img, .product-image img",
      noResults: ".NoResults__container, .no-results",
      productFound: ".ProductPage, .product-details",
    },
    imageConfig: {
      highResAttribute: "src",
      urlPatternFilter: /logo|icon|banner|sprite|thumb|placeholder/i,
      minWidth: 300,
      minHeight: 300,
    },
    rateLimit: 500,
    notes: "SPA - may need wait for dynamic content.",
    isActive: true,
  },
  {
    name: "BeautyTheShop",
    baseUrl: "https://www.beautytheshop.com",
    searchUrlTemplate: "https://www.beautytheshop.com/gb/catalogsearch/result/?q={sku}",
    selectors: {
      productLink: "a.product-image, .product-item a",
      productImage: "img#image-main, .product-image-gallery img",
      noResults: ".page-title > h1:contains('Search results')",
      productFound: ".product-view, .product-info-main",
    },
    imageConfig: {
      highResAttribute: "data-zoom-image",
      urlPatternFilter: /logo|icon|banner|sprite|thumb|placeholder/i,
      minWidth: 300,
      minHeight: 300,
    },
    rateLimit: 500,
    notes: "Has data-zoom-image for high-res.",
    isActive: true,
  },
  {
    name: "50-ml.com",
    baseUrl: "https://50-ml.com",
    searchUrlTemplate: "https://50-ml.com/catalogsearch/result/?q={sku}",
    selectors: {
      productLink: "a.product-item-link, .product-item a",
      productImage: ".product-image-gallery img, .fotorama__img",
      noResults: ".note-msg, .message.info.empty",
      productFound: ".product-info-main, .product-view",
    },
    imageConfig: {
      highResAttribute: "src",
      urlPatternFilter: /logo|icon|banner|sprite|thumb|placeholder/i,
      minWidth: 300,
      minHeight: 300,
    },
    rateLimit: 500,
    notes: "Inconsistent structure - may need fallback selectors.",
    isActive: true,
  },
  {
    name: "Maple Prime",
    baseUrl: "https://mapleprime.com",
    searchUrlTemplate: "https://mapleprime.com/search?q={sku}",
    selectors: {
      productLink: "a.product-item__image-wrapper, .product-card a",
      productImage: "div.swiper-slide-active > img, .product-single__media img",
      noResults: "div.shogun-heading-component:contains('No results')",
      productFound: "div.product-single, .product-info",
    },
    imageConfig: {
      highResAttribute: "src",
      urlPatternFilter: /logo|icon|banner|sprite|thumb|placeholder/i,
      minWidth: 300,
      minHeight: 300,
    },
    rateLimit: 500,
    notes: "Uses swiper for product images.",
    isActive: true,
  },
  {
    name: "Luxe Fora",
    baseUrl: "https://luxefora.com",
    searchUrlTemplate: "https://luxefora.com/search?type=product&q={sku}",
    selectors: {
      productLink: "a.card-wrapper, .product-card a",
      productImage: "div.product__media-item img, .product-image img",
      noResults: ".template-search--empty, .no-results",
      productFound: "h1.product__title, .product-single",
    },
    imageConfig: {
      highResAttribute: "srcset",
      urlPatternFilter: /logo|icon|banner|sprite|thumb|placeholder/i,
      minWidth: 300,
      minHeight: 300,
    },
    rateLimit: 500,
    notes: "Uses srcset for responsive high-res images.",
    isActive: true,
  },
  {
    name: "Paris Gallery",
    baseUrl: "https://parisgallery.ae",
    searchUrlTemplate: "https://parisgallery.ae/search?q={sku}",
    selectors: {
      productLink: "a[href*='/products/'], .product-card a",
      productImage: "meta[property='og:image'], .product-image img",
      noResults: ".shopify-section--main-search:contains('No results')",
      productFound: "h1.product-title, .product-single",
    },
    imageConfig: {
      highResAttribute: "content",
      urlPatternFilter: /logo|icon|banner|sprite|thumb|placeholder/i,
      minWidth: 300,
      minHeight: 300,
    },
    rateLimit: 500,
    notes: "Uses og:image meta tag for high-res.",
    isActive: true,
  },
  {
    name: "Elegance Style",
    baseUrl: "https://elegancestyle.ae",
    searchUrlTemplate: "https://elegancestyle.ae/catalogsearch/result/?q={sku}",
    selectors: {
      productLink: "a.product-item-link, .product-item a",
      productImage: "img.fotorama__img, .product-image-gallery img",
      noResults: ".message.info.empty, .no-results",
      productFound: ".product-info-main, .product-view",
    },
    imageConfig: {
      highResAttribute: "src",
      urlPatternFilter: /logo|icon|banner|sprite|thumb|placeholder/i,
      minWidth: 300,
      minHeight: 300,
    },
    rateLimit: 500,
    notes: "Uses fotorama gallery for product images.",
    isActive: true,
  },
  {
    name: "V Perfumes",
    baseUrl: "https://www.vperfumes.com",
    searchUrlTemplate: "https://www.vperfumes.com/ae-en/products?search={sku}",
    selectors: {
      productLink: "a[href^='/ae-en/product/'], .product-card a",
      productImage: "figure img, .product-image img",
      noResults: "div.text-center > h3:contains('No products')",
      productFound: "h1.md\\:text-2xl, .product-details",
    },
    imageConfig: {
      highResAttribute: "src",
      urlPatternFilter: /logo|icon|banner|sprite|thumb|placeholder/i,
      minWidth: 300,
      minHeight: 300,
    },
    rateLimit: 500,
    notes: "Standard e-commerce layout.",
    isActive: true,
  },
  {
    name: "Alluring Auras",
    baseUrl: "https://www.alluringauras.com",
    searchUrlTemplate: "https://www.alluringauras.com/?s={sku}&product_cat=&post_type=product",
    selectors: {
      productLink: "a.image-fade, .product-item a",
      productImage: "div.woocommerce-product-gallery__image a, .product-image img",
      noResults: "p.woocommerce-info:contains('No products')",
      productFound: "h1.product_title.entry-title, .product-summary",
    },
    imageConfig: {
      highResAttribute: "href",
      urlPatternFilter: /logo|icon|banner|sprite|thumb|placeholder/i,
      minWidth: 300,
      minHeight: 300,
    },
    rateLimit: 500,
    notes: "WooCommerce - uses gallery href for high-res.",
    isActive: true,
  },
  {
    name: "Eshtir.com",
    baseUrl: "https://www.eshtir.com",
    searchUrlTemplate: "https://www.eshtir.com/?s={sku}&post_type=product",
    selectors: {
      productLink: "a.woocommerce-LoopProduct-link, .product-item a",
      productImage: "img.wp-post-image, .product-image img",
      noResults: "p.woocommerce-info:contains('No products')",
      productFound: "div.product-summary, .product-details",
    },
    imageConfig: {
      highResAttribute: "src",
      urlPatternFilter: /logo|icon|banner|sprite|thumb|placeholder/i,
      minWidth: 300,
      minHeight: 300,
    },
    rateLimit: 500,
    notes: "WooCommerce - focuses on electronics, may return wrong products for fragrance SKUs.",
    isActive: false, // Disabled - not a fragrance-focused store
  },
];

// Helper functions
export function getActiveStores(): StoreConfig[] {
  return storeConfigs.filter((store) => store.isActive);
}

export function buildSearchUrl(store: StoreConfig, sku: string): string {
  return store.searchUrlTemplate.replace("{sku}", encodeURIComponent(sku));
}

export function isValidProductImage(url: string, store: StoreConfig): boolean {
  if (!url) return false;
  if (store.imageConfig.urlPatternFilter.test(url)) return false;
  return true;
}
