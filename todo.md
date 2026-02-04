# Photo.1 - SKU Image Scraper TODO

## Authentication & User Management
- [x] User registration and login via OAuth
- [x] User profile page with balance display
- [x] Session management

## Payment & Balance System
- [x] User balance tracking in database
- [x] Stripe payment integration for top-up
- [x] Solana Pay integration for top-up
  - [x] Add Solana wallet address configuration
  - [x] Create Solana Pay URL generation
  - [x] Update TopUp page with Solana payment option
  - [x] Implement manual payment verification
- [x] Transaction history
- [x] Pricing: $15 per SKU scrape

## SKU Input & Processing
- [x] Single SKU input field
- [x] Multiple SKU input (textarea)
- [x] CSV file upload and parsing
- [x] Excel file upload and parsing
- [x] AI processing to extract/validate SKU numbers from input

## Web Scraper (20 Fragrance Stores)
- [x] Jomashop scraper
- [x] FragranceX scraper
- [x] FragranceNet scraper
- [x] Maxaroma scraper
- [x] Walmart scraper
- [x] Amazon scraper
- [x] Sephora scraper
- [x] Nordstrom scraper
- [x] Macy's scraper
- [x] Ulta Beauty scraper
- [x] BeautyTheShop scraper
- [x] 50-ml.com scraper
- [x] Maple Prime scraper
- [x] Luxe Fora scraper
- [x] Fandi Perfume scraper
- [x] Paris Gallery scraper
- [x] Elegance Style scraper
- [x] V Perfumes UAE scraper
- [x] Alluring Auras scraper
- [x] Eshtir.com scraper

## Image Storage & Download
- [x] Store scraped images to S3
- [x] Create SKU-named folders for each product
- [x] Generate "Photo.1 Output" master folder with all SKU folders
- [x] Zip generation for download
- [x] Download functionality

## Order Management
- [x] Order creation with credit check
- [x] Partial processing when credits run out
- [x] Order history display
- [x] Re-download previous orders
- [x] Low balance notification

## Database Schema
- [x] Users table (extended with balance)
- [x] Transactions table (payments)
- [x] Orders table (scrape jobs)
- [x] Order items table (individual SKUs)
- [x] Scraped images table
- [x] Supported stores table

## UI/UX
- [x] Dashboard layout with sidebar
- [x] Balance display widget
- [x] Top-up modal/page
- [x] SKU input page
- [x] Order history page
- [ ] Profile settings page (Future enhancement)


## Custom Authentication (New Requirement)
- [x] Custom email/password registration
- [x] Custom email/password login
- [x] Password hashing with bcrypt
- [x] JWT session management
- [x] Login page UI
- [x] Register page UI
- [x] Remove Manus OAuth dependency (kept as fallback)


## Bug Fixes
- [x] Fix login for existing OAuth users showing "Please use OAuth to sign in"
- [x] Fix scraper stuck on "Waiting..." status - Fixed zip stream handling
- [x] Fix orders failing with 0 SKUs processed - Added retry functionality for failed/stuck orders
- [x] Debug and fix scraper failing with 0 SKUs processed - Fixed retry logic to allow pending orders


## Scraper Quality Improvements (New Requirement)
- [x] Fine-tune all 20 store scrapers to extract only HQ product images
- [x] Filter out logos, payment icons, banners, and non-product images
- [x] Get highest resolution images (not thumbnails)
- [x] Skip store entirely if product not found (no garbage)
- [x] Minimum image size filter (500x500 pixels using sharp library)
- [x] Parallel scraping (5 stores at a time for ~50s total vs 3+ min sequential)
- [x] Anti-detection measures (puppeteer-extra stealth plugin, random user agents)
- [x] Fragrance product verification (reject non-fragrance products like TVs)
- [x] Limit to 5 images per store to focus on main product images
- [ ] Some stores may rate-limit or block - needs monitoring
