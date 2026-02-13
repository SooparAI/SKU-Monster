/**
 * Image Post-Processing Module
 * 
 * 1. normalizeImage() — Resize and pad to uniform 1000x1000 white-background square
 * 2. detectWatermark() — Comprehensive pixel-based watermark detection (no AI, $0 cost)
 *    Scans the FULL image in a grid — catches center watermarks, not just edges.
 * 
 * Both use sharp (already a project dependency). Zero external API calls.
 */

// Dynamic sharp import
let sharpModule: any = null;
let sharpLoaded = false;

async function getSharp(): Promise<any> {
  if (sharpLoaded) return sharpModule;
  sharpLoaded = true;
  try {
    const mod = await import('sharp');
    sharpModule = mod.default || mod;
  } catch {
    sharpModule = null;
  }
  return sharpModule;
}

const TARGET_SIZE = 1000; // 1000x1000 output
const BG_COLOR = { r: 255, g: 255, b: 255, alpha: 1 }; // Pure white

/**
 * Normalize an image buffer to a uniform 1000x1000 white-background square.
 * - Maintains aspect ratio
 * - Centers the image on a white canvas
 * - Outputs PNG for consistency
 * 
 * Returns null if sharp is unavailable (image passes through unchanged).
 */
export async function normalizeImage(buffer: Buffer): Promise<{
  buffer: Buffer;
  width: number;
  height: number;
} | null> {
  const sharp = await getSharp();
  if (!sharp) {
    console.warn('[Normalize] sharp not available, skipping normalization');
    return null;
  }

  try {
    const metadata = await sharp(buffer).metadata();
    const origW = metadata.width || 0;
    const origH = metadata.height || 0;

    if (origW === 0 || origH === 0) {
      console.warn('[Normalize] Could not read image dimensions');
      return null;
    }

    // Leave a small margin (8%) so the product doesn't touch the edges
    const maxFit = Math.floor(TARGET_SIZE * 0.92); // 920px max product area
    const scale = Math.min(maxFit / origW, maxFit / origH, 1);
    
    let fitW = Math.round(origW * scale);
    let fitH = Math.round(origH * scale);

    // If the image is already very small, scale up to fill the area better
    if (origW < 300 && origH < 300) {
      const upScale = Math.min(maxFit / origW, maxFit / origH);
      fitW = Math.round(origW * upScale);
      fitH = Math.round(origH * upScale);
    }

    const resized = await sharp(buffer)
      .resize(fitW, fitH, {
        fit: 'inside',
        withoutEnlargement: false,
        kernel: 'lanczos3',
      })
      .png()
      .toBuffer();

    const normalized = await sharp({
      create: {
        width: TARGET_SIZE,
        height: TARGET_SIZE,
        channels: 4,
        background: BG_COLOR,
      },
    })
      .composite([{
        input: resized,
        gravity: 'centre',
      }])
      .png({ quality: 95, compressionLevel: 6 })
      .toBuffer();

    console.log(`[Normalize] ${origW}x${origH} → ${TARGET_SIZE}x${TARGET_SIZE} (product area: ${fitW}x${fitH}, ${(normalized.length / 1024).toFixed(1)}KB)`);
    return { buffer: normalized, width: TARGET_SIZE, height: TARGET_SIZE };
  } catch (err) {
    console.error(`[Normalize] Error: ${err}`);
    return null;
  }
}

/**
 * Comprehensive watermark detection using pixel analysis.
 * Returns a confidence score 0-100 (higher = more likely watermarked).
 * 
 * Scans the FULL image in a grid pattern — catches watermarks placed ANYWHERE,
 * including center (like "beauty everything" overlays on product photos).
 * 
 * Detection strategy:
 * 1. Full-image grid scan — divide into 3x3 grid, detect semi-transparent text in each cell
 * 2. Center zone focus — watermarks are often placed dead center to defeat edge-only filters
 * 3. Edge-based text detection — Sobel/Laplacian to find thin text strokes across the image
 * 4. Alpha/transparency anomaly — semi-transparent overlays reduce local contrast
 * 5. Repeating pattern detection — tiled watermarks create periodic variance spikes
 * 
 * All heuristics use sharp pixel math only. $0 cost.
 * Threshold: score >= 55 means "likely watermarked"
 */
export async function detectWatermark(buffer: Buffer): Promise<{
  score: number; // 0-100 watermark confidence
  reason: string;
}> {
  const sharp = await getSharp();
  if (!sharp) {
    return { score: 0, reason: 'sharp not available' };
  }

  try {
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width || 0;
    const height = metadata.height || 0;

    if (width < 100 || height < 100) {
      return { score: 0, reason: 'image too small for watermark detection' };
    }

    let wmScore = 0;
    const reasons: string[] = [];

    // Downscale to 500px wide for faster processing (watermarks are still visible at this scale)
    const analysisScale = Math.min(1, 500 / width);
    const aW = Math.round(width * analysisScale);
    const aH = Math.round(height * analysisScale);

    // Get greyscale version for edge analysis
    const greyBuf = await sharp(buffer)
      .resize(aW, aH, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer();

    // Get color version for contrast analysis
    const colorBuf = await sharp(buffer)
      .resize(aW, aH, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer();

    // === HEURISTIC 1: Full-image grid scan (3x3) ===
    // Divide image into 9 cells. For each cell, measure "local contrast anomaly":
    // watermark text creates thin high-contrast edges in otherwise smooth areas.
    // Compare each cell's edge density to its neighbors.
    const gridCols = 3;
    const gridRows = 3;
    const cellW = Math.floor(aW / gridCols);
    const cellH = Math.floor(aH / gridRows);
    const cellEdgeDensities: number[] = [];
    const cellVariances: number[] = [];

    for (let row = 0; row < gridRows; row++) {
      for (let col = 0; col < gridCols; col++) {
        const startX = col * cellW;
        const startY = row * cellH;
        
        // Extract cell from greyscale buffer (row-major, 1 channel)
        const cellPixels: number[] = [];
        for (let y = startY; y < startY + cellH && y < aH; y++) {
          for (let x = startX; x < startX + cellW && x < aW; x++) {
            cellPixels.push(greyBuf[y * aW + x]);
          }
        }

        // Calculate variance (texture/detail level)
        const cellVar = calcVarianceArr(cellPixels);
        cellVariances.push(cellVar);

        // Calculate edge density using simple gradient magnitude
        // High edge density in a cell = text-like content
        let edgeSum = 0;
        let edgeCount = 0;
        for (let y = startY + 1; y < startY + cellH - 1 && y < aH - 1; y++) {
          for (let x = startX + 1; x < startX + cellW - 1 && x < aW - 1; x++) {
            const idx = y * aW + x;
            // Sobel-like gradient
            const gx = Math.abs(greyBuf[idx + 1] - greyBuf[idx - 1]);
            const gy = Math.abs(greyBuf[idx + aW] - greyBuf[idx - aW]);
            const grad = gx + gy;
            // Count "edge" pixels (gradient > threshold)
            if (grad > 30) edgeSum++;
            edgeCount++;
          }
        }
        const edgeDensity = edgeCount > 0 ? edgeSum / edgeCount : 0;
        cellEdgeDensities.push(edgeDensity);
      }
    }

    // Detect cells with anomalously high edge density compared to their neighbors
    // Watermark text creates thin edges that spike edge density in specific cells
    const avgEdgeDensity = cellEdgeDensities.reduce((a, b) => a + b, 0) / cellEdgeDensities.length;
    const avgVariance = cellVariances.reduce((a, b) => a + b, 0) / cellVariances.length;
    
    let anomalousCells = 0;
    for (let i = 0; i < cellEdgeDensities.length; i++) {
      // A cell is anomalous if it has high edge density but low-to-medium variance
      // (text = sharp thin edges, not broad texture)
      if (cellEdgeDensities[i] > avgEdgeDensity * 1.6 && cellVariances[i] < avgVariance * 1.3) {
        anomalousCells++;
      }
    }

    if (anomalousCells >= 3) {
      wmScore += 30;
      reasons.push(`${anomalousCells}/9 grid cells with text-like edge patterns`);
    } else if (anomalousCells >= 2) {
      wmScore += 15;
      reasons.push(`${anomalousCells}/9 grid cells with text-like edge patterns`);
    }

    // === HEURISTIC 2: Center zone focus ===
    // Many watermarks are placed dead center. Extract the center 40% of the image
    // and check for semi-transparent overlay signatures.
    const centerX = Math.floor(aW * 0.3);
    const centerY = Math.floor(aH * 0.3);
    const centerW = Math.floor(aW * 0.4);
    const centerH = Math.floor(aH * 0.4);

    // Extract center zone pixels (RGB, 3 channels)
    const centerPixelsR: number[] = [];
    const centerPixelsG: number[] = [];
    const centerPixelsB: number[] = [];
    for (let y = centerY; y < centerY + centerH && y < aH; y++) {
      for (let x = centerX; x < centerX + centerW && x < aW; x++) {
        const idx = (y * aW + x) * 3;
        centerPixelsR.push(colorBuf[idx]);
        centerPixelsG.push(colorBuf[idx + 1]);
        centerPixelsB.push(colorBuf[idx + 2]);
      }
    }

    // Semi-transparent white/grey watermarks pull RGB values toward a uniform level.
    // Detect this by checking if the center has unusually low color saturation
    // compared to the surrounding area.
    const outerPixelsR: number[] = [];
    const outerPixelsG: number[] = [];
    const outerPixelsB: number[] = [];
    // Sample from top-left and bottom-right quadrants (outside center)
    for (let y = 0; y < Math.floor(aH * 0.25); y++) {
      for (let x = 0; x < Math.floor(aW * 0.25); x++) {
        const idx = (y * aW + x) * 3;
        outerPixelsR.push(colorBuf[idx]);
        outerPixelsG.push(colorBuf[idx + 1]);
        outerPixelsB.push(colorBuf[idx + 2]);
      }
    }

    const centerSaturation = calcColorSaturation(centerPixelsR, centerPixelsG, centerPixelsB);
    const outerSaturation = calcColorSaturation(outerPixelsR, outerPixelsG, outerPixelsB);

    // If center has notably less color saturation than outer areas, it may have
    // a semi-transparent white overlay (watermark)
    if (outerSaturation > 0 && centerSaturation < outerSaturation * 0.65 && outerSaturation > 15) {
      wmScore += 25;
      reasons.push(`center desaturated vs outer (${centerSaturation.toFixed(1)} vs ${outerSaturation.toFixed(1)})`);
    }

    // Also check center edge density specifically
    const centerEdgeIdx = 4; // center cell in 3x3 grid (row 1, col 1)
    if (cellEdgeDensities[centerEdgeIdx] > avgEdgeDensity * 1.5) {
      wmScore += 10;
      reasons.push(`center cell edge density ${(cellEdgeDensities[centerEdgeIdx] / avgEdgeDensity).toFixed(1)}x average`);
    }

    // === HEURISTIC 3: Horizontal band detection (full image) ===
    // Watermark text creates horizontal bands of high edge activity.
    // Scan row-by-row edge density and look for isolated spikes.
    const rowEdgeCounts: number[] = [];
    for (let y = 1; y < aH - 1; y++) {
      let rowEdges = 0;
      for (let x = 1; x < aW - 1; x += 2) { // Sample every 2nd pixel for speed
        const idx = y * aW + x;
        const gx = Math.abs(greyBuf[idx + 1] - greyBuf[idx - 1]);
        const gy = Math.abs(greyBuf[idx + aW] - greyBuf[idx - aW]);
        if (gx + gy > 40) rowEdges++;
      }
      rowEdgeCounts.push(rowEdges);
    }

    // Find isolated bands: rows with high edge count surrounded by low edge count
    const avgRowEdges = rowEdgeCounts.reduce((a, b) => a + b, 0) / rowEdgeCounts.length;
    let bandCount = 0;
    const windowSize = 5; // Look at 5-row windows
    for (let i = windowSize; i < rowEdgeCounts.length - windowSize; i++) {
      const localAvg = rowEdgeCounts[i];
      const surroundAvg = (
        rowEdgeCounts.slice(i - windowSize, i).reduce((a, b) => a + b, 0) +
        rowEdgeCounts.slice(i + 1, i + 1 + windowSize).reduce((a, b) => a + b, 0)
      ) / (windowSize * 2);

      // Spike: this row has 2x+ more edges than surrounding rows
      if (localAvg > surroundAvg * 2 && localAvg > avgRowEdges * 1.5) {
        bandCount++;
      }
    }

    // Watermark text typically creates 5-30 horizontal edge bands (one per text line height)
    if (bandCount > 15) {
      wmScore += 25;
      reasons.push(`${bandCount} horizontal edge bands (text-like)`);
    } else if (bandCount > 8) {
      wmScore += 15;
      reasons.push(`${bandCount} horizontal edge bands`);
    }

    // === HEURISTIC 4: Repeating pattern detection ===
    // Tiled watermarks repeat across the image. Check if the variance pattern
    // in the grid cells shows periodicity.
    // Simple check: if multiple non-adjacent cells have very similar edge densities
    // that are all elevated, it suggests a repeating overlay.
    const elevatedCells = cellEdgeDensities
      .map((d, i) => ({ density: d, idx: i }))
      .filter(c => c.density > avgEdgeDensity * 1.3);

    if (elevatedCells.length >= 4) {
      // Check if they're spread across the image (not just one region)
      const rows = new Set(elevatedCells.map(c => Math.floor(c.idx / gridCols)));
      const cols = new Set(elevatedCells.map(c => c.idx % gridCols));
      if (rows.size >= 2 && cols.size >= 2) {
        wmScore += 20;
        reasons.push(`repeating pattern: ${elevatedCells.length} elevated cells across ${rows.size} rows, ${cols.size} cols`);
      }
    }

    // === HEURISTIC 5: Low-opacity overlay detection ===
    // Semi-transparent watermarks reduce the dynamic range of the underlying image.
    // Compare the contrast (stddev) of the center vs the full image.
    const centerGreyPixels: number[] = [];
    for (let y = centerY; y < centerY + centerH && y < aH; y++) {
      for (let x = centerX; x < centerX + centerW && x < aW; x++) {
        centerGreyPixels.push(greyBuf[y * aW + x]);
      }
    }
    const fullGreyPixels: number[] = [];
    for (let i = 0; i < greyBuf.length; i += 3) { // Sample every 3rd for speed
      fullGreyPixels.push(greyBuf[i]);
    }

    const centerContrast = Math.sqrt(calcVarianceArr(centerGreyPixels));
    const fullContrast = Math.sqrt(calcVarianceArr(fullGreyPixels));

    // If center has notably less contrast, a semi-transparent overlay may be present
    if (fullContrast > 20 && centerContrast < fullContrast * 0.6) {
      wmScore += 20;
      reasons.push(`center contrast reduced (${centerContrast.toFixed(1)} vs ${fullContrast.toFixed(1)} full)`);
    }

    const finalScore = Math.min(100, wmScore);
    const reason = reasons.length > 0 ? reasons.join('; ') : 'clean';
    
    if (finalScore >= 30) {
      console.log(`[Watermark] Score ${finalScore}: ${reason}`);
    }

    return { score: finalScore, reason };
  } catch (err) {
    console.error(`[Watermark] Detection error: ${err}`);
    return { score: 0, reason: `error: ${err}` };
  }
}

/**
 * Calculate variance from an array of pixel values
 */
function calcVarianceArr(pixels: number[]): number {
  if (pixels.length === 0) return 0;
  const n = pixels.length;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    sum += pixels[i];
    sumSq += pixels[i] * pixels[i];
  }
  const mean = sum / n;
  return (sumSq / n) - (mean * mean);
}

/**
 * Calculate average color saturation (how colorful vs grey).
 * Low saturation in a region that should be colorful = possible white overlay.
 */
function calcColorSaturation(r: number[], g: number[], b: number[]): number {
  if (r.length === 0) return 0;
  
  let totalSat = 0;
  const step = Math.max(1, Math.floor(r.length / 500)); // Sample up to 500 pixels
  let count = 0;

  for (let i = 0; i < r.length; i += step) {
    const max = Math.max(r[i], g[i], b[i]);
    const min = Math.min(r[i], g[i], b[i]);
    // Saturation = range / max (0 = grey, higher = more colorful)
    if (max > 10) { // Skip near-black pixels
      totalSat += (max - min) / max * 100;
    }
    count++;
  }

  return count > 0 ? totalSat / count : 0;
}
