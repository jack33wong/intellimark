import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { ClassificationService } from '../services/ai/ClassificationService.js';
import { OptimizedOCRService } from '../services/ai/OptimizedOCRService.js';

// Load environment variables from .env.local
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Set Google Cloud authentication
const credentialsPath = path.resolve(process.cwd(), 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');
process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
console.log('🔑 [AUTH] Google credentials path:', credentialsPath);

// Test configuration
const TEST_CONFIG = {
  imagePath: 'scripts/IMG_1596.jpg',
  outputDir: 'debug-images'
};

// Ensure output directory exists
async function ensureOutputDir() {
  try {
    await fs.mkdir(TEST_CONFIG.outputDir, { recursive: true });
  } catch (error) {
    console.error('❌ Failed to create output directory:', error);
  }
}

// Load test image
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

// Create debug image with red outline rectangles
async function createDebugImage(originalImageBuffer: Buffer, blocks: any[], outputPath: string) {
  console.log(`🖼️ [DEBUG IMAGE] Creating ${path.basename(outputPath)}...`);
  
  try {
    let debugImage = sharp(originalImageBuffer);
    
    // Create overlays for each block
    const overlays = [];
    
    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      
      // Handle different block formats
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
    }
    
    // Apply all overlays to the original image
    if (overlays.length > 0) {
      debugImage = debugImage.composite(overlays);
    }
    
    // Save the debug image
    await debugImage.png().toFile(outputPath);
    console.log(`✅ [DEBUG IMAGE] Saved: ${outputPath}`);
    
  } catch (error) {
    console.error('❌ [DEBUG IMAGE] Failed to create debug image:', error);
    throw error;
  }
}

// Main test function
async function runFilteredOCRTest() {
  console.log('🎯 [TEST] Filtered OCR Test - Step 2 AI Detection + Step 3 Filtering');
  console.log('=' .repeat(80));
  
  try {
    await ensureOutputDir();
    
    // Load test image
    const { imageData, imageBuffer } = await loadTestImage();
    
    // Step 2: Get Google Vision blocks and AI-detected question text
    console.log('🔍 [STEP 2] Text Extraction & Mode Detection...');
    const startTime = Date.now();
    const step2Result = await ClassificationService.extractTextAndAnalyze(
      imageData,
      'gemini-2.5-flash'
    );
    const step2Time = Date.now() - startTime;
    console.log(`✅ [STEP 2] Completed in ${step2Time}ms`);
    console.log(`📊 [STEP 2] Mode: ${step2Result.textAnalysis.mode}`);
    console.log(`📊 [STEP 2] Google Vision blocks: ${step2Result.visionResult.allBlocks.length}`);
    console.log(`📊 [STEP 2] Extracted question text: "${step2Result.textAnalysis.questionText.substring(0, 100)}..."`);
    
    // Step 3: Process with filtering using AI-detected question text
    console.log('🔍 [STEP 3] Enhanced Text Processing with AI Filtering...');
    const step3StartTime = Date.now();
    const step3Result = await OptimizedOCRService.processWithExistingVisionResults(
      step2Result.visionResult,
      imageBuffer,
      false, // debug = false
      step2Result.textAnalysis.questionText // Pass extracted question text for filtering
    );
    const step3Time = Date.now() - step3StartTime;
    console.log(`✅ [STEP 3] Completed in ${step3Time}ms`);
    console.log(`📊 [STEP 3] Final blocks: ${step3Result.boundingBoxes.length}`);
    console.log(`📊 [STEP 3] Mathpix calls: ${step3Result.usage?.mathpixCalls || 0}`);
    
    // Create debug images
    const outputDir = TEST_CONFIG.outputDir;
    
    // 1) Google Vision Raw Blocks (before filtering)
    const googleVisionBlocks = [
      ...(step2Result.visionResult.passA || []),
      ...(step2Result.visionResult.passB || []),
      ...(step2Result.visionResult.passC || [])
    ];
    
    await createDebugImage(
      imageBuffer, 
      googleVisionBlocks, 
      path.join(outputDir, 'google-vision-raw-blocks.png')
    );
    
    // 2) Filtered Blocks (after AI filtering + two-pass algorithm)
    await createDebugImage(
      imageBuffer, 
      step3Result.boundingBoxes, 
      path.join(outputDir, 'filtered-ocr-blocks.png')
    );
    
    // Show comparison
    console.log('\n📊 [COMPARISON] Before vs After Filtering:');
    console.log('=' .repeat(60));
    console.log(`🔢 Google Vision blocks: ${googleVisionBlocks.length}`);
    console.log(`🔢 After AI filtering + two-pass: ${step3Result.boundingBoxes.length}`);
    console.log(`📉 Reduction: ${((googleVisionBlocks.length - step3Result.boundingBoxes.length) / googleVisionBlocks.length * 100).toFixed(1)}%`);
    
    // Show final block content
    console.log('\n📝 [FINAL FILTERED BLOCKS CONTENT]:');
    step3Result.boundingBoxes.forEach((block, index) => {
      const text = block.text || '';
      const words = text.trim().split(/\s+/);
      const trimmedText = words.length > 20 ? words.slice(0, 20).join(' ') + '...' : text;
      console.log(`  Block ${index + 1}: "${trimmedText}"`);
    });
    
    console.log('\n🖼️ [DEBUG IMAGES CREATED]:');
    console.log(`  - ${path.join(outputDir, 'google-vision-raw-blocks.png')} (Google Vision raw blocks)`);
    console.log(`  - ${path.join(outputDir, 'filtered-ocr-blocks.png')} (AI filtered + two-pass algorithm)`);
    
    console.log('\n✅ [TEST COMPLETED] Filtered OCR test finished!');
    
  } catch (error) {
    console.error('❌ [TEST FAILED]:', error);
    process.exit(1);
  }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  runFilteredOCRTest();
}






