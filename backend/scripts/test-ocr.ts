#!/usr/bin/env tsx

/**
 * Step 3 OCR Processing Test with Visual Debug
 * 
 * This script reproduces the Step 3 (Enhanced Text Processing) problem
 * and creates visual debug images showing the 60+ blocks being detected.
 * 
 * Usage:
 *   tsx scripts/test-ocr.ts
 * 
 * Output:
 *   - debug-step3-blocks.png (red rectangles on each block)
 *   - debug-step3-numbered.png (with block numbers)
 *   - debug-step3-analysis.json (all block data)
 *   - debug-step3-stats.txt (problem analysis)
 */

import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { ClassificationService } from '../services/ai/ClassificationService.js';
import { OptimizedOCRService } from '../services/ai/OptimizedOCRService.js';
import { ImageUtils } from '../services/ai/ImageUtils.js';

// Load environment variables from .env.local
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Set Google Cloud authentication
const credentialsPath = path.resolve(process.cwd(), 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');
process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
console.log('🔑 [AUTH] Google credentials path:', credentialsPath);

// Verify Mathpix credentials
console.log('🔑 [AUTH] Mathpix App ID:', process.env.MATHPIX_APP_ID ? '✅ Set' : '❌ Missing');
console.log('🔑 [AUTH] Mathpix API Key:', process.env.MATHPIX_API_KEY ? '✅ Set' : '❌ Missing');

// Temporarily disable Mathpix for debugging
process.env.MATHPIX_APP_ID = '';
process.env.MATHPIX_API_KEY = '';
console.log('🔧 [DEBUG] Mathpix temporarily disabled for debugging');

// Test configuration
const TEST_CONFIG = {
  imagePath: 'scripts/IMG_1596.jpg',
  model: 'gemini-2.5-flash' as const,
  debug: false,
  outputDir: 'debug-images'
};

interface BlockAnalysis {
  totalBlocks: number;
  googleVisionBlocks: number;
  mathpixBlocks: number;
  averageBlockSize: number;
  blockSizes: number[];
  blockTexts: string[];
  processingTime: number;
  problemAreas: string[];
}

async function ensureOutputDir() {
  try {
    await fs.mkdir(TEST_CONFIG.outputDir, { recursive: true });
  } catch (error) {
    console.error('❌ Failed to create output directory:', error);
  }
}

async function loadTestImage(): Promise<{ imageData: string; imageBuffer: Buffer }> {
  console.log('📸 [LOADING] Test image:', TEST_CONFIG.imagePath);
  
  try {
    // Read the image file
    const imageBuffer = await fs.readFile(TEST_CONFIG.imagePath);
    
    // Get image metadata to check for EXIF orientation
    const metadata = await sharp(imageBuffer).metadata();
    console.log(`📊 [IMAGE INFO] Size: ${metadata.width}x${metadata.height}, Format: ${metadata.format}`);
    console.log(`📊 [IMAGE INFO] EXIF Orientation: ${metadata.orientation || 'none'}`);
    
    // Auto-rotate image based on EXIF orientation to get correct orientation
    const correctedImageBuffer = await sharp(imageBuffer)
      .rotate() // Auto-rotate based on EXIF orientation
      .jpeg()
      .toBuffer();
    
    // Get corrected metadata
    const correctedMetadata = await sharp(correctedImageBuffer).metadata();
    console.log(`📊 [CORRECTED] Size: ${correctedMetadata.width}x${correctedMetadata.height}`);
    
    // Convert to base64 data URL
    const base64Data = correctedImageBuffer.toString('base64');
    const imageData = `data:image/jpeg;base64,${base64Data}`;
    
    return { imageData, imageBuffer: correctedImageBuffer };
  } catch (error) {
    console.error('❌ [LOAD IMAGE] Failed:', error);
    throw error;
  }
}

async function runStep2(imageData: string) {
  console.log('🔍 [STEP 2] Text Extraction & Mode Detection...');
  const startTime = Date.now();
  
  try {
    const result = await ClassificationService.extractTextAndAnalyze(
      imageData,
      TEST_CONFIG.model
    );
    
    const processingTime = Date.now() - startTime;
    console.log(`✅ [STEP 2] Completed in ${processingTime}ms`);
    console.log(`📊 [STEP 2] Mode: ${result.textAnalysis.mode}`);
    console.log(`📊 [STEP 2] Google Vision blocks: ${result.visionResult.allBlocks.length}`);
    
    return result;
  } catch (error) {
    console.error('❌ [STEP 2] Failed:', error);
    throw error;
  }
}

async function runStep3(visionResult: any, imageBuffer: Buffer) {
  console.log('🔍 [STEP 3] Enhanced Text Processing...');
  const startTime = Date.now();
  
  try {
    const result = await OptimizedOCRService.processWithExistingVisionResults(
      visionResult,
      imageBuffer,
      TEST_CONFIG.debug
    );
    
    const processingTime = Date.now() - startTime;
    console.log(`✅ [STEP 3] Completed in ${processingTime}ms`);
    console.log(`📊 [STEP 3] Final blocks: ${result.boundingBoxes.length}`);
    console.log(`📊 [STEP 3] Mathpix calls: ${result.usage?.mathpixCalls || 0}`);
    
    return { result, processingTime };
  } catch (error) {
    console.error('❌ [STEP 3] Failed:', error);
    throw error;
  }
}

function analyzeBlocks(blocks: any[]): BlockAnalysis {
  console.log('📊 [ANALYSIS] Analyzing blocks...');
  
  const googleVisionBlocks = blocks.filter(block => !block.source || block.source === 'google-vision').length;
  const mathpixBlocks = blocks.filter(block => block.source === 'mathpix').length;
  
  const blockSizes = blocks.map(block => {
    const bbox = block.boundingBox || block.bbox;
    return (bbox.width || 0) * (bbox.height || 0);
  });
  
  const averageBlockSize = blockSizes.reduce((sum, size) => sum + size, 0) / blockSizes.length;
  
  const blockTexts = blocks.map(block => block.text || block.cleanedText || '').filter(text => text.trim());
  
  const problemAreas: string[] = [];
  
  // Identify potential problems
  if (blocks.length > 20) {
    problemAreas.push(`Too many blocks: ${blocks.length} (expected ~7)`);
  }
  
  const smallBlocks = blocks.filter(block => {
    const bbox = block.boundingBox || block.bbox;
    const area = (bbox.width || 0) * (bbox.height || 0);
    return area < 100; // Very small blocks
  });
  
  if (smallBlocks.length > blocks.length * 0.5) {
    problemAreas.push(`Too many small blocks: ${smallBlocks.length}/${blocks.length}`);
  }
  
  const emptyBlocks = blocks.filter(block => {
    const text = block.text || block.cleanedText || '';
    return !text.trim();
  });
  
  if (emptyBlocks.length > 0) {
    problemAreas.push(`Empty blocks: ${emptyBlocks.length}`);
  }
  
  return {
    totalBlocks: blocks.length,
    googleVisionBlocks,
    mathpixBlocks,
    averageBlockSize: Math.round(averageBlockSize),
    blockSizes,
    blockTexts,
    processingTime: 0, // Will be set later
    problemAreas
  };
}

async function createDebugImage(originalImageBuffer: Buffer, blocks: any[], outputPath: string, addNumbers: boolean = false) {
  console.log(`🖼️ [DEBUG IMAGE] Creating ${path.basename(outputPath)}...`);
  
  try {
    let debugImage = sharp(originalImageBuffer);
    
    // Create overlays for each block
    const overlays = [];
    
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      
      // Handle different block formats:
      // 1. Google Vision format: block.boundingBox.vertices
      // 2. Processed format: block.boundingBox or block.bbox
      let bbox;
      if (block.boundingBox?.vertices) {
        // Google Vision format - convert vertices to x,y,width,height
        const vertices = block.boundingBox.vertices;
        const x = Math.min(vertices[0].x, vertices[1].x, vertices[2].x, vertices[3].x);
        const y = Math.min(vertices[0].y, vertices[1].y, vertices[2].y, vertices[3].y);
        const width = Math.max(vertices[0].x, vertices[1].x, vertices[2].x, vertices[3].x) - x;
        const height = Math.max(vertices[0].y, vertices[1].y, vertices[2].y, vertices[3].y) - y;
        bbox = { x, y, width, height };
      } else {
        // Processed format
        bbox = block.boundingBox || block.bbox;
      }
      
      if (!bbox || !bbox.width || !bbox.height) {
        console.warn(`⚠️ [BLOCK ${i+1}] Invalid bounding box:`, bbox);
        continue;
      }
      
      const { x, y, width, height } = bbox;
      
      // Create red outline rectangle overlay with block index
      const redRectangle = await sharp({
        create: {
          width: Math.max(1, Math.floor(width)),
          height: Math.max(1, Math.floor(height)),
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent background
        }
      })
      .composite([{
        input: Buffer.from(`
          <svg width="${Math.max(1, Math.floor(width))}" height="${Math.max(1, Math.floor(height))}" xmlns="http://www.w3.org/2000/svg">
            <rect x="0" y="0" width="${Math.max(1, Math.floor(width))}" height="${Math.max(1, Math.floor(height))}" 
                  fill="none" stroke="red" stroke-width="2"/>
            <text x="8" y="28" font-family="Arial" font-size="24" fill="red" stroke="white" stroke-width="1" font-weight="bold">${i + 1}</text>
          </svg>
        `),
        top: 0,
        left: 0
      }])
      .png().toBuffer();
      
      overlays.push({
        input: redRectangle,
        left: Math.max(0, Math.floor(x)),
        top: Math.max(0, Math.floor(y))
      });
      
      // Add block numbers if requested
      if (addNumbers) {
        const numberSvg = Buffer.from(`
          <svg width="30" height="20" xmlns="http://www.w3.org/2000/svg">
            <rect width="30" height="20" fill="black" opacity="0.7" rx="3"/>
            <text x="15" y="14" font-family="Arial" font-size="12" fill="white" text-anchor="middle" font-weight="bold">${i+1}</text>
          </svg>
        `);
        
        overlays.push({
          input: numberSvg,
          left: Math.max(0, Math.floor(x)),
          top: Math.max(0, Math.floor(y) - 25)
        });
      }
    }
    
    // Apply all overlays
    if (overlays.length > 0) {
      debugImage = debugImage.composite(overlays);
    }
    
    // Save the debug image
    await debugImage.png().toFile(outputPath);
    console.log(`✅ [DEBUG IMAGE] Saved: ${outputPath}`);
    
  } catch (error) {
    console.error('❌ [DEBUG IMAGE] Failed:', error);
    throw error;
  }
}

async function saveAnalysisData(analysis: BlockAnalysis, blocks: any[], outputDir: string) {
  console.log('💾 [SAVE DATA] Saving analysis data...');
  
  try {
    // Save JSON analysis
    const analysisData = {
      timestamp: new Date().toISOString(),
      analysis,
      blocks: blocks.map((block, i) => ({
        index: i + 1,
        text: block.text || block.cleanedText || '',
        boundingBox: block.boundingBox || block.bbox,
        source: block.source || 'google-vision',
        confidence: block.confidence
      }))
    };
    
    const jsonPath = path.join(outputDir, 'debug-step3-analysis.json');
    await fs.writeFile(jsonPath, JSON.stringify(analysisData, null, 2));
    console.log(`✅ [JSON] Saved: ${jsonPath}`);
    
    // Save statistics report
    const statsReport = `
Step 3 OCR Processing Analysis Report
=====================================
Generated: ${new Date().toISOString()}
Test Image: ${TEST_CONFIG.imagePath}

BLOCK STATISTICS:
- Total Blocks: ${analysis.totalBlocks}
- Google Vision Blocks: ${analysis.googleVisionBlocks}
- Mathpix Blocks: ${analysis.mathpixBlocks}
- Average Block Size: ${analysis.averageBlockSize} pixels
- Processing Time: ${analysis.processingTime}ms

PROBLEM AREAS:
${analysis.problemAreas.length > 0 ? analysis.problemAreas.map(area => `- ${area}`).join('\n') : '- No obvious problems detected'}

BLOCK TEXT SAMPLES (first 10):
${analysis.blockTexts.slice(0, 10).map((text, i) => `${i+1}. "${text}"`).join('\n')}

RECOMMENDATIONS:
${analysis.totalBlocks > 20 ? '- Consider implementing block consolidation logic' : ''}
${analysis.problemAreas.some(area => area.includes('small blocks')) ? '- Filter out very small blocks (< 100px area)' : ''}
${analysis.problemAreas.some(area => area.includes('Empty blocks')) ? '- Remove empty text blocks' : ''}
`;
    
    const statsPath = path.join(outputDir, 'debug-step3-stats.txt');
    await fs.writeFile(statsPath, statsReport);
    console.log(`✅ [STATS] Saved: ${statsPath}`);
    
  } catch (error) {
    console.error('❌ [SAVE DATA] Failed:', error);
    throw error;
  }
}

async function runOCRTests() {
  console.log('🎯 [TEST] Step 3 OCR Processing with Visual Debug');
  console.log('=' .repeat(60));
  
  try {
    // Ensure output directory exists
    await ensureOutputDir();
    
    // Load test image
    const { imageData, imageBuffer } = await loadTestImage();
    
    // Run Step 2 (Text Extraction & Mode Detection)
    const step2Result = await runStep2(imageData);
    
    // Run Step 3 (Enhanced Text Processing) - THE PROBLEM AREA
    const { result: step3Result, processingTime } = await runStep3(step2Result.visionResult, imageBuffer);
    
    // Analyze the blocks
    const analysis = analyzeBlocks(step3Result.boundingBoxes);
    analysis.processingTime = processingTime;
    
    // Create debug images
    const outputDir = TEST_CONFIG.outputDir;
    
    // 1) Google Vision Raw Text Blocks Image
    // The vision result has passA, passB, passC arrays, not fullTextAnnotation.pages[0].blocks
    const googleVisionBlocks = [
      ...(step2Result.visionResult.passA || []),
      ...(step2Result.visionResult.passB || []),
      ...(step2Result.visionResult.passC || [])
    ];
    
    await createDebugImage(
      imageBuffer, 
      googleVisionBlocks, 
      path.join(outputDir, 'google-vision-raw-blocks.png'),
      true // Add numbers
    );
    
    // 2) Two-Pass Algorithm Blocks Image
    await createDebugImage(
      imageBuffer, 
      step3Result.boundingBoxes, 
      path.join(outputDir, 'two-pass-algo-blocks.png'),
      true // Add numbers
    );
    
    // Print summary
    console.log('\n📊 [SUMMARY] Step 3 OCR Analysis Results:');
    console.log('=' .repeat(60));
    console.log(`🔢 Total Blocks: ${analysis.totalBlocks}`);
    console.log(`👁️ Google Vision: ${analysis.googleVisionBlocks}`);
    console.log(`🧮 Mathpix: ${analysis.mathpixBlocks}`);
    console.log(`📏 Average Size: ${analysis.averageBlockSize}px`);
    console.log(`⏱️ Processing Time: ${processingTime}ms`);
    
    // Show final block content
    console.log('\n📝 [FINAL BLOCKS CONTENT]:');
    step3Result.boundingBoxes.forEach((block, index) => {
      const text = block.text || block.cleanedText || '';
      const words = text.trim().split(/\s+/);
      const trimmedText = words.length > 20 ? words.slice(0, 20).join(' ') + '...' : text;
      console.log(`  Block ${index + 1}: "${trimmedText}"`);
    });
    
    if (analysis.problemAreas.length > 0) {
      console.log('\n⚠️ [PROBLEMS DETECTED]:');
      analysis.problemAreas.forEach(problem => console.log(`  - ${problem}`));
    }
    
    console.log('\n🖼️ [DEBUG IMAGES CREATED]:');
    console.log(`  - ${path.join(outputDir, 'google-vision-raw-blocks.png')} (Google Vision raw blocks)`);
    console.log(`  - ${path.join(outputDir, 'two-pass-algo-blocks.png')} (Two-pass algorithm processed blocks)`);
    
    console.log('\n✅ [TEST COMPLETED] Check the debug images to compare Google Vision vs Two-pass algorithm!');
    
  } catch (error) {
    console.error('❌ [TEST FAILED]:', error);
    process.exit(1);
  }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  runOCRTests();
}
