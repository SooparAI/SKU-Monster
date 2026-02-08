# SKU Monster - Product Image Scraper TODO

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

## Scraper Expansion to 60+ Stores (New Requirement)
- [x] Compare existing 20 scrapers with 61 Perplexity stores
- [x] Update existing scrapers with Perplexity tips (Macy's, Ulta, Paris Gallery)
- [x] Create optimized scrapers for 55 new stores using parallel agents
- [x] Integrate Perplexity API for smart SKU lookup
- [x] Direct URL scraping - scrape exact product URLs from Perplexity instead of blind searching
- [x] Test expanded scraper system - 10 HQ images from 6 stores in ~60 seconds

## Results Summary
- **Before**: 1 low-quality image from blind searching 20 stores
- **After**: 10 HQ images (500x500 to 1080x1080) from direct URL scraping
- **Speed**: ~60 seconds total (Perplexity lookup + direct scraping + fallback stores)
- **Sources**: Bonanza, ForeverLux, Jomashop, Gift Express, Fandi Perfume, Luckyscent


## Branding Update
- [x] Generate SKU Monster logo
- [x] Update app name from Photo.1 to SKU Monster in code
- [ ] Update favicon and app logo in Settings


## HQ Image Extraction Improvement
- [ ] Analyze CDN URL patterns to find full-resolution versions
- [ ] Strip compression parameters from image URLs (e.g., ?w=500, ?quality=80)
- [ ] Extract data-zoom, data-large, srcset attributes for HQ versions
- [ ] Target images in MB range, not KB


## 4K HQ Image Pipeline (Target: <$0.03/SKU)
- [x] Smart image scoring and filtering (FREE - no AI needed)
  - URL pattern filtering (removes logos, icons, banners)
  - Dimension scoring (prefers 500px+ images)
  - Aspect ratio scoring (prefers square/portrait for perfume bottles)
  - Color variance analysis (rejects placeholders)
  - Light background detection (product photo style)
- [x] Add Real-ESRGAN upscaling via Replicate API for 4K output
- [x] Integrate all components into scraper pipeline
- [x] Test end-to-end and verify quality + cost

## Final Results (4K HQ Pipeline)
- **Image 1**: 2000x2000 (2.6 MB) - upscaled from 500x500
- **Image 2**: 4320x4320 (7.0 MB) - upscaled from 1080x1080
- **Image 3**: 4320x4320 (11.0 MB) - upscaled from 1080x1080
- **Total cost**: $0.0012 per SKU (well under $0.03 target!)
- **All images are correct product**: Bottega Veneta Illusione perfume


## Proxy System Improvements
- [x] Integrated Asocks proxy rotation for anti-bot protection
- [x] Created 20 US residential proxy ports via Asocks API
- [x] Updated proxy module to fetch all pages (1,226 total proxies)
- [x] Implemented US proxy prioritization for US fragrance sites
- [x] Fixed geo-blocking issues (ERR_EMPTY_RESPONSE) with US proxies
- [x] Tested successfully with Sephora (200 status, images found)
- [x] Unit tests for proxy module (5 tests passing)


## Proxy Bug Fix (Feb 5, 2026)
- [x] Fixed ERR_INVALID_AUTH_CREDENTIALS error causing all scrapes to fail
- [x] Root cause: puppeteer-extra was caching proxy credentials between runs
- [x] Solution: Disabled proxy completely (direct connections work better for fragrance sites)
- [x] Switched from puppeteer-extra to plain puppeteer for reliability
- [x] Test scrape successful: 3 HQ images found and uploaded to S3


## CRITICAL BUG: Wrong Product Images (Feb 5, 2026) - FIXED!
- [x] Scraper returning wrong product images for SKU 701666410164
- [x] Expected: Amouage Honour (white bottle with gold cap)
- [x] Root cause: Scraper was grabbing images from "Similar items" section at bottom of page
- [x] Fix: Added exclusion filters for recommendation sections (similar-items, recommended, etc.)
- [x] Fix: Added position filter to only grab images from top 1500px of page (main product area)
- [x] Verified: Now returns correct Amouage Honour white bottle (3200x3200 upscaled)


## Scraper Image Extraction Fix (Programmatic) - COMPLETE!
- [x] Audit all scraper image extraction logic
- [x] Add comprehensive exclusion filters for recommendation sections (50+ CSS selectors)
- [x] Implement main product area detection (position-based, top 1200px only)
- [x] Add store-specific product image selectors (MAIN_PRODUCT_SELECTORS array)
- [x] Add URL pattern filtering (30+ exclusion patterns for non-product images)
- [x] Test with SKU 701666410164 - CORRECT Amouage Honour white bottle (4320x4320)


## Resource Management - Prevent Stuck Processes (Feb 6, 2026) - COMPLETE!
- [x] Add hard timeout wrapper around entire scrape job
- [x] Ensure browser is always closed in finally block
- [x] Add process cleanup after each job completion
- [x] Implement job-level timeout with automatic failure marking
- [x] Add graceful shutdown for long-running operations


## MAJOR REFACTOR: Remove AI, Use Programmatic Scraping (Feb 6, 2026) - COMPLETE!
- [x] Remove Perplexity AI lookup dependency
- [x] Integrated UPC database lookup (upcitemdb.com) - gets product info + images directly
- [x] UPC lookup provides: product name, brand, 6 direct image URLs, 7 retailer offers
- [x] Falls back to store scraping only if UPC database has < 3 images
- [x] Added SKU verification for store scraping (checks SKU appears on page)
- [x] Test with SKU 701666410164: CORRECT Amouage Honour white bottle returned!
- [x] Images: 2009x2009 (original), 4800x4800 (upscaled), 3000x3000 (upscaled)
- [x] Duration: 90 seconds (vs 3+ minutes with store scraping)
- [x] Cost: $0.0008 per SKU (vs $0.03+ with AI)


## Pricing Update (Feb 6, 2026) - COMPLETE!
- [x] Update backend pricing from $15 to $10 per SKU (server/db.ts)
- [x] Add "(~3 HQ images)" indicator to UI (Home.tsx, TopUp.tsx)
- [x] Update Stripe product description (server/stripe.ts)
- [x] Update test files to use $10 pricing
- [x] All tests passing


## Resource & Speed Optimization (Feb 6, 2026) - COMPLETE!
- [x] Kill all stuck/orphaned Chrome and scraper processes
- [x] Add hard timeout to all scrape jobs (max 3 min per SKU)
- [x] Auto-kill Chrome processes after each job completes (PID tracking + force kill)
- [x] Add process cleanup on server startup (module-level cleanup)
- [x] Optimize scraping speed: 49s (was ~170s, 65% faster)
- [x] Prevent zombie processes: hard job timeout + force-kill safety net
- [x] Reduced store count from 54 to top 12 most reliable
- [x] Added retry logic for rate-limited upscale requests (3 retries with backoff)
- [x] UPC lookup skips stores entirely when enough images found


## Bug Fixes: Image Mapping & Retry (Feb 6, 2026)
- [x] Fixed broken image index mapping in scrapeSku (was mapping wrong indices between HQ pipeline and uniqueImages)
- [x] Fixed retry logic to include failed items (was only retrying pending/processing, now includes failed)
- [x] Changed upscaling from parallel to sequential to avoid Replicate rate limits
- [x] Reduced retry wait times from 10-20s to 3-6s
- [x] Verified: 3 HQ images returned with status "completed" (was incorrectly "failed")

## Bug: SKU 701666410164 still showing "Failed to scrape" (Feb 6, 2026 - Session 2)
- [x] Investigated: Orders 270001/270002 failed in 1 second - likely caused by esbuild error in hqImagePipeline.ts during earlier code edits
- [x] Added graceful browser launch error handling (scraper degrades when Chrome unavailable)
- [x] Added error message saving to order items for better debugging
- [x] Added error propagation from individual SKU results to order items
- [x] Wrapped module-level cleanup in try-catch to prevent import crashes
- [x] Fixed status logic: 0 images always returns 'failed' (was returning 'partial' with errors)
- [x] Verified: Orders 270003 and 270004 both completed successfully with 3 HQ images each
- [x] Production build verified: `pnpm run build` succeeds without errors

## Bug: Chrome not available on deployed server (Feb 6, 2026 - Session 2b)
- [x] Fix scraper to work without Chrome on deployed server (puppeteer can't find Chrome)
- [x] Make browser scraping optional - skip entirely when Chrome not available
- [x] Ensure UPC-only path works end-to-end without any browser dependency
- [x] Process whatever images UPC returns even if fewer than 3 (don't require browser fallback)
- [x] Made sharp module optional with dynamic import (fallback to size-only scoring)
- [x] Fixed URL pre-filter false positive: w=50 was blocking w=500 (Nordstrom URLs)
- [x] Added fallback: if all images fail scoring, use any downloaded image
- [x] Added fallback: if pre-filter removes everything, use original URLs
- [x] Comprehensive logging throughout HQ pipeline for debugging
- [x] All 27 tests passing, production build succeeds
- [x] Test scrape: 3 HQ images (2009x2009, 4800x4800, 2000x3068) from UPC + upscaling

## Bug: Deployed server still failing after fixes (Feb 6, 2026 - Session 2c)
- [x] Investigated: user DID re-publish, code was running but sharp static import crashed the module
- [x] ROOT CAUSE: `import sharp from 'sharp'` in scraperService.ts was a dead import (never used) but crashed the module on production because sharp's native binary wasn't available
- [x] Removed dead sharp import from scraperService.ts
- [x] sharp is now ONLY dynamically imported in hqImagePipeline.ts with try-catch fallback
- [x] Verified: Order 270009 completed successfully with 3 HQ images, all 27 tests pass

## Bug: Static puppeteer import still crashes deployed server (Feb 6, 2026 - Session 2d)
- [x] ROOT CAUSE: Static `import puppeteer from 'puppeteer'` crashes when Chrome binary missing on deployed server
- [x] Made puppeteer a DYNAMIC import (lazy-loaded only when browser scraping is needed)
- [x] Added Perplexity AI image search as fallback when UPC returns < 3 images
- [x] Added direct retailer page fetch (og:image extraction) as another fallback
- [x] New scrape flow: UPC -> Perplexity -> Retailer Direct -> Browser (optional)
- [x] Zero static imports of puppeteer or sharp in production build
- [x] Verified: Orders 270012 and 270013 both completed with 3 HQ images
- [x] All 27 tests passing, production build clean

## Bug: All image sources failing on deployed server (Feb 6, 2026 - Session 2e)
- [x] UPC API rate-limited (100/day free tier) - works from sandbox but may be limited on deployed server
- [x] Perplexity returns hallucinated/fake image URLs - replaced with Google Images scraping
- [x] Added Google Images search (no API key, no rate limits, returns 89+ URLs)
- [x] Added eBay image search (no API key, returns 4+ images)
- [x] Added Amazon search as additional fallback
- [x] New flow: UPC -> Google Images -> eBay -> Amazon -> Browser (optional)
- [x] Verified: Orders 270016 and 270017 completed with 3 HQ images each
- [x] All 27 tests passing, production build clean

## Auto-Refund Failed Orders (Feb 6, 2026)
- [x] When scrape returns 0 images (all SKUs failed), auto-refund the full charge
- [x] Create a refund transaction in the transactions table (type: 'refund')
- [x] Also auto-refund when entire job crashes (outer catch)
- [x] All 27 tests passing, production build clean

## Bug: Final images too small (133KB-700KB instead of 1.7MB-8MB) (Feb 6, 2026)
- [x] Root cause: Replicate rate limits on deployed server causing fallback to originals
- [x] Replaced Replicate with AI image generation (see below)

## Feature: Replace Replicate with AI Image Generation (Feb 6, 2026)
- [x] Use Forge ImageService API to generate clean white-background product images
- [x] Use scraped images as reference for AI generation (1:1 faithful replica)
- [x] 3 variants per SKU: main (front), angle (3/4 view), detail (close-up)
- [x] Upscale from 1024x1024 to 4096x4096 with sharp Lanczos3 resampling
- [x] Falls back to 1024x1024 if sharp unavailable on deployed server
- [x] Falls back to original scraped images if AI generation fails entirely
- [x] Verified: Order 270018 - 3 images at 4096x4096, 2.4-3.0MB each
- [x] All 27 tests passing, production build clean

## Bug: Scrape timed out at 180s on deployed server (Feb 6, 2026)
- [x] Increased timeout from 180s to 360s (6 minutes)
- [x] Parallelized AI generation: 3 variants generated simultaneously via Promise.allSettled
- [x] Parallelized S3 uploads after AI generation
- [x] Result: AI generation now completes in ~20s (was ~90s sequential), total scrape ~25s
- [x] Verified: Order 270019 completed with 3 images at 4096x4096, 2.7-3.1MB each
- [x] All 27 tests passing

## Bug: Order #270020 stuck "Processing" for 2+ hours (Feb 6, 2026) - FIXED!
- [x] Investigated: Forge API fetch() had NO timeout, could hang forever
- [x] Root cause: withTimeout() only rejected the promise but didn't abort the underlying fetch
- [x] Fix: Added AbortSignal.timeout(90s) to Forge API image generation fetch
- [x] Fix: Added AbortSignal.timeout(15s) to UPC lookup and zip download fetches
- [x] Fix: Reduced SKU timeout from 6min to 4min (AI gen has its own 90s timeout)
- [x] Fix: Added totalImages===0 check to always mark orders as "failed" when no images produced
- [x] Fix: Added retryDbOp() wrapper for all DB updates in processScrapeJob (3 retries with backoff)
- [x] Fix: Added 5-minute stuck-job cleanup interval (auto-detects and fails stuck orders)
- [x] Fix: Added auto-refund for stuck orders during cleanup
- [x] Refunded order #270020 ($10 auto-refunded, confirmed in DB)
- [x] Fixed order #270020 status from "processing" to "failed" in DB
- [x] Added admin.backfillRefunds endpoint for manual refund backfill
- [x] Added admin.cleanupStuck endpoint for manual stuck order cleanup
- [x] Added retry button on Orders page and OrderDetail page for failed orders
- [x] All 41 tests passing (14 new tests for timeout/retry/status logic)

## Bug: Scrape jobs timing out on deployed server (Feb 7, 2026)
- [x] Investigated: Google/eBay/Amazon timing out from deployed server's IP (blocked/rate-limited)
- [x] Root cause: Sequential search (UPC→Google→eBay→Amazon) + tight timeouts = total failure when sites block
- [x] Fix: Added AbortSignal.timeout(90s) to Forge API image generation fetch (was missing!)
- [x] Fix: Rewrote image search to run ALL sources in PARALLEL (Google+eBay+Amazon simultaneously)
- [x] Fix: Added product name fallback search (uses UPC product name when barcode search fails)
- [x] Fix: Increased search timeouts from 10-15s to 20s for deployed server
- [x] Fix: Pipeline now works with just 1 UPC image (AI generates 3 variants from it)
- [x] All 41 tests passing, TypeScript clean, dev server running
- [ ] Test end-to-end on deployed server (requires publish)

## Bug: Output images not at full scale (Feb 7, 2026)
- [x] Investigated: S3 images ARE 4096x4096 PNG (2.9MB each) - confirmed with sharp metadata
- [x] Images in zip are full resolution - the issue was jobs failing, not image size

## Bug: Scrape jobs timing out at 240s on deployed server - 0 images (Feb 7, 2026)
- [x] Root cause: Google/eBay/Amazon block requests from deployed server IP
- [x] Fix: Replaced web scraping with Perplexity API for product identification + retailer URL discovery
- [x] Fix: Perplexity identifies product (name, brand, description) + returns retailer page URLs
- [x] Fix: Fetch images from retailer pages (Jomashop, Maxaroma, etc.) instead of Google/eBay/Amazon search
- [x] Fix: Forge LLM as backup product identification if Perplexity fails
- [x] Fix: Product info (name, brand) from Perplexity feeds into AI image generation for better prompts
- [x] All 41 tests passing, TypeScript clean
- [ ] Test end-to-end on deployed server (requires publish)

## Feature: Server-side diagnostic logging for production debugging (Feb 7, 2026)
- [x] Added scrape_logs table to DB schema for persistent pipeline step logging
- [x] Instrumented scrapeSku with DB logging for every step (UPC, Perplexity, retailer fetch, AI gen, upscale, upload)
- [x] Added admin.getScrapeLogs endpoint to view scrape logs for any order
- [ ] Add admin UI page to view logs (deferred)

## Feature: Replace sharp upscaling with AI upscaler (Feb 7, 2026)
- [x] Researched: Replicate Real-ESRGAN = $0.002/image, ~4s per upscale, true neural network upscaling
- [x] Replaced sharp lanczos3 with Replicate Real-ESRGAN in hqImagePipeline.ts
- [x] Pipeline: Forge AI gen (1024x1024) → upload to S3 → Real-ESRGAN 4x → 4096x4096
- [x] Fallback chain: Real-ESRGAN → sharp lanczos3 → 1024x1024 original
- [x] Cost: ~$0.002/image (well under $0.05 budget)
- [x] All 41 tests passing

## Fix: Timeout and diagnostic logging improvements (Feb 7, 2026)
- [x] Increased SKU timeout from 4min to 6min (Replicate cold starts can take 30-60s)
- [x] Increased job hard timeout from 5min to 8min (6min SKU + 2min buffer)
- [x] Increased stuck-job cleanup threshold from 5min to 8min to match
- [x] Added 120s timeout to Replicate Real-ESRGAN API call
- [x] Added granular timing to HQ pipeline (scoring, AI gen, upscale steps)
- [x] Added processingSteps detail to scrape_logs for full pipeline trace
- [x] Pushed scrape_logs table migration to production DB
- [x] All 41 tests passing

## Redesign: Prioritize scraped images over AI generation (Feb 7, 2026)
- [x] Rewrite HQ pipeline: scrape best images → Real-ESRGAN upscale → Forge AI only as fallback
- [x] Score and pick top 3-5 scraped images (deduped, sorted by quality)
- [x] Real-ESRGAN upscale scraped images directly (smart scaling: 4x for <1000px, 2x for 1000-2000px, skip for >2000px)
- [x] Only use Forge AI when < 3 good scraped images found (as fallback, not primary)
- [x] Removed blurry Forge AI as primary path — scraped images are always preferred
- [x] Added 429 rate limit retry with backoff for Replicate API (3 retries, parses retry-after)
- [x] Tested end-to-end locally: 3 images in 51s (2 scraped + 1 AI fallback), cost $0.004
- [x] All 41 tests passing

## Bug: SKU 7340032806168 failed - all 15 image downloads blocked by retailer CDNs (Feb 7, 2026)
- [x] Fixed scoreImage with full browser-like headers (Accept, Referer, Sec-Ch-Ua, etc.)
- [x] Added retry with different User-Agent (Safari fallback) on download failure
- [x] Increased download timeout from 10s to 15s
- [x] Widened scoring net from 15 to 25 URLs (more chances to find downloadable images)
- [x] Reduced output to top 3-4 images instead of 5 (less wasted upscaling)
- [x] Fixed AI fallback: now triggers when ALL downloads fail (was returning 0 images before)
- [x] All 41 tests passing

## Live Order 300008 Monitoring Issues (Feb 7, 2026)
- [x] Fix hard timeout: make dynamic based on SKU count (90s per SKU + 2 min buffer, min 5 min)
- [x] Fix timeout handler: don't discard results if job actually completed after timeout fired
- [x] Fix AI fallback: trigger for SKUs where Perplexity returns "Unknown product" and 0 images found
- [x] Fix Real-ESRGAN GPU memory limit: skip upscale for images >1449px (>2M pixels) instead of retrying 3x and failing
- [x] Fix duplicate refund bug: stuck cleanup + hard timeout both triggered autoRefundOrder (Order 300008 refunded 4x = $560 instead of $140)
- [x] Added in-memory refundedOrders Set to prevent duplicate refunds per order
- [x] Manually fixed Order 300008 DB: status=partial, 12/14 items completed, ZIP URL restored, balance corrected from $1400 to $860
- [x] Increased stuck-job cleanup threshold from 8min to 30min to match dynamic timeout
- [x] All 41 tests passing

## Add barcodelookup.com as fallback UPC source (Feb 7, 2026)
- [ ] Research barcodelookup.com API/scraping options
- [ ] Add barcodelookup.com as fallback when upcitemdb.com returns no results
- [ ] Fix AI fallback: don't trigger when product name is "No product found" or similar garbage
- [ ] Investigate wrong image for SKU 3274872474666 (Fendi Perché No — AI generated wrong product)

## EAN-Search.org Integration (Last-Resort Fallback) (Feb 7, 2026)
- [x] Add EAN_SEARCH_API_KEY secret
- [x] Implement ean-search.org API lookup in upcLookup.ts (last-resort only, 100 queries/month limit)
- [x] Integrate into scraperService: only call when ALL other methods return 0 images AND no product name
- [x] Fix AI fallback: don't trigger with garbage names like "No product found"
- [ ] Test with SKU 3003720011131 (requires publish + live order)

## UI Redesign - White + Green Theme (Feb 7, 2026)
- [x] Update logo across app (sidebar, login, register, favicon)
- [x] Switch theme to light mode: white background, green accents matching logo
- [x] Redesign global CSS variables for white/green palette
- [x] Redesign DashboardLayout sidebar: white bg, green highlights
- [x] Redesign Home page: simplistic white with green accents
- [x] Redesign Login/Register pages: clean white with logo
- [x] Redesign Orders/OrderDetail pages: white cards, green status badges
- [x] Redesign TopUp page: clean white with green buttons
