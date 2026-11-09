/**
 * PdfProcessingService
 * Converts uploaded PDF buffers into high-clarity page images (base64 data URLs)
 * using 3-page chunked sub-PDF isolation to keep Cloud Run /tmp (tmpfs) and libvips RAM flat (< 500 MB).
 */

import { fromPath } from "pdf2pic";
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

// Disable libvips internal operation cache in Cloud Run so native C++ memory is freed immediately after each page
sharp.cache(false);
sharp.concurrency(4);

interface StandardizedPage {
  pageIndex: number; // 0-based index
  imageData: string; // base64 data URL ("data:image/jpeg;base64,...")
  originalFileName?: string;
  width?: number;
  height?: number;
}

interface ConversionResult {
  page: number;
  name: string;
  path: string;
  size?: string;
  height?: number;
  width?: number;
}

export class PdfProcessingService {

  /**
   * Converts a PDF buffer into an array of standardized JPEG base64 data URLs.
   * Uses 3-page sub-PDF chunking so Ghostscript never parses a massive PDF 15 times
   * and /tmp (Cloud Run RAM disk) never holds more than 3 uncompressed pages at once.
   */
  static async convertPdfToImages(
    pdfBuffer: Buffer,
    options: any = {}
  ): Promise<StandardizedPage[]> {
    const startTime = Date.now();
    const { maxPages, maxPagesErrorMessage, ...pdf2picCustomOptions } = options;

    let tempDirPath: string | undefined;
    try {
      tempDirPath = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf2pic-'));
    } catch (dirError) {
      console.error('❌ [PDF Processing] Failed to create temporary directory:', dirError);
      throw new Error('Failed to create temporary directory for PDF conversion.');
    }

    // 1. Strip leading junk/whitespace/BOM before %PDF- header if present
    let cleanPdfBytes: Uint8Array | Buffer = pdfBuffer;
    const headerOffset = pdfBuffer.indexOf('%PDF-');
    if (headerOffset > 0 && headerOffset < 4096) {
      console.log(`🧼 [PDF-REPAIR] Stripped ${headerOffset} leading bytes before %PDF- header.`);
      cleanPdfBytes = pdfBuffer.subarray(headerOffset);
    }

    let srcPdfDoc: PDFDocument | null = null;
    let pageCount = 1;
    let pdfPtW = 595.28; // Standard A4 width in PDF points
    let pdfPtH = 841.89; // Standard A4 height in PDF points

    try {
      console.log("🧼 [PDF-REPAIR] Loading document into pdf-lib to check page count & clean structural metadata...");
      srcPdfDoc = await PDFDocument.load(cleanPdfBytes, { ignoreEncryption: true });
      pageCount = srcPdfDoc.getPageCount();

      // ⚡ INSTANT PAGE GATING (0.05s instead of rasterizing)
      if (maxPages && pageCount > maxPages) {
        const customMsg = typeof maxPagesErrorMessage === 'function'
          ? maxPagesErrorMessage(pageCount)
          : maxPagesErrorMessage;
        const msg = customMsg || `PDF_PAGE_LIMIT_EXCEEDED: Upload exceeds the maximum limit of ${maxPages} pages (found ${pageCount} pages).`;
        const finalMsg = msg.startsWith('PDF_PAGE_LIMIT_EXCEEDED:') ? msg : `PDF_PAGE_LIMIT_EXCEEDED: ${msg}`;
        throw new Error(finalMsg);
      }

      if (pageCount > 0) {
        const firstPage = srcPdfDoc.getPages()[0];
        const size = firstPage.getSize();
        if (size.width > 0 && size.height > 0) {
          pdfPtW = size.width;
          pdfPtH = size.height;
        }
      }

      console.log(`✨ [PDF-REPAIR] Validated ${pageCount} pages. Ready for chunked rasterization.`);
    } catch (repairError: any) {
      if (repairError?.message?.includes('PDF_PAGE_LIMIT_EXCEEDED')) {
        try {
          if (tempDirPath) await fs.rm(tempDirPath, { recursive: true, force: true });
        } catch (_) {}
        throw new Error(repairError.message.replace('PDF_PAGE_LIMIT_EXCEEDED: ', ''));
      }
      console.warn("⚠️ [PDF-REPAIR] pdf-lib load failed. Falling back to direct whole-file chunking.", repairError);
      srcPdfDoc = null;
    }

    // 2. HIGH-CLARITY ADAPTIVE DPI (Preserves crisp superscripts/fractions while staying well under 4 GiB RAM):
    // - 1 to 6 pages: 260 DPI (~2158 x 3052 px)
    // - 7+ pages:     220 DPI (~1826 x 2582 px — ideal for Google Vision & Gemini OCR)
    const TARGET_DENSITY = pageCount <= 6 ? 260 : 220;
    const targetWidth = Math.round((pdfPtW / 72) * TARGET_DENSITY);
    const targetHeight = Math.round((pdfPtH / 72) * TARGET_DENSITY);

    const CHUNK_SIZE = 6; // Process 6 pages per sub-PDF chunk (halves Ghostscript + pdf-lib overhead while keeping RAM bounded)
    const standardizedPages: StandardizedPage[] = [];

    try {
      if (srcPdfDoc && pageCount > 0) {
        // 3A. CHUNKED SUB-PDF RASTERIZATION (Fastest & lowest memory footprint on Cloud Run)
        for (let chunkStart = 0; chunkStart < pageCount; chunkStart += CHUNK_SIZE) {
          const chunkEnd = Math.min(chunkStart + CHUNK_SIZE, pageCount);
          const pageIndices: number[] = [];
          for (let p = chunkStart; p < chunkEnd; p++) {
            pageIndices.push(p);
          }

          const chunkPdfPath = path.join(tempDirPath, `chunk_${chunkStart}_${uuidv4()}.pdf`);
          try {
            // Create a lightweight 3-page PDF in memory and write to /tmp
            const chunkDoc = await PDFDocument.create();
            const copiedPages = await chunkDoc.copyPages(srcPdfDoc, pageIndices);
            copiedPages.forEach((cp) => chunkDoc.addPage(cp));
            const chunkBytes = await chunkDoc.save();
            await fs.writeFile(chunkPdfPath, Buffer.from(chunkBytes));

            const chunkOptions: any = {
              density: TARGET_DENSITY,
              format: "jpeg", // Write JPEG directly from GM/GS instead of uncompressed 35MB PNGs!
              quality: 92,
              savePath: tempDirPath,
              saveFilename: `page_${chunkStart}_${uuidv4()}`,
              width: targetWidth,
              height: targetHeight,
              compression: "jpeg",
              "-background": "white",
              "-alpha": "remove",
              "-flatten": true,
              ...pdf2picCustomOptions
            };

            const convertChunk = fromPath(chunkPdfPath, chunkOptions);
            const chunkResults = (await convertChunk.bulk(-1)) as unknown as ConversionResult[];

            if (Array.isArray(chunkResults)) {
              chunkResults.sort((a, b) => (a.page || 0) - (b.page || 0));

              const chunkPages = await Promise.all(
                chunkResults.map(async (res, j): Promise<StandardizedPage | null> => {
                  const globalPageIndex = chunkStart + j;
                  if (!res || !res.path) return null;

                  try {
                    // Single-pass sharp optimization + dimension extraction in parallel across chunk pages
                    const { data: optimizedBuffer, info } = await sharp(res.path)
                      .flatten({ background: { r: 255, g: 255, b: 255 } })
                      .grayscale()
                      .jpeg({ quality: 85 })
                      .toBuffer({ resolveWithObject: true });

                    // Immediately delete the rasterized page file from /tmp RAM disk
                    await fs.unlink(res.path).catch(() => {});

                    if (info.width && info.height) {
                      return {
                        pageIndex: globalPageIndex,
                        imageData: `data:image/jpeg;base64,${optimizedBuffer.toString('base64')}`,
                        width: info.width,
                        height: info.height
                      };
                    }
                    return null;
                  } catch (pageErr) {
                    console.error(`❌ [PDF Processing] Failed to optimize page ${globalPageIndex + 1}:`, pageErr);
                    await fs.unlink(res.path).catch(() => {});
                    return null;
                  }
                })
              );

              chunkPages.forEach((p) => {
                if (p) standardizedPages.push(p);
              });
            }
          } finally {
            // Immediately delete the 3-page sub-PDF from /tmp RAM disk before starting the next chunk
            await fs.unlink(chunkPdfPath).catch(() => {});
          }
        }

        // Release srcPdfDoc reference
        srcPdfDoc = null;
      } else {
        // 3B. FALLBACK FOR NON-STANDARD PDFS THAT PDF-LIB COULD NOT PARSE:
        const fallbackPdfPath = path.join(tempDirPath, `fallback_${Date.now()}.pdf`);
        await fs.writeFile(fallbackPdfPath, Buffer.from(cleanPdfBytes));

        const fallbackOptions: any = {
          density: 200,
          format: "jpeg",
          quality: 90,
          savePath: tempDirPath,
          saveFilename: `fb_page_${uuidv4()}`,
          width: targetWidth,
          height: targetHeight,
          compression: "jpeg",
          "-background": "white",
          "-alpha": "remove",
          "-flatten": true,
          ...pdf2picCustomOptions
        };

        const convertFallback = fromPath(fallbackPdfPath, fallbackOptions);
        const results = (await convertFallback.bulk(-1)) as unknown as ConversionResult[];

        if (Array.isArray(results)) {
          results.sort((a, b) => (a.page || 0) - (b.page || 0));
          for (let i = 0; i < results.length; i++) {
            const res = results[i];
            if (!res?.path) continue;
            try {
              const { data: optimizedBuffer, info } = await sharp(res.path)
                .flatten({ background: { r: 255, g: 255, b: 255 } })
                .grayscale()
                .jpeg({ quality: 84 })
                .toBuffer({ resolveWithObject: true });

              await fs.unlink(res.path).catch(() => {});

              if (info.width && info.height) {
                standardizedPages.push({
                  pageIndex: i,
                  imageData: `data:image/jpeg;base64,${optimizedBuffer.toString('base64')}`,
                  width: info.width,
                  height: info.height
                });
              }
            } catch (err) {
              await fs.unlink(res.path).catch(() => {});
            }
          }
        }
        await fs.unlink(fallbackPdfPath).catch(() => {});
      }

      if (standardizedPages.length === 0) {
        throw new Error('PDF conversion returned no valid pages.');
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✅ [PDF Processing] Converted ${standardizedPages.length} pages at ${TARGET_DENSITY} DPI in ${duration}s.`);
      return standardizedPages;

    } catch (error) {
      console.error('❌ [PDF Processing] PDF conversion failed:', error);
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes('Postscript delegate failed') || errorMessage.includes('gm identify')) {
        throw new Error('PDF_UNREADABLE: The uploaded PDF is corrupted, password-protected, or in an unsupported format. Please open the file, select "Print to PDF", and upload the new version.');
      }

      throw new Error(`PDF processing failed: ${errorMessage}`);
    } finally {
      try {
        if (tempDirPath) {
          await fs.rm(tempDirPath, { recursive: true, force: true });
        }
      } catch (cleanupError) {
        console.error(`⚠️ [PDF Processing] Failed to clean up temporary directory ${tempDirPath}:`, cleanupError);
      }
    }
  }
}

export default PdfProcessingService;
