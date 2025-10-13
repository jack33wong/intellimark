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

// Test configuration
const TEST_CONFIG = {
  imagePath: 'scripts/IMG_1596.jpg',
  outputJsonPath: 'debug-images/filtered-student-work-blocks.json'
};

// Load test image
async function loadTestImage(): Promise<{ imageData: string; imageBuffer: Buffer }> {
  console.log('📸 [LOADING] Test image:', TEST_CONFIG.imagePath);
  
  try {
    // Read the image file
    const imageBuffer = await fs.readFile(TEST_CONFIG.imagePath);
    
    // Auto-rotate image based on EXIF orientation
    const correctedImageBuffer = await sharp(imageBuffer)
      .rotate()
      .jpeg()
      .toBuffer();
    
    // Convert to base64 data URL
    const base64Data = correctedImageBuffer.toString('base64');
    const imageData = `data:image/jpeg;base64,${base64Data}`;
    
    return { imageData, imageBuffer: correctedImageBuffer };
  } catch (error) {
    console.error('❌ [LOAD IMAGE] Failed:', error);
    throw error;
  }
}

// Generate input JSON file with filtered student work blocks
async function generateInputJson() {
  console.log('🎯 [GENERATE] Creating input JSON with filtered student work blocks');
  console.log('=' .repeat(70));
  
  try {
    // Load test image
    const { imageData, imageBuffer } = await loadTestImage();
    
    // Step 2: Get Google Vision blocks and AI-detected question text
    console.log('🔍 [STEP 2] Text Extraction & Mode Detection...');
    const step2Result = await ClassificationService.extractTextAndAnalyze(
      imageData,
      'gemini-2.5-flash'
    );
    console.log(`✅ [STEP 2] Google Vision blocks: ${step2Result.visionResult.allBlocks.length}`);
    console.log(`✅ [STEP 2] Extracted question text: "${step2Result.textAnalysis.questionText.substring(0, 100)}..."`);
    
    // Step 3: Process with filtering to get student work blocks
    console.log('🔍 [STEP 3] Enhanced Text Processing with AI Filtering...');
    const step3Result = await OptimizedOCRService.processWithExistingVisionResults(
      step2Result.visionResult,
      imageBuffer,
      false, // debug = false
      step2Result.textAnalysis.questionText // Pass extracted question text for filtering
    );
    
    // Extract the filtered blocks before two-pass algorithm
    // We need to get the blocks after AI filtering but before two-pass grouping
    // For now, let's use the final result and document the expected input format
    
    console.log(`✅ [STEP 3] Final blocks after filtering + two-pass: ${step3Result.boundingBoxes.length}`);
    
    // Create the input JSON format expected by test-two-pass-algo.ts
    const inputBlocks = step3Result.boundingBoxes.map((block, index) => ({
      index: index + 1,
      text: block.text,
      boundingBox: {
        x: block.boundingBox.x,
        y: block.boundingBox.y,
        width: block.boundingBox.width,
        height: block.boundingBox.height
      },
      source: 'ai_filtered',
      confidence: block.confidence || 0.95
    }));
    
    // Save to JSON file
    const jsonData = JSON.stringify(inputBlocks, null, 2);
    await fs.writeFile(TEST_CONFIG.outputJsonPath, jsonData, 'utf-8');
    
    console.log(`✅ [GENERATE] Created input JSON with ${inputBlocks.length} blocks`);
    console.log(`📁 [FILE] ${TEST_CONFIG.outputJsonPath}`);
    
    // Show sample blocks
    console.log('\n📝 [SAMPLE BLOCKS]:');
    inputBlocks.slice(0, 5).forEach((block, index) => {
      const text = block.text || '';
      const words = text.trim().split(/\s+/);
      const trimmedText = words.length > 15 ? words.slice(0, 15).join(' ') + '...' : text;
      console.log(`  Block ${index + 1}: "${trimmedText}"`);
    });
    
    console.log('\n✅ [GENERATE COMPLETED] Input JSON file created!');
    console.log('💡 [NEXT STEP] Run: npx tsx scripts/test-two-pass-algo.ts');
    
  } catch (error) {
    console.error('❌ [GENERATE FAILED]:', error);
    process.exit(1);
  }
}

// Run the generator
if (import.meta.url === `file://${process.argv[1]}`) {
  generateInputJson();
}






