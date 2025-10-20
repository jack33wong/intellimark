/**
 * PdfProcessingService
 * Converts uploaded PDF buffers into page images (base64 data URLs) for downstream processing.
 */

import { fromBuffer, type PDF2PicOptions } from "pdf2pic";
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

// Define the output format for standardized pages
interface StandardizedPage {
  pageIndex: number; // 0-based index
  imageData: string; // base64 data URL (e.g., "data:image/png;base64,...")
  originalFileName?: string;
  // Add width/height if determined here, although often done after preprocessing
  width?: number;
  height?: number;
}

// Define expected result structure from pdf2pic bulk conversion
interface ConversionResult {
  page: number;
  name: string;
  path: string; // We expect the file path
  size?: string; // Optional properties
  height?: number;
  width?: number;
}

export class PdfProcessingService {

  /**
   * Converts a PDF buffer into an array of image data URLs (base64 encoded).
   * @param pdfBuffer The buffer containing the PDF data.
   * @param options Optional configuration for conversion.
   * @returns A promise that resolves to an array of StandardizedPage objects.
   */
  static async convertPdfToImages(
    pdfBuffer: Buffer,
    options: Partial<PDF2PicOptions> = {}
  ): Promise<StandardizedPage[]> {
    console.log('🔧 [PDF Processing] Starting PDF to image conversion (High Density, Calculated Dimensions)...');
    const startTime = Date.now();

    // Create a unique temporary directory for this conversion
    let tempDirPath: string | undefined;
    try {
      tempDirPath = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf2pic-'));
    } catch (dirError) {
      console.error('❌ [PDF Processing] Failed to create temporary directory:', dirError);
      throw new Error('Failed to create temporary directory for PDF conversion.');
    }

    // Configuration for pdf2pic
    // Calculate target width/height from PDF points at 600 DPI
    const TARGET_DENSITY = 600;
    let targetWidth: number | undefined;
    let targetHeight: number | undefined;
    try {
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      const firstPage = pdfDoc.getPage(0);
      const { width: pdfPtW, height: pdfPtH } = firstPage.getSize();
      targetWidth = Math.round((pdfPtW / 72) * TARGET_DENSITY);
      targetHeight = Math.round((pdfPtH / 72) * TARGET_DENSITY);
      console.log(`  -> PDF Page 0 Dimensions: ${pdfPtW.toFixed(2)}pt x ${pdfPtH.toFixed(2)}pt`);
      console.log(`  -> Calculated Target Image Dimensions at ${TARGET_DENSITY} DPI: ${targetWidth}x${targetHeight}`);
    } catch (pdfErr) {
      console.error('❌ [PDF Processing] Failed to read PDF dimensions with pdf-lib:', pdfErr);
    }

    const defaultOptions: PDF2PicOptions = {
      density: TARGET_DENSITY,
      format: "png",
      quality: 100,
      savePath: tempDirPath,
      saveFilename: `page_${uuidv4()}`,
      width: targetWidth,
      height: targetHeight
    };

    const conversionOptions: PDF2PicOptions = { ...defaultOptions, ...options } as PDF2PicOptions;
    const convert = fromBuffer(pdfBuffer, conversionOptions as any);

    try {
      // Convert all pages; returns array of file outputs with paths
      const conversionResults = await convert.bulk(-1) as unknown as ConversionResult[];

      if (!conversionResults || !Array.isArray(conversionResults) || conversionResults.length === 0) {
        console.warn('⚠️ [PDF Processing] Conversion returned no pages or an invalid result.');
        if (Array.isArray(conversionResults) && conversionResults.length === 0) return [];
        throw new Error('PDF conversion returned an invalid result or no pages.');
      }

      console.log(`  -> Conversion successful. Reading ${conversionResults.length} generated image files (Target: ${targetWidth}x${targetHeight} @ ${TARGET_DENSITY} DPI).`);

      // Ensure ordered by page number
      conversionResults.sort((a, b) => (a.page || 0) - (b.page || 0));

      const standardizedPages: StandardizedPage[] = [];

      for (let i = 0; i < conversionResults.length; i++) {
        const result = conversionResults[i];
        if (!result || !result.path) {
          console.warn(`⚠️ [PDF Processing] Conversion result for page ${i + 1} is missing the file path.`);
          continue;
        }

        try {
          const imagePath = result.path;
          const imageFileBuffer = await fs.readFile(imagePath);
          // Get reliable dimensions via sharp
          const meta = await sharp(imageFileBuffer).metadata();
          const width = meta.width;
          const height = meta.height;
          if (!width || !height) {
            console.warn(`⚠️ [PDF Processing] Sharp failed to get valid dimensions for page ${i + 1}. Skipping page.`);
            continue;
          }
          console.log(`  -> Page ${i} ACTUAL processed dimensions: ${width}x${height}`);
          const base64Image = imageFileBuffer.toString('base64');
          standardizedPages.push({
            pageIndex: i,
            imageData: `data:image/${conversionOptions.format};base64,${base64Image}`,
            width,
            height
          });
        } catch (readFileError) {
          console.error(`❌ [PDF Processing] Failed to read, get metadata, or process image file for page ${i + 1}:`, readFileError);
        }
      }

      const duration = (Date.now() - startTime) / 1000;
      console.log(`✅ [PDF Processing] PDF converted to ${standardizedPages.length} images in ${duration}s.`);
      return standardizedPages;

    } catch (error) {
      console.error('❌ [PDF Processing] PDF conversion failed:', error);
      throw new Error(`PDF processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      try {
        if (tempDirPath) {
          await fs.rm(tempDirPath, { recursive: true, force: true });
          console.log(`  -> Cleaned up temporary directory: ${tempDirPath}`);
        }
      } catch (cleanupError) {
        console.error(`⚠️ [PDF Processing] Failed to clean up temporary directory ${tempDirPath}:`, cleanupError);
      }
    }
  }
}

export default PdfProcessingService;


