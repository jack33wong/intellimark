/**
 * OcrService.ts
 * Extracts raw text blocks from a correctly oriented image.
 */
import { ImageAnnotatorClient } from '@google-cloud/vision';

// OcrBlock interface should be moved to a shared types file
export interface OcrBlock {
  text: string;
  boundingBox: { x: number; y: number; width: number; height: number };
  source: string;
  confidence?: number;
  [key: string]: any;
}

export class OcrService {
  public static async extractRawBlocks(imageBuffer: Buffer): Promise<OcrBlock[]> {
    console.log('🔍 [OCR SERVICE] Performing text extraction on corrected image...');
    const client = new ImageAnnotatorClient();

    try {
      // Prioritize DOCUMENT_TEXT_DETECTION as it generally performs better with handwriting and dense layouts.
      const [result] = await client.documentTextDetection(imageBuffer);
      const blocks = this._processWordAnnotations(result.fullTextAnnotation);
      
      console.log(`✅ [OCR SERVICE] Extraction complete (Document Mode). Found ${blocks.length} raw text blocks.`);
      return blocks;
    } catch (error) {
      console.error('❌ [OCR SERVICE] Google Vision (Document Mode) failed:', error);
      // Fallback to standard TEXT_DETECTION
      try {
        console.log('🔄 [OCR SERVICE] Falling back to standard TEXT_DETECTION...');
        const [result] = await client.textDetection(imageBuffer);
        const blocks = this._processWordAnnotations(result.fullTextAnnotation);
        console.log(`✅ [OCR SERVICE] Fallback extraction complete. Found ${blocks.length} raw text blocks.`);
        return blocks;
      } catch (fallbackError) {
        console.error('❌ [OCR SERVICE] Fallback Google Vision text detection failed:', fallbackError);
        return [];
      }
    }
  }

  private static _processWordAnnotations(fullTextAnnotation: any): OcrBlock[] {
    const detectedBlocks: OcrBlock[] = [];
    if (!fullTextAnnotation || !fullTextAnnotation.pages) return [];

    for (const page of fullTextAnnotation.pages) {
        if (!page.blocks) continue;
      for (const block of page.blocks) {
        if (!block.paragraphs) continue;
        for (const paragraph of block.paragraphs) {
            if (!paragraph.words) continue;
          for (const word of paragraph.words) {
            const wordText = word.symbols.map((s: any) => s.text).join('');

            // Robust bounding box validation
            if (!word.boundingBox || !word.boundingBox.vertices) continue;
            const vertices = word.boundingBox.vertices;
            
            // Filter out potential null/undefined coordinates (occurs sometimes in Vision API)
            const validVertices = vertices.filter((v: any) => v.x != null && v.y != null);
            if (validVertices.length === 0) continue;

            const minX = Math.min(...validVertices.map((v: any) => v.x));
            const minY = Math.min(...validVertices.map((v: any) => v.y));
            const maxX = Math.max(...validVertices.map((v: any) => v.x));
            const maxY = Math.max(...validVertices.map((v: any) => v.y));

            // Ensure valid dimensions
            if (maxX > minX && maxY > minY) {
                detectedBlocks.push({
                  text: wordText,
                  boundingBox: {
                    x: minX,
                    y: minY,
                    width: maxX - minX,
                    height: maxY - minY,
                  },
                  source: 'google-vision-word',
                  confidence: word.confidence || undefined // Include confidence if available
                });
            }
          }
        }
      }
    }
    return detectedBlocks;
  }

  /**
   * A helper function to combine the text from an array of blocks into a single string.
   */
  public static getFullTextFromBlocks(blocks: OcrBlock[]): string {
    if (!blocks) return '';
    // Sort blocks before joining to maintain reading order (top-to-bottom, left-to-right)
    const sortedBlocks = [...blocks].sort((a, b) => {
        // Allow slight vertical variation (10px) before sorting by X
        if (Math.abs(a.boundingBox.y - b.boundingBox.y) > 10) {
            return a.boundingBox.y - b.boundingBox.y;
        }
        return a.boundingBox.x - b.boundingBox.x;
    });
    return sortedBlocks.map(b => b.text).join(' ');
  }
}