import fs from 'fs/promises';
import path from 'path';
import { ClassificationService } from '../services/ai/ClassificationService.js';
import { OptimizedOCRService } from '../services/ai/OptimizedOCRService.js';

// Load environment variables
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

// Set Google Cloud authentication
const credentialsPath = path.resolve(process.cwd(), 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');
process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;

async function testRealProductionData() {
  console.log('🎯 [TEST] Real Production Data Test');
  console.log('===================================');
  
  try {
    // Use the same image that production is processing
    const imagePath = 'scripts/IMG_1596.jpg';
    const imageBuffer = await fs.readFile(imagePath);
    
    console.log('📸 [LOADING] Using same image as production...');
    
    // Step 1: Image Processing (same as production)
    console.log('[1/7] Image Processing...');
    const { ImageUtils } = await import('../services/ai/ImageUtils.js');
    const imageProcessingResult = await ImageUtils.compressImage(imageBuffer);
    
    // Step 2: Text Extraction & Mode Detection (same as production)
    console.log('[2/7] Text Extraction & Mode Detection...');
    const textAnalysisResult = await ClassificationService.extractTextAndAnalyze(
      imageProcessingResult.enhancedImageData
    );
    
    console.log(`📊 [PRODUCTION DATA] Google Vision detected ${textAnalysisResult.visionResult.allBlocks.length} blocks`);
    console.log(`📊 [PRODUCTION DATA] Filtered to ${textAnalysisResult.visionResult.allBlocks.length} student work blocks`);
    
    // Step 3: Enhanced Text Processing (same as production)
    console.log('[3/7] Enhanced Text Processing...');
    const ocrResult = await OptimizedOCRService.processWithExistingVisionResults(
      textAnalysisResult.visionResult,
      imageBuffer,
      false,
      textAnalysisResult.textAnalysis.questionText
    );
    
    console.log(`📊 [PRODUCTION RESULT] Final steps: ${ocrResult.boundingBoxes.length}`);
    
    // Show the steps
    console.log('\n📝 [PRODUCTION STUDENT WORK STEPS]:');
    ocrResult.boundingBoxes.forEach((block, index) => {
      const text = block.text || '';
      const words = text.trim().split(/\s+/);
      const trimmedText = words.length > 20 ? words.slice(0, 20).join(' ') + '...' : text;
      console.log(`  Step ${index + 1}: "${trimmedText}"`);
    });
    
    console.log('\n✅ [TEST COMPLETED] Real production data test finished!');
    
  } catch (error) {
    console.error('❌ [TEST FAILED]:', error);
    process.exit(1);
  }
}

// Run the test
testRealProductionData();






