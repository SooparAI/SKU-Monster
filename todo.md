# Photo.1 - SKU Image Scraper TODO

## Authentication & User Management
- [x] User registration and login via OAuth
- [x] User profile page with balance display
- [x] Session management

## Payment & Balance System
- [x] User balance tracking in database
- [x] Stripe payment integration for top-up
- [ ] Solana Pay integration for top-up (Coming Soon)
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
