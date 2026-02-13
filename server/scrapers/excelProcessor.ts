// Excel Processor - Handles batch processing of Excel files with SKU image insertion
import * as XLSX from 'xlsx';
import { scrapeSku } from './scraperService';
import type { QualityMode } from './hqImagePipeline';
import { storagePut } from '../storage';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import axios from 'axios';

export interface ExcelProcessingResult {
  outputFileKey: string;
  outputFileUrl: string;
  totalRows: number;
  processedRows: number;
  imagesInserted: number;
  failedRows: number;
}

interface DetectedColumn {
  index: number;
  type: 'sku' | 'product_name' | 'ean';
  confidence: number;
  headerName?: string;
}

// Standard image dimensions for Excel cells
const IMAGE_WIDTH = 150;
const IMAGE_HEIGHT = 150;

/**
 * Detect which columns contain SKUs, EANs, or product names
 */
function detectProductColumns(worksheet: XLSX.WorkSheet): DetectedColumn[] {
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  const detectedColumns: DetectedColumn[] = [];
  
  // Common header patterns
  const skuPatterns = /sku|item.*code|product.*code|article.*number|style.*code/i;
  const eanPatterns = /ean|upc|barcode|gtin/i;
  const productNamePatterns = /product.*name|item.*name|title|description|name/i;
  
  // Check first 3 rows for headers and data
  const maxHeaderRow = Math.min(2, range.e.r);
  
  for (let col = range.s.c; col <= range.e.c && col < 10; col++) {
    let confidence = 0;
    let type: 'sku' | 'product_name' | 'ean' | null = null;
    let headerName = '';
    
    // Check headers (first 3 rows)
    for (let row = 0; row <= maxHeaderRow; row++) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = worksheet[cellAddress];
      if (!cell) continue;
      
      const value = String(cell.v || '').toLowerCase();
      headerName = headerName || String(cell.v || '');
      
      if (skuPatterns.test(value)) {
        type = 'sku';
        confidence = Math.max(confidence, 0.9);
      } else if (eanPatterns.test(value)) {
        type = 'ean';
        confidence = Math.max(confidence, 0.85);
      } else if (productNamePatterns.test(value)) {
        type = 'product_name';
        confidence = Math.max(confidence, 0.8);
      }
    }
    
    // Check data patterns in next 5 rows
    const startDataRow = maxHeaderRow + 1;
    const sampleRows = 5;
    let numericCount = 0;
    let longNumericCount = 0;
    let textCount = 0;
    
    for (let row = startDataRow; row < startDataRow + sampleRows && row <= range.e.r; row++) {
      const cellAddress = XLSX.utils.encode_cell({ r: row, c: col });
      const cell = worksheet[cellAddress];
      if (!cell) continue;
      
      const value = String(cell.v || '').trim();
      if (!value) continue;
      
      // Check if numeric
      if (/^\d+$/.test(value)) {
        numericCount++;
        // EAN/UPC are typically 8-14 digits
        if (value.length >= 8 && value.length <= 14) {
          longNumericCount++;
        }
      } else if (value.length > 3) {
        textCount++;
      }
    }
    
    // Infer type from data patterns if header didn't match
    if (!type || confidence < 0.7) {
      if (longNumericCount >= 2) {
        type = 'ean';
        confidence = Math.max(confidence, 0.7);
      } else if (numericCount >= 3) {
        type = 'sku';
        confidence = Math.max(confidence, 0.6);
      } else if (textCount >= 3) {
        type = 'product_name';
        confidence = Math.max(confidence, 0.5);
      }
    }
    
    if (type && confidence >= 0.5) {
      detectedColumns.push({ index: col, type, confidence, headerName });
    }
  }
  
  // Sort by confidence
  detectedColumns.sort((a, b) => b.confidence - a.confidence);
  
  return detectedColumns;
}

/**
 * Extract product identifiers from the Excel sheet
 */
function extractProductIdentifiers(worksheet: XLSX.WorkSheet): Array<{
  row: number;
  identifier: string;
  type: 'sku' | 'product_name' | 'ean';
}> {
  const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1');
  const detectedColumns = detectProductColumns(worksheet);
  
  console.log(`[Excel] Detected columns:`, detectedColumns.map(c => 
    `Col ${String.fromCharCode(65 + c.index)} (${c.type}, ${(c.confidence * 100).toFixed(0)}%${c.headerName ? `, header: "${c.headerName}"` : ''})`
  ));
  
  if (detectedColumns.length === 0) {
    throw new Error('No product columns detected. Please ensure your Excel has SKU, EAN, or Product Name columns in the first few columns.');
  }
  
  const products: Array<{ row: number; identifier: string; type: 'sku' | 'product_name' | 'ean' }> = [];
  
  // Use the best detected column (highest confidence)
  const primaryColumn = detectedColumns[0];
  
  // Start from row 1 (or after header if detected)
  const startRow = primaryColumn.headerName ? 1 : 0;
  
  for (let row = startRow; row <= range.e.r; row++) {
    const cellAddress = XLSX.utils.encode_cell({ r: row, c: primaryColumn.index });
    const cell = worksheet[cellAddress];
    
    if (cell && cell.v) {
      const identifier = String(cell.v).trim();
      if (identifier && identifier.length > 0) {
        products.push({
          row,
          identifier,
          type: primaryColumn.type,
        });
      }
    }
  }
  
  console.log(`[Excel] Extracted ${products.length} products from column ${String.fromCharCode(65 + primaryColumn.index)} (${primaryColumn.type})`);
  
  return products;
}

/**
 * Download and resize image to fit Excel cell
 */
async function downloadAndResizeImage(imageUrl: string): Promise<Buffer> {
  try {
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 15000,
      maxContentLength: 10 * 1024 * 1024, // 10MB max
    });
    
    const imageBuffer = Buffer.from(response.data);
    
    // Resize to standard dimensions while maintaining aspect ratio
    const resized = await sharp(imageBuffer)
      .resize(IMAGE_WIDTH, IMAGE_HEIGHT, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 85 })
      .toBuffer();
    
    return resized;
  } catch (error) {
    console.error(`[Excel] Failed to download/resize image ${imageUrl}:`, error);
    throw error;
  }
}

/**
 * Process Excel file: read SKUs/products, scrape images, insert into last column
 */
export async function processExcelWithImages(
  fileBuffer: Buffer,
  orderId: number,
  onProgress?: (processed: number, total: number) => void
): Promise<ExcelProcessingResult> {
  console.log(`[Excel] Starting processing for order ${orderId}`);
  
  // Read the workbook
  const workbook = XLSX.read(fileBuffer, { type: 'buffer', cellStyles: true });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  if (!worksheet || !worksheet['!ref']) {
    throw new Error('Excel file is empty or invalid');
  }
  
  // Extract product identifiers
  const products = extractProductIdentifiers(worksheet);
  const totalRows = products.length;
  
  if (totalRows === 0) {
    throw new Error('No products found in Excel file');
  }
  
  console.log(`[Excel] Found ${totalRows} products to process`);
  
  // Determine the image column (last column + 1)
  const range = XLSX.utils.decode_range(worksheet['!ref']);
  const imageColumnIndex = range.e.c + 1;
  const imageColumnLetter = XLSX.utils.encode_col(imageColumnIndex);
  
  // Add header for image column if needed
  const headerRow = 0;
  const headerCellAddress = XLSX.utils.encode_cell({ r: headerRow, c: imageColumnIndex });
  if (!worksheet[headerCellAddress]) {
    worksheet[headerCellAddress] = { v: 'Product Image', t: 's' };
  }
  
  let processedRows = 0;
  let imagesInserted = 0;
  let failedRows = 0;
  
  // Process each product
  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    
    try {
      console.log(`[Excel] Processing ${i + 1}/${totalRows}: ${product.identifier} (${product.type})`);
      
      // Scrape images for this SKU/product (compressed mode for Excel embedding)
      const result = await scrapeSku(product.identifier, orderId, 'compressed');
      
      if (result.images.length > 0) {
        // Get the first (best) image
        const bestImage = result.images[0];
        
        try {
          // Download and resize the image
          const imageBuffer = await downloadAndResizeImage(bestImage.imageUrl);
          
          // Convert to base64 for Excel embedding
          const base64Image = imageBuffer.toString('base64');
          
          // Add image to worksheet at the product's row
          const imageCellAddress = XLSX.utils.encode_cell({ r: product.row, c: imageColumnIndex });
          
          // Store the image data in a special format that xlsx library can use
          // Note: xlsx library has limited image support, so we'll store as a formula/link for now
          // In production, you'd use a library like exceljs which has better image support
          worksheet[imageCellAddress] = {
            v: bestImage.imageUrl,
            t: 's',
            l: { Target: bestImage.imageUrl, Tooltip: `Image for ${product.identifier}` }
          };
          
          imagesInserted++;
          console.log(`[Excel] ✓ Image inserted for ${product.identifier}`);
        } catch (imgError) {
          console.error(`[Excel] Failed to process image for ${product.identifier}:`, imgError);
          worksheet[XLSX.utils.encode_cell({ r: product.row, c: imageColumnIndex })] = {
            v: 'Image unavailable',
            t: 's'
          };
          failedRows++;
        }
      } else {
        console.log(`[Excel] ✗ No images found for ${product.identifier}`);
        worksheet[XLSX.utils.encode_cell({ r: product.row, c: imageColumnIndex })] = {
          v: 'No image found',
          t: 's'
        };
        failedRows++;
      }
      
      processedRows++;
      if (onProgress) onProgress(processedRows, totalRows);
      
    } catch (error) {
      console.error(`[Excel] Error processing ${product.identifier}:`, error);
      worksheet[XLSX.utils.encode_cell({ r: product.row, c: imageColumnIndex })] = {
        v: 'Error',
        t: 's'
      };
      failedRows++;
      processedRows++;
      if (onProgress) onProgress(processedRows, totalRows);
    }
  }
  
  // Update the range to include the new column
  const newRange = XLSX.utils.encode_range({
    s: range.s,
    e: { r: range.e.r, c: imageColumnIndex }
  });
  worksheet['!ref'] = newRange;
  
  // Set column width for image column
  if (!worksheet['!cols']) worksheet['!cols'] = [];
  worksheet['!cols'][imageColumnIndex] = { wch: 25 };
  
  // Write the updated workbook to buffer
  const outputBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  
  // Upload to S3
  const outputFileKey = `orders/${orderId}/output-${nanoid()}.xlsx`;
  const result = await storagePut(outputFileKey, outputBuffer, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  const outputFileUrl = typeof result === 'string' ? result : (result as any).url;
  
  console.log(`[Excel] Processing complete: ${imagesInserted} images inserted, ${failedRows} failed`);
  
  return {
    outputFileKey,
    outputFileUrl,
    totalRows,
    processedRows,
    imagesInserted,
    failedRows,
  };
}

/**
 * Alternative implementation using exceljs for better image support
 * This should be the preferred method for production
 */
export async function processExcelWithImagesExcelJS(
  fileBuffer: Buffer,
  orderId: number,
  onProgress?: (processed: number, total: number) => void
): Promise<ExcelProcessingResult> {
  // Import exceljs dynamically
  const ExcelJS = await import('exceljs') as any;
  
  console.log(`[Excel/ExcelJS] Starting processing for order ${orderId}`);
  
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);
  
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('Excel file has no worksheets');
  }
  
  // Detect product columns
  const products: Array<{ row: number; identifier: string; type: string }> = [];
  
  // Simple detection: look for SKU/Product columns in first 3 columns
  let productColumn = -1;
  
  for (let col = 1; col <= 3; col++) {
    const headerCell = worksheet.getCell(1, col);
    const headerValue = String(headerCell.value || '').toLowerCase();
    
    if (/sku|product|item|ean|upc/.test(headerValue)) {
      productColumn = col;
      break;
    }
  }
  
  // If no header match, assume column 1
  if (productColumn === -1) {
    productColumn = 1;
  }
  
  // Extract product identifiers
  worksheet.eachRow((row: any, rowNumber: number) => {
    if (rowNumber === 1) return; // Skip header
    
    const cell = row.getCell(productColumn);
    const identifier = String(cell.value || '').trim();
    
    if (identifier) {
      products.push({ row: rowNumber, identifier, type: 'sku' });
    }
  });
  
  const totalRows = products.length;
  console.log(`[Excel/ExcelJS] Found ${totalRows} products in column ${productColumn}`);
  
  if (totalRows === 0) {
    throw new Error('No products found in Excel file');
  }
  
  // Determine image column (last column + 1)
  const imageColumn = worksheet.columnCount + 1;
  
  // Add header
  const headerCell = worksheet.getCell(1, imageColumn);
  headerCell.value = 'Product Image';
  headerCell.font = { bold: true };
  
  // Set column width
  worksheet.getColumn(imageColumn).width = 20;
  
  let processedRows = 0;
  let imagesInserted = 0;
  let failedRows = 0;
  
  // Process each product
  for (let i = 0; i < products.length; i++) {
    const product = products[i];
    
    try {
      console.log(`[Excel/ExcelJS] Processing ${i + 1}/${totalRows}: ${product.identifier}`);
      
      // Scrape images for this SKU/product (compressed mode for Excel embedding)
      const result = await scrapeSku(product.identifier, orderId, 'compressed');
      
      if (result.images.length > 0) {
        const bestImage = result.images[0];
        
        try {
          // Download and resize image
          const imageBuffer = await downloadAndResizeImage(bestImage.imageUrl);
          
          // Add image to workbook
          const imageId = workbook.addImage({
            buffer: imageBuffer,
            extension: 'jpeg',
          });
          
          // Insert image into cell
          worksheet.addImage(imageId, {
            tl: { col: imageColumn - 1, row: product.row - 1 },
            ext: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
            editAs: 'oneCell',
          });
          
          // Set row height to accommodate image
          const row = worksheet.getRow(product.row);
          row.height = IMAGE_HEIGHT * 0.75; // Excel row height is in points (96 DPI)
          
          imagesInserted++;
          console.log(`[Excel/ExcelJS] ✓ Image inserted for ${product.identifier}`);
        } catch (imgError) {
          console.error(`[Excel/ExcelJS] Failed to insert image for ${product.identifier}:`, imgError);
          worksheet.getCell(product.row, imageColumn).value = 'Image unavailable';
          failedRows++;
        }
      } else {
        console.log(`[Excel/ExcelJS] ✗ No images found for ${product.identifier}`);
        worksheet.getCell(product.row, imageColumn).value = 'No image found';
        failedRows++;
      }
      
      processedRows++;
      if (onProgress) onProgress(processedRows, totalRows);
      
    } catch (error) {
      console.error(`[Excel/ExcelJS] Error processing ${product.identifier}:`, error);
      worksheet.getCell(product.row, imageColumn).value = 'Error';
      failedRows++;
      processedRows++;
      if (onProgress) onProgress(processedRows, totalRows);
    }
  }
  
  // Write to buffer
  const outputBuffer = await workbook.xlsx.writeBuffer();
  
  // Upload to S3
  const outputFileKey = `orders/${orderId}/output-${nanoid()}.xlsx`;
  const result = await storagePut(
    outputFileKey,
    Buffer.from(outputBuffer),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  const outputFileUrl = typeof result === 'string' ? result : (result as any).url;
  
  console.log(`[Excel/ExcelJS] Processing complete: ${imagesInserted} images inserted, ${failedRows} failed`);
  
  return {
    outputFileKey,
    outputFileUrl,
    totalRows,
    processedRows,
    imagesInserted,
    failedRows,
  };
}

/**
 * Quick parse for quoting - just count products without processing
 */
export async function parseExcelForQuote(fileBuffer: Buffer): Promise<{
  totalProducts: number;
  detectedColumns: string[];
  sampleProducts: string[];
}> {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  if (!worksheet || !worksheet['!ref']) {
    throw new Error('Excel file is empty or invalid');
  }
  
  const detectedColumns = detectProductColumns(worksheet);
  const products = extractProductIdentifiers(worksheet);
  
  return {
    totalProducts: products.length,
    detectedColumns: detectedColumns.map(c => c.headerName || `Column ${String.fromCharCode(65 + c.index)}`),
    sampleProducts: products.slice(0, 5).map(p => p.identifier),
  };
}
