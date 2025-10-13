import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { ClassificationService } from '../services/ai/ClassificationService.js';
import { OptimizedOCRService } from '../services/ai/OptimizedOCRService.js';

// Load environment variables
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Set Google Cloud authentication
const credentialsPath = path.resolve(process.cwd(), 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');
process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;

async function testSameImagePipeline() {
  console.log('🎯 [TEST] Same Image Pipeline Test - IMG_1596.jpg');
  console.log('==================================================');
  
  try {
    // Use the EXACT same image as production
    const imagePath = 'scripts/IMG_1596.jpg';
    const imageBuffer = await fs.readFile(imagePath);
    
    console.log('📸 [LOADING] Using IMG_1596.jpg (same as production)...');
    
    // Get image metadata
    const metadata = await sharp(imageBuffer).metadata();
    console.log(`📊 [IMAGE INFO] Size: ${metadata.width}x${metadata.height}, Format: ${metadata.format}`);
    console.log(`📊 [IMAGE INFO] EXIF Orientation: ${metadata.orientation || 'none'}`);
    
    // Step 1: Image Processing (EXACT same as production)
    console.log('[1/7] Image Processing...');
    const { ImageUtils } = await import('../services/ai/ImageUtils.js');
    
    // Convert to base64 data URL (same format as production receives)
    const base64Data = imageBuffer.toString('base64');
    const imageData = `data:image/jpeg;base64,${base64Data}`;
    
    const enhancedImageData = await ImageUtils.compressImage(imageData);
    console.log(`📊 [IMAGE PROCESSING] Enhanced image size: ${enhancedImageData.length} bytes`);
    
    // Step 2: Text Extraction & Mode Detection (EXACT same as production)
    console.log('[2/7] Text Extraction & Mode Detection...');
    const textAnalysisResult = await ClassificationService.extractTextAndAnalyze(
      enhancedImageData
    );
    
    console.log(`📊 [TEXT ANALYSIS] Google Vision detected ${textAnalysisResult.visionResult.allBlocks.length} blocks`);
    console.log(`📊 [TEXT ANALYSIS] Mode: ${textAnalysisResult.textAnalysis.mode}`);
    console.log(`📊 [TEXT ANALYSIS] Question text length: ${textAnalysisResult.textAnalysis.questionText.length}`);
    
    // Show first few blocks from real processing
    console.log('🔍 [REAL BLOCKS] First 3 blocks from real processing:');
    textAnalysisResult.visionResult.allBlocks.slice(0, 3).forEach((block, index) => {
      console.log(`  Block ${index}:`, {
        text: block.text,
        boundingBox: block.boundingBox
      });
    });
    
    // Step 3: Enhanced Text Processing (EXACT same as production)
    console.log('[3/7] Enhanced Text Processing...');
    const ocrResult = await OptimizedOCRService.processWithExistingVisionResults(
      textAnalysisResult.visionResult,
      imageBuffer,
      false,
      textAnalysisResult.textAnalysis.questionText
    );
    
    console.log(`📊 [OCR RESULT] Final steps: ${ocrResult.boundingBoxes.length}`);
    console.log(`📊 [OCR RESULT] Mathpix calls: ${ocrResult.usage?.mathpixCalls || 0}`);
    
    // Show the steps
    console.log('\n📝 [FINAL STUDENT WORK STEPS]:');
    ocrResult.boundingBoxes.forEach((block, index) => {
      const text = block.text || '';
      const words = text.trim().split(/\s+/);
      const trimmedText = words.length > 20 ? words.slice(0, 20).join(' ') + '...' : text;
      console.log(`  Step ${index + 1}: "${trimmedText}"`);
    });
    
    console.log('\n✅ [TEST COMPLETED] Same image pipeline test finished!');
    
  } catch (error) {
    console.error('❌ [TEST FAILED]:', error);
    process.exit(1);
  }
}

// Run the test
testSameImagePipeline();
