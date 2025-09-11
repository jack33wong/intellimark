import { readFileSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';

// Load environment variables from .env.local (same as main flow)
dotenv.config({ path: '.env.local' });

async function testMainFlowMerging() {
  try {
    console.log('===== Testing Main Flow Merging Logic =====');
    
    // Load test5.png image
    const imagePath = join(process.cwd(), '..', 'testingdata', 'test5.png');
    const buffer = readFileSync(imagePath);
    const base64 = `data:image/png;base64,${buffer.toString('base64')}`;

    console.log('🔍 Image loaded, testing main flow OCR processing...');
    
    // Import the HybridOCRService directly (same as main flow)
    const { HybridOCRService } = await import('../services/hybridOCRService.js');
    
    // Call the hybrid OCR service (same as main flow)
    const hybridResult = await HybridOCRService.processImage(base64, {
      enablePreprocessing: true,
      mathThreshold: 0.10
    });
    
    // Apply the same processing logic as main flow
    const boundingBoxes = Array.isArray(hybridResult.boundingBoxes) ? hybridResult.boundingBoxes as any[] : [];
    
    const lines = boundingBoxes.map(bbox => ({
      x: bbox.x || 0,
      y: bbox.y || 0, 
      width: bbox.width || 0,
      height: bbox.height || 0,
      text: (bbox.text || '').trim(),
      confidence: bbox.confidence || 0
    })).filter(bbox => {
      const isValid = !isNaN(bbox.x) && !isNaN(bbox.y) && 
        !isNaN(bbox.width) && !isNaN(bbox.height) &&
        bbox.width > 0 && bbox.height > 0;
      return isValid;
    });

    // Split multi-line blocks into individual lines (same as main flow)
    const splitLines: Array<{ x: number; y: number; width: number; height: number; text: string; confidence: number }> = [];
    
    for (const line of lines) {
      const textLines = line.text.split('\n').filter(t => t.trim().length > 0);
      
      console.log(`🔍 Processing line: "${line.text}"`);
      console.log(`   - Contains \\n: ${line.text.includes('\n')}`);
      console.log(`   - Split into ${textLines.length} lines:`, textLines);
      
      if (textLines.length === 1) {
        splitLines.push(line);
        console.log(`   - Single line, keeping as is`);
      } else {
        console.log(`   - Multi-line, splitting vertically`);
        const lineHeight = line.height / textLines.length;
        const avgCharWidth = line.width / line.text.length;
        
        textLines.forEach((text, index) => {
          const estimatedWidth = Math.min(line.width, text.length * avgCharWidth);
          const splitLine = {
            x: line.x,
            y: line.y + (index * lineHeight),
            width: estimatedWidth,
            height: lineHeight,
            text: text.trim(),
            confidence: line.confidence
          };
          console.log(`   - Split line ${index + 1}: "${text.trim()}" [${splitLine.x}, ${splitLine.y}, ${splitLine.width}, ${splitLine.height}]`);
          splitLines.push(splitLine);
        });
      }
    }
    
    const processedImage = {
      boundingBoxes: splitLines
    };
    
    console.log('✅ Main flow OCR processing completed');
    console.log(`📊 Results: ${processedImage.boundingBoxes.length} bounding boxes`);
    
    // Show all detected lines
    console.log('\n🔍 DEBUG: All detected lines from main flow:');
    processedImage.boundingBoxes.forEach((line, index) => {
      console.log(`  ${index + 1}. "${line.text}" [${line.x}, ${line.y}, ${line.width}, ${line.height}]`);
    });
    
    // Check for the problematic case
    const problematicLine = processedImage.boundingBoxes.find((line: any) => 
      line.text.includes('c = -2') && line.text.includes('5n')
    );
    
    console.log(`\n🧪 Testing for problematic merging:`);
    if (problematicLine) {
      console.log(`❌ PROBLEM FOUND: "${problematicLine.text}"`);
      console.log(`   This line contains both "c = -2" and "5n" - they were incorrectly merged!`);
      return false;
    } else {
      console.log(`✅ No problematic merging detected - lines are properly separated`);
      
      // Check if we have separate lines
      const cEqualsMinus2 = processedImage.boundingBoxes.find((line: any) => line.text.includes('c = -2'));
      const fiveNFormula = processedImage.boundingBoxes.find((line: any) => line.text.includes('5n'));
      
      console.log(`✅ "c = -2" found: ${cEqualsMinus2 ? 'YES' : 'NO'}`);
      console.log(`✅ "5n" formula found: ${fiveNFormula ? 'YES' : 'NO'}`);
      
      if (cEqualsMinus2 && fiveNFormula) {
        console.log(`✅ Both lines found separately - merging logic is working correctly!`);
      }
      
      return true;
    }
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    return false;
  }
}

// Run the test
testMainFlowMerging().then(success => {
  process.exit(success ? 0 : 1);
});
