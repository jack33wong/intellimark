#!/usr/bin/env tsx

import { GoogleVisionService } from '../services/googleVisionService';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Test script for Google Vision API
 * Usage: tsx scripts/test-google-vision.ts [image-path]
 */
async function testGoogleVision() {
  // Get the file path from command-line arguments, or use the default test image
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const fileName = process.argv[2] || path.join(__dirname, '../tests/test4.png');
  
  console.log('🔍 Google Vision API Test');
  console.log('========================');
  console.log(`Testing with image: ${fileName}`);
  console.log('');

  try {
    const visionService = new GoogleVisionService();

    // Test handwriting recognition
    console.log('📝 Testing handwriting recognition...');
    const handwritingResult = await visionService.recognizeHandwriting(fileName);
    
    if (handwritingResult) {
      console.log('✅ Handwriting recognition successful!');
      console.log('Detected text:', handwritingResult);
    } else {
      console.log('⚠️ No handwriting detected');
    }
    
    console.log('');

    // Test general text recognition
    console.log('📄 Testing general text recognition...');
    const textResult = await visionService.recognizeText(fileName);
    
    if (textResult) {
      console.log('✅ Text recognition successful!');
      console.log('Detected text:', textResult);
    } else {
      console.log('⚠️ No text detected');
    }
    
    console.log('');

    // Test detailed annotations
    console.log('🔍 Testing detailed annotations...');
    const detailedResult = await visionService.getDetailedTextAnnotations(fileName);
    
    if (detailedResult) {
      console.log('✅ Detailed annotations retrieved!');
      console.log('Full Text:', detailedResult.fullText);
      console.log('Number of pages:', detailedResult.pages.length);
      console.log('Number of blocks:', detailedResult.blocks.length);
      console.log('Number of paragraphs:', detailedResult.paragraphs.length);
      console.log('Number of words:', detailedResult.words.length);
      console.log('Number of symbols:', detailedResult.symbols.length);
      
      console.log('\n📋 DETAILED JSON OUTPUT:');
      console.log('========================');
      console.log(JSON.stringify(detailedResult, null, 2));
    } else {
      console.log('⚠️ No detailed annotations available');
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testGoogleVision().catch(console.error);
