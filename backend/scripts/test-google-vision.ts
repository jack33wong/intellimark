#!/usr/bin/env tsx

import { GoogleVisionService } from '../services/googleVisionService.js';
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
  

  try {
    const visionService = new GoogleVisionService();

    // Test handwriting recognition
    const handwritingResult = await visionService.recognizeHandwriting(fileName);
    
    if (handwritingResult) {
    } else {
    }
    

    // Test general text recognition
    const textResult = await visionService.recognizeText(fileName);
    
    if (textResult) {
    } else {
    }
    

    // Test detailed annotations
    const detailedResult = await visionService.getDetailedTextAnnotations(fileName);
    
    if (detailedResult) {
      
    } else {
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testGoogleVision().catch(console.error);
