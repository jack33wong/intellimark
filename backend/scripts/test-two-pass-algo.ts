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
  outputDir: 'debug-images',
  inputJsonPath: 'debug-images/prod-mathpix-enhanced-blocks.json', // Input: Real production data
  outputJsonPath: 'debug-images/two-pass-algorithm-output.json' // Output: 2-pass algorithm format (grouped lines)
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



// Save two-pass algorithm result to JSON file (same format as groupOcrSteps function)
async function saveTwoPassResult(result: any[]): Promise<void> {
  console.log('💾 [SAVE] Saving two-pass algorithm result to JSON...');
  
  try {
    const jsonData = JSON.stringify(result, null, 2);
    await fs.writeFile(TEST_CONFIG.outputJsonPath, jsonData, 'utf-8');
    
    console.log(`✅ [SAVE] Saved ${result.length} grouped lines to JSON`);
  } catch (error) {
    console.error('❌ [SAVE] Failed to save JSON:', error);
    throw error;
  }
}

// Load Google Vision blocks and convert to VisionResult format for real implementation
async function loadGoogleVisionBlocks(): Promise<any> {
  console.log('📂 [LOAD] Loading Google Vision blocks from JSON...');
  
  try {
    const jsonData = await fs.readFile(TEST_CONFIG.inputJsonPath, 'utf-8');
    const data = JSON.parse(jsonData);
    
    // Handle production data format
    const blocks = data.allBlocks || data;
    const mathBlocks = data.mathBlocks || [];
    
    console.log(`✅ [LOAD] Loaded ${blocks.length} blocks from production data`);
    console.log(`📊 [LOAD] Math blocks: ${mathBlocks.length}`);
    console.log(`📊 [LOAD] Timestamp: ${data.timestamp || 'unknown'}`);
    
    // Use the SAME processed format as production (text + boundingBox)
    // This ensures testing and production use identical data flow
    const processedBlocks = blocks.map(block => ({
      text: block.text || block.description || '',
      boundingBox: block.boundingBox || {
        x: block.boundingBox?.x || 0,
        y: block.boundingBox?.y || 0,
        width: block.boundingBox?.width || 0,
        height: block.boundingBox?.height || 0
      },
      source: block.source || 'pass_A_clean_scan',
      confidence: block.confidence || 0.9,
      // Include Mathpix data if available
      mathpixLatex: block.mathpixLatex,
      mathpixConfidence: block.mathpixConfidence,
      isMathBlock: block.isMathBlock || false
    }));
    
    // In production, ALL blocks (regular + math) go through the same pipeline
    // Math blocks are just enhanced with Mathpix data but still processed together
    console.log(`🔍 [TOTAL] Processing ${processedBlocks.length} total blocks (including Mathpix-enhanced)`);
    
    const visionResult = {
      passA: processedBlocks,
      passB: [],
      passC: [],
      allBlocks: processedBlocks, // ALL blocks go to allBlocks
      passAText: processedBlocks.map(block => block.text).join('\n'),
      // Store math blocks for the test
      mathBlocks: mathBlocks
    };
    
    // Debug: Log the structure of the first few blocks
    console.log('🔍 [DEBUG] First 3 blocks from JSON:');
    blocks.slice(0, 3).forEach((block, index) => {
      console.log(`  Block ${index}:`, {
        text: block.text || block.description || '',
        boundingBox: block.boundingBox,
        hasVertices: !!block.boundingBox?.vertices
      });
    });
    
    console.log('🔍 [DEBUG] First 3 converted processed blocks:');
    processedBlocks.slice(0, 3).forEach((block, index) => {
      console.log(`  Processed Block ${index}:`, {
        text: block.text,
        boundingBox: block.boundingBox
      });
    });
    
    return visionResult;
  } catch (error) {
    console.error('❌ [LOAD] Failed to load JSON:', error);
    throw error;
  }
}

// Create debug image with red outline rectangles
async function createDebugImage(originalImageBuffer: Buffer, blocks: any[], outputPath: string) {
  console.log(`🖼️ [DEBUG IMAGE] Creating ${path.basename(outputPath)}...`);
  
  try {
    let debugImage = sharp(originalImageBuffer);
    
    // Create overlays for each block
    const overlays: Array<{ input: Buffer; left: number; top: number }> = [];
    
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
async function runTwoPassAlgoTest() {
  console.log('🎯 [TEST] Two-Pass Algorithm Test - Real Production Implementation');
  console.log('=' .repeat(60));
  
  try {
    await ensureOutputDir();
    
    // Load Google Vision blocks and convert to VisionResult format
    const visionResult = await loadGoogleVisionBlocks();
    
    // Load test image for processing
    const { imageBuffer } = await loadTestImage();
    
    // Call the REAL production implementation
    console.log('🔍 [REAL IMPLEMENTATION] Calling OptimizedOCRService.processWithExistingVisionResults...');
    console.log('🔍 [DEBUG] VisionResult structure:', {
      passACount: visionResult.passA?.length || 0,
      passBCount: visionResult.passB?.length || 0,
      passCCount: visionResult.passC?.length || 0,
      allBlocksCount: visionResult.allBlocks?.length || 0,
      passATextLength: visionResult.passAText?.length || 0
    });
    
    const startTime = Date.now();
    // Use the real implementation with production data
    // Call clusterAndSortBlocks directly with the production data
    const mathBlocks = (visionResult as any).mathBlocks || [];
    console.log(`📊 [MATH] Using ${mathBlocks.length} math blocks from production data`);
    
    const finalBlocks = await OptimizedOCRService.clusterAndSortBlocks(
      visionResult.allBlocks,
      mathBlocks
    );
    
    // Create result in expected format
    const result = {
      text: visionResult.passAText,
      boundingBoxes: finalBlocks,
      confidence: 0.95,
      dimensions: { width: 3024, height: 4032 },
      symbols: [],
      mathBlocks: mathBlocks,
      processingTime: Date.now() - startTime,
      rawResponse: null,
      usage: { mathpixCalls: mathBlocks.length }
    };
    const processingTime = Date.now() - startTime;
    
    console.log(`✅ [REAL IMPLEMENTATION] Completed in ${processingTime}ms`);
    console.log(`📊 [OUTPUT] Processed to ${result.boundingBoxes.length} final student work steps`);
    
    // Convert result to the format expected by debug image
    const debugBlocks = result.boundingBoxes.map((block, index) => ({
      text: block.text,
      boundingBox: block,
      source: 'real_production',
      confidence: 0.95,
      stepIndex: index + 1
    }));
    
    // Save result in the new format
    await saveTwoPassResult(result.boundingBoxes);
    
    // Create debug image
    const outputDir = TEST_CONFIG.outputDir;
    await createDebugImage(
      imageBuffer, 
      debugBlocks, 
      path.join(outputDir, 'two-pass-algo-blocks.png')
    );
    
    // Show final student work steps content
    console.log('\n📝 [FINAL STUDENT WORK STEPS]:');
    result.boundingBoxes.forEach((block, index) => {
      const text = block.text || '';
      const words = text.trim().split(/\s+/);
      const trimmedText = words.length > 20 ? words.slice(0, 20).join(' ') + '...' : text;
      console.log(`  Step ${index + 1}: "${trimmedText}"`);
    });
    
    console.log('\n📁 [FILES CREATED]:');
    console.log(`  - ${TEST_CONFIG.outputJsonPath} (Real production output JSON)`);
    console.log(`  - ${path.join(outputDir, 'two-pass-algo-blocks.png')} (Visual debug image)`);
    
    console.log('\n✅ [TEST COMPLETED] Real production implementation test finished!');
    
  } catch (error) {
    console.error('❌ [TEST FAILED]:', error);
    process.exit(1);
  }
}

// Run the test
if (import.meta.url === `file://${process.argv[1]}`) {
  runTwoPassAlgoTest();
}
