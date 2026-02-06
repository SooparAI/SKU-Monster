# Scraper Optimization Notes

## Current Flow (SLOW):
1. UPC lookup (2s) → gets product name + 6 images
2. If <3 images from UPC: scrape 54 stores in batches of 8 (107s!)
3. HQ pipeline: score each image by downloading + sharp analysis (15-30s)
4. Upscale 2-3 images via Replicate API (30-60s)
5. Upload to S3 (10s)

## Bottlenecks:
- Store scraping: 54 stores × 20s timeout = huge waste when UPC has images
- HQ scoring: downloads each image + runs sharp.stats() sequentially
- Upscaling: sequential, 10-20s each via polling
- Image scoring downloads images TWICE (once for scoring, once for uploading)

## Optimization Plan:
1. UPC-first strategy: If UPC returns 3+ images, SKIP store scraping entirely (already done)
2. Parallel image scoring: Score images in parallel (Promise.all) instead of sequential
3. Parallel upscaling: Upscale all 3 images simultaneously
4. Skip scoring for UPC images: UPC images are already verified product images
5. Reduce store count: Only scrape top 10 most reliable stores as fallback
6. Hard timeouts: 3 min per SKU, auto-kill after
7. Process cleanup on startup: Kill orphaned Chrome on server start
