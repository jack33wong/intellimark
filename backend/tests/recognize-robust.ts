// To run this file:
// 1. Make sure you have run: npm install @google-cloud/vision sharp
// 2. Set your auth variable: export GOOGLE_APPLICATION_CREDENTIALS="/path/to/your/keyfile.json"
// 3. Execute with: npx ts-node recognize-robust.ts

import { ImageAnnotatorClient, protos } from '@google-cloud/vision';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// --- Type Aliases for Clarity ---
type IBlock = protos.google.cloud.vision.v1.IBlock;
type IParagraph = protos.google.cloud.vision.v1.IParagraph;
type ILine = protos.google.cloud.vision.v1.ILine;
type IBoundingBox = protos.google.cloud.vision.v1.IBoundingBox;
type IVertex = protos.google.cloud.vision.v1.IVertex;
type IWord = protos.google.cloud.vision.v1.IWord;
type ISymbol = protos.google.cloud.vision.v1.ISymbol;

type DetectedBlock = {
    source: string;
    blockIndex: number;
    parentBlockIndex?: number; // Added to preserve hierarchy
    parentParagraphIndex?: number; // New field for paragraph parent
    text?: string | null;
    confidence?: number | null;
    geometry: {
        width: number;
        height: number;
        boundingBox: IVertex[];
        minX: number;
        minY: number;
    };
};

// --- Configuration ---
const IMAGE_FILE_NAME = '../../testingdata/test5.png';
const OUTPUT_JSON_FILE = 'analysis_result.json';
const OUTPUT_VERIFICATION_IMAGE = 'verification_overlay.png';
const RESIZE_FACTOR = 2; // Enlarge image for the aggressive pass
const IOU_THRESHOLD = 0.7; // Overlap threshold to consider blocks as duplicates
const LINE_GROUP_TOLERANCE_Y = 10; // Tolerance in pixels to group words into the same line.
// --- End Configuration ---


/**
 * Helper function to calculate width and height from bounding box vertices
 * for any Vision API entity (block, paragraph, word, etc.).
 */
function getGeometry(entity: { boundingBox?: IBoundingBox | null }, scale = 1) {
    const vertices = entity.boundingBox?.vertices;
    if (!vertices || vertices.length < 4) return { width: 0, height: 0, boundingBox: [], minX: 0, minY: 0 };
    
    // Extract and scale coordinates
    const xCoords = vertices.map(v => (v.x || 0) / scale);
    const yCoords = vertices.map(v => (v.y || 0) / scale);
    
    // Calculate min/max and dimensions
    const minX = Math.min(...xCoords);
    const maxX = Math.max(...xCoords);
    const minY = Math.min(...yCoords);
    const maxY = Math.max(...yCoords);

    return { 
        width: Math.round(maxX - minX), 
        height: Math.round(maxY - minY), 
        boundingBox: vertices.map(v => ({ x: Math.round((v.x || 0) / scale), y: Math.round((v.y || 0) / scale) })),
        minX: Math.round(minX), 
        minY: Math.round(minY) 
    };
}

/**
 * Calculates the Intersection over Union (IoU) of two bounding boxes.
 */
function calculateIoU(boxA: {minX: number, minY: number, width: number, height: number}, boxB: {minX: number, minY: number, width: number, height: number}): number {
    const xA = Math.max(boxA.minX, boxB.minX);
    const yA = Math.max(boxA.minY, boxB.minY);
    const xB = Math.min(boxA.minX + boxA.width, boxB.minX + boxB.width);
    const yB = Math.min(boxA.minY + boxA.height, boxB.minY + boxB.height);

    const intersectionArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    const boxAArea = boxA.width * boxA.height;
    const boxBArea = boxB.width * boxB.height;
    
    const iou = intersectionArea / (boxAArea + boxBArea - intersectionArea);
    return isNaN(iou) ? 0 : iou;
}

/**
 * Creates a verification image by drawing color-coded bounding boxes on the original image.
 */
async function createVerificationImage(detectedBlocks: DetectedBlock[], originalImagePath: string, outputImagePath: string) {
    console.log('\n🎨 Creating verification image with color-coded bounding boxes...');
    try {
        const image = sharp(originalImagePath);
        const metadata = await image.metadata();
        const imageWidth = metadata.width || 856;
        const imageHeight = metadata.height || 1258;

        const sourceColors: { [key: string]: string } = {
            'pass_A_clean_scan': 'blue',
            'pass_B_enhanced_scan': 'purple',
            'pass_C_aggressive_scan': 'green'
        };

        const svgElements = detectedBlocks.map(block => {
            const { minX, minY, width, height } = block.geometry;
            const blockIndex = block.blockIndex;
            const color = sourceColors[block.source] || 'yellow';
            
            const rect = `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" style="fill:rgba(0,0,0,0.1);stroke:${color};stroke-width:2" />`;
            const text = `<text x="${minX + 5}" y="${minY + 20}" font-family="Arial" font-size="20" fill="${color}" font-weight="bold">${blockIndex}</text>`;
            
            return rect + text;
        }).join('');

        const svgOverlay = `<svg width="${imageWidth}" height="${imageHeight}">${svgElements}</svg>`;
        const svgBuffer = Buffer.from(svgOverlay);

        await image.composite([{ input: svgBuffer, top: 0, left: 0 }]).toFile(outputImagePath);
        console.log(`✅ Verification image saved to: ${outputImagePath}`);
    } catch (error) {
        console.error('❌ Failed to create verification image:', error);
    }
}

/**
 * Processes a single fullTextAnnotation object and returns an array of DetectedBlocks.
 * This function now uses a hybrid approach:
 * 1. Tries to use Vision API's detected lines for a cleaner result.
 * 2. If no lines are detected, falls back to a robust word-by-word grouping method.
 */
function processTextAnnotation(fullTextAnnotation: protos.google.cloud.vision.v1.IFullTextAnnotation | null | undefined, source: string, scale: number = 1): DetectedBlock[] {
    const detectedBlocks: DetectedBlock[] = [];
    if (!fullTextAnnotation || !fullTextAnnotation.pages) {
        return detectedBlocks;
    }
    
    fullTextAnnotation.pages.forEach(page => {
        page.blocks?.forEach((block, blockIndex) => {
            block.paragraphs?.forEach((paragraph, paragraphIndex) => {
                // Hybrid Logic:
                // First, check if the Vision API provided lines. This is usually more accurate.
                if (paragraph.lines && paragraph.lines.length > 0) {
                    paragraph.lines.forEach((line) => {
                        const lineText = line.words?.map(word => word.symbols?.map(s => s.text).join('')).join(' ');
                        if (line.boundingBox) {
                            detectedBlocks.push({
                                source,
                                blockIndex: detectedBlocks.length + 1,
                                parentBlockIndex: blockIndex + 1,
                                parentParagraphIndex: paragraphIndex + 1,
                                text: lineText,
                                confidence: line.confidence,
                                geometry: getGeometry(line, scale)
                            });
                        }
                    });
                } else {
                    // Fallback to word-by-word grouping if no lines are detected
                    const allWords: (IWord & { parentBlockIndex: number, parentParagraphIndex: number })[] = [];
                    paragraph.words?.forEach(word => {
                        allWords.push({
                            ...word,
                            parentBlockIndex: blockIndex + 1,
                            parentParagraphIndex: paragraphIndex + 1
                        });
                    });

                    allWords.sort((a, b) => {
                        const aMinY = a.boundingBox?.vertices?.[0]?.y || 0;
                        const bMinY = b.boundingBox?.vertices?.[0]?.y || 0;
                        const aMinX = a.boundingBox?.vertices?.[0]?.x || 0;
                        const bMinX = b.boundingBox?.vertices?.[0]?.x || 0;
                        if (Math.abs(aMinY - bMinY) <= LINE_GROUP_TOLERANCE_Y) {
                            return aMinX - bMinX;
                        }
                        return aMinY - bMinY;
                    });

                    let currentLine: (IWord & { parentBlockIndex: number, parentParagraphIndex: number })[] = [];

                    allWords.forEach((word, index) => {
                        if (currentLine.length === 0) {
                            currentLine.push(word);
                        } else {
                            const lastWordInLine = currentLine[currentLine.length - 1];
                            const lastWordMinY = lastWordInLine.boundingBox?.vertices?.[0]?.y || 0;
                            const currentWordMinY = word.boundingBox?.vertices?.[0]?.y || 0;

                            if (Math.abs(currentWordMinY - lastWordMinY) <= LINE_GROUP_TOLERANCE_Y) {
                                currentLine.push(word);
                            } else {
                                // End of line, process and reset
                                if (currentLine.length > 0) {
                                    processLine(currentLine);
                                }
                                currentLine = [word];
                            }
                        }

                        // Process the last line at the end of the loop
                        if (index === allWords.length - 1 && currentLine.length > 0) {
                            processLine(currentLine);
                        }
                    });

                    function processLine(words: (IWord & { parentBlockIndex: number, parentParagraphIndex: number })[]) {
                        const minX = Math.min(...words.map(w => w.boundingBox?.vertices?.[0]?.x || 0));
                        const minY = Math.min(...words.map(w => w.boundingBox?.vertices?.[0]?.y || 0));
                        const maxX = Math.max(...words.map(w => w.boundingBox?.vertices?.[2]?.x || 0));
                        const maxY = Math.max(...words.map(w => w.boundingBox?.vertices?.[2]?.y || 0));
                        
                        const lineText = words.map(w => w.symbols?.map(s => s.text).join('')).join(' ');

                        detectedBlocks.push({
                            source,
                            blockIndex: detectedBlocks.length + 1,
                            parentBlockIndex: words[0].parentBlockIndex,
                            parentParagraphIndex: words[0].parentParagraphIndex,
                            text: lineText,
                            confidence: words.reduce((sum, w) => sum + (w.confidence || 0), 0) / words.length,
                            geometry: getGeometry({ boundingBox: { vertices: [{x: minX, y: minY}, {x: maxX, y: minY}, {x: maxX, y: maxY}, {x: minX, y: maxY}] } }, scale)
                        });
                    }
                }
            });
        });
    });

    return detectedBlocks;
}

/**
 * Main execution function for the full document analysis pipeline.
 */
async function analyzeFullDocument() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('\n❌ ERROR: GOOGLE_APPLICATION_CREDENTIALS environment variable is not set.');
    return;
  }
  
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const targetFilePath = path.join(__dirname, IMAGE_FILE_NAME);

  if (!fs.existsSync(targetFilePath)) {
    console.error(`\n❌ ERROR: Image file not found at: ${targetFilePath}`);
    return;
  }

  console.log(`--- Starting Three-Pass Hybrid Analysis on: ${path.basename(targetFilePath)} ---`);

  try {
    const originalBuffer = fs.readFileSync(targetFilePath);
    const client = new ImageAnnotatorClient();

    // --- Analysis A (Clean Scan for Completeness) ---
    console.log('\n🚀 Running Pass A (Clean Scan for Completeness)...');
    const [resultA] = await client.textDetection(originalBuffer);
    const blocksA = processTextAnnotation(resultA.fullTextAnnotation, 'pass_A_clean_scan');
    console.log(`✅ Pass A complete: ${blocksA.length} blocks found.`);

    // --- Analysis B (Enhanced Scan for Accuracy) ---
    console.log('\n🚀 Running Pass B (Enhanced Scan for Accuracy)...');
    const originalMetadata = await sharp(originalBuffer).metadata();
    const preprocessedBufferB = await sharp(originalBuffer)
      .resize(originalMetadata.width ? originalMetadata.width * RESIZE_FACTOR : 0)
      .grayscale()
      .normalize()
      .toBuffer();
    
    const [resultB] = await client.textDetection(preprocessedBufferB);
    const blocksB = processTextAnnotation(resultB.fullTextAnnotation, 'pass_B_enhanced_scan', RESIZE_FACTOR);
    console.log(`✅ Pass B complete: ${blocksB.length} blocks found.`);
    
    // --- Analysis C (Aggressive Scan for |V| Edge Cases) ---
    console.log('\n🚀 Running Pass C (Aggressive Scan for |V|)...');
    const preprocessedBufferC = await sharp(originalBuffer)
      .resize(originalMetadata.width ? originalMetadata.width * RESIZE_FACTOR : 0)
      .sharpen()
      .threshold()
      .toBuffer();
      
    const [resultC] = await client.textDetection(preprocessedBufferC);
    const blocksC = processTextAnnotation(resultC.fullTextAnnotation, 'pass_C_aggressive_scan', RESIZE_FACTOR);
    console.log(`✅ Pass C complete: ${blocksC.length} blocks found.`);

    // --- "Cluster and Select by Completeness" Merge Strategy ---
    console.log('\n🔄 Merging results with "Most Complete" strategy...');
    console.log('🔍 DEBUG: blocksA count:', blocksA.length);
    console.log('🔍 DEBUG: blocksB count:', blocksB.length);
    console.log('🔍 DEBUG: blocksC count:', blocksC.length);
    
    const masterList = [...blocksA, ...blocksB, ...blocksC];
    const finalBlocks: DetectedBlock[] = [];
    const processedIndices = new Set<number>();

    for (let i = 0; i < masterList.length; i++) {
        if (processedIndices.has(i)) continue;

        const cluster = [masterList[i]];
        processedIndices.add(i);

        for (let j = i + 1; j < masterList.length; j++) {
            if (processedIndices.has(j)) continue;
            if (calculateIoU(masterList[i].geometry, masterList[j].geometry) > IOU_THRESHOLD) {
                cluster.push(masterList[j]);
                processedIndices.add(j);
            }
        }
        
        let bestBlock = cluster[0];
        for (let k = 1; k < cluster.length; k++) {
            const currentBestText = bestBlock.text || '';
            const candidateText = cluster[k].text || '';
            if (candidateText.length > currentBestText.length) {
                bestBlock = cluster[k];
            }
        }
        
        finalBlocks.push(bestBlock);
    }
    
    finalBlocks.forEach((block, index) => block.blockIndex = index + 1); // Re-index all blocks
    console.log(`✅ Merge complete: ${finalBlocks.length} unique blocks selected.`);
    
    // Debug final blocks geometry
    console.log('🔍 DEBUG: Final blocks count:', finalBlocks.length);
    if (finalBlocks.length > 0) {
      console.log('🔍 DEBUG: First final block geometry:', finalBlocks[0].geometry);
      console.log('🔍 DEBUG: First final block text:', finalBlocks);
      if (finalBlocks.length > 1) {
        console.log('🔍 DEBUG: Second final block geometry:', finalBlocks[1].geometry);
      }
    }

    // --- Final Consolidated Report ---
    const finalResult = {
      sourceImage: IMAGE_FILE_NAME,
      analysisSummary: {
          blocks_from_pass_A_clean: blocksA.length,
          blocks_from_pass_B_enhanced: blocksB.length,
          blocks_from_pass_C_aggressive: blocksC.length,
          total_final_blocks: finalBlocks.length,
      },
      detectedBlocks: finalBlocks
    };
    
    const jsonOutput = JSON.stringify(finalResult, null, 2);
    const outputFilePath = path.join(__dirname, OUTPUT_JSON_FILE);
    
    fs.writeFileSync(outputFilePath, jsonOutput);
    console.log(`\n✅ Result saved to: ${outputFilePath}`);

    // --- Create the final verification image ---
    await createVerificationImage(finalResult.detectedBlocks, targetFilePath, path.join(__dirname, OUTPUT_VERIFICATION_IMAGE));

  } catch (error) {
    console.error('❌ An error occurred during the document analysis pipeline:', error);
  }
}

analyzeFullDocument();
