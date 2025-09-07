import { ImageAnnotatorClient } from '@google-cloud/vision';

/**
 * Service for Google Cloud Vision API operations
 */
export class GoogleVisionService {
  private client: ImageAnnotatorClient;

  constructor() {
    this.client = new ImageAnnotatorClient();
  }

  /**
   * Recognizes handwritten text in a local image file using Google Vision API
   * @param filePath - The path to the local image file
   * @returns Promise containing the detected text or null if no text found
   */
  async recognizeHandwriting(filePath: string): Promise<string | null> {
    try {
      console.log(`Analyzing file: ${filePath}`);

      // Use documentTextDetection for dense text or handwriting
      const [result] = await this.client.documentTextDetection(filePath);
      
      // Log the original Google Vision API response
      console.log('\n🔍 ORIGINAL GOOGLE VISION API RESPONSE (Handwriting):');
      console.log('==================================================');
      console.log(JSON.stringify(result, null, 2));
      console.log('==================================================\n');
      
      const fullTextAnnotation = result.fullTextAnnotation;

      if (fullTextAnnotation && fullTextAnnotation.text) {
        console.log('✅ Recognition successful!');
        console.log('--- Full Detected Text ---');
        const detectedText = fullTextAnnotation.text.trim();
        console.log(detectedText);
        console.log('--------------------------');
        return detectedText;
      } else {
        console.log('⚠️ No text detected in the image.');
        return null;
      }
    } catch (error) {
      console.error('❌ ERROR:', error);
      throw new Error(`Failed to recognize handwriting: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Recognizes text in a local image file using Google Vision API
   * @param filePath - The path to the local image file
   * @returns Promise containing the detected text or null if no text found
   */
  async recognizeText(filePath: string): Promise<string | null> {
    try {
      console.log(`Analyzing file for text: ${filePath}`);

      // Use textDetection for general text recognition
      const [result] = await this.client.textDetection(filePath);
      
      // Log the original Google Vision API response
      console.log('\n🔍 ORIGINAL GOOGLE VISION API RESPONSE (Text Detection):');
      console.log('====================================================');
      console.log(JSON.stringify(result, null, 2));
      console.log('====================================================\n');
      
      const detections = result.textAnnotations;

      if (detections && detections.length > 0) {
        console.log('✅ Text recognition successful!');
        console.log('--- Detected Text ---');
        const detectedText = detections[0].description?.trim() || '';
        console.log(detectedText);
        console.log('---------------------');
        return detectedText;
      } else {
        console.log('⚠️ No text detected in the image.');
        return null;
      }
    } catch (error) {
      console.error('❌ ERROR:', error);
      throw new Error(`Failed to recognize text: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Gets detailed text annotations with bounding boxes and coordinates
   * @param filePath - The path to the local image file
   * @returns Promise containing detailed text annotations with coordinates
   */
  async getDetailedTextAnnotations(filePath: string): Promise<any> {
    try {
      console.log(`Getting detailed annotations for: ${filePath}`);

      const [result] = await this.client.documentTextDetection(filePath);
      
      // Log the original Google Vision API response
      console.log('\n🔍 ORIGINAL GOOGLE VISION API RESPONSE:');
      console.log('=====================================');
      console.log(JSON.stringify(result, null, 2));
      console.log('=====================================\n');
      
      const fullTextAnnotation = result.fullTextAnnotation;

      if (fullTextAnnotation) {
        console.log('✅ Detailed annotations retrieved successfully!');
        
        // Extract detailed coordinate information
        const detailedResult = {
          fullText: fullTextAnnotation.text?.trim() || '',
          pages: fullTextAnnotation.pages || [],
          blocks: [],
          paragraphs: [],
          words: [],
          symbols: []
        };

        // Process each page
        fullTextAnnotation.pages?.forEach((page, pageIndex) => {
          // Process blocks
          page.blocks?.forEach((block, blockIndex) => {
            const blockInfo = {
              blockIndex,
              pageIndex,
              boundingBox: block.boundingBox,
              confidence: block.confidence,
              paragraphs: []
            };

            // Process paragraphs in block
            block.paragraphs?.forEach((paragraph, paragraphIndex) => {
              const paragraphInfo = {
                paragraphIndex,
                blockIndex,
                pageIndex,
                boundingBox: paragraph.boundingBox,
                confidence: paragraph.confidence,
                words: []
              };

              // Process words in paragraph
              paragraph.words?.forEach((word, wordIndex) => {
                const wordInfo = {
                  wordIndex,
                  paragraphIndex,
                  blockIndex,
                  pageIndex,
                  boundingBox: word.boundingBox,
                  confidence: word.confidence,
                  text: word.symbols?.map(s => s.text).join('') || '',
                  symbols: word.symbols?.map((symbol, symbolIndex) => ({
                    symbolIndex,
                    wordIndex,
                    paragraphIndex,
                    blockIndex,
                    pageIndex,
                    boundingBox: symbol.boundingBox,
                    confidence: symbol.confidence,
                    text: symbol.text,
                    break: symbol.property?.detectedBreak
                  })) || []
                };

                paragraphInfo.words.push(wordInfo);
                detailedResult.words.push(wordInfo);
                detailedResult.symbols.push(...wordInfo.symbols);
              });

              blockInfo.paragraphs.push(paragraphInfo);
              detailedResult.paragraphs.push(paragraphInfo);
            });

            detailedResult.blocks.push(blockInfo);
          });
        });

        return detailedResult;
      } else {
        console.log('⚠️ No detailed annotations found.');
        return null;
      }
    } catch (error) {
      console.error('❌ ERROR:', error);
      throw new Error(`Failed to get detailed annotations: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
