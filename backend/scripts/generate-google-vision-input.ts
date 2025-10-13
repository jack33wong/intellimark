import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { ClassificationService } from '../services/ai/ClassificationService.js';

// Load environment variables from .env.local
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Set Google Cloud authentication
const credentialsPath = path.resolve(process.cwd(), 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');
process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;

// Test configuration
const TEST_CONFIG = {
  imagePath: 'scripts/IMG_1596.jpg',
  outputJsonPath: 'debug-images/google-vision-3pass-input.json'
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

// Generate Google Vision 3-pass output JSON (exact same format as Google Vision API)
async function generateGoogleVisionInput() {
  console.log('🎯 [GENERATE] Creating Google Vision 3-pass output JSON');
  console.log('=' .repeat(70));
  
  try {
    // Load test image
    const { imageData } = await loadTestImage();
    
    // Step 2: Get Google Vision 3-pass output
    console.log('🔍 [STEP 2] Google Vision 3-pass extraction...');
    const step2Result = await ClassificationService.extractTextAndAnalyze(
      imageData,
      'gemini-2.5-flash'
    );
    
    // Get all blocks from Google Vision 3-pass (passA + passB + passC)
    const allBlocks = step2Result.visionResult.allBlocks;
    console.log(`✅ [STEP 2] Google Vision 3-pass blocks: ${allBlocks.length}`);
    
    // Create the exact same format as Google Vision 3-pass output
    // Format: { text, boundingBox: {x, y, width, height}, source, confidence }
    const googleVisionOutput = allBlocks.map((block, index) => ({
      index: index + 1,
      text: block.text || '',
      boundingBox: {
        x: block.boundingBox.x,
        y: block.boundingBox.y,
        width: block.boundingBox.width,
        height: block.boundingBox.height
      },
      source: block.source || 'google_vision_3pass',
      confidence: block.confidence || 0.9
    }));
    
    // Save to JSON file
    const jsonData = JSON.stringify(googleVisionOutput, null, 2);
    await fs.writeFile(TEST_CONFIG.outputJsonPath, jsonData, 'utf-8');
    
    console.log(`✅ [GENERATE] Created Google Vision 3-pass output JSON with ${googleVisionOutput.length} blocks`);
    console.log(`📁 [FILE] ${TEST_CONFIG.outputJsonPath}`);
    
    // Show sample blocks
    console.log('\n📝 [SAMPLE BLOCKS]:');
    googleVisionOutput.slice(0, 5).forEach((block, index) => {
      const text = block.text || '';
      const words = text.trim().split(/\s+/);
      const trimmedText = words.length > 15 ? words.slice(0, 15).join(' ') + '...' : text;
      console.log(`  Block ${index + 1}: "${trimmedText}"`);
    });
    
    console.log('\n✅ [GENERATE COMPLETED] Google Vision 3-pass output JSON created!');
    console.log('💡 [NEXT STEP] Run: npx tsx scripts/test-two-pass-algo.ts');
    
  } catch (error) {
    console.error('❌ [GENERATE FAILED]:', error);
    process.exit(1);
  }
}

// Run the generator
if (import.meta.url === `file://${process.argv[1]}`) {
  generateGoogleVisionInput();
}
