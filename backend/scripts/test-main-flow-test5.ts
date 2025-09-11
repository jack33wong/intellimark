import { readFileSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';
import { HybridOCRService } from '../services/hybridOCRService.js';

// Load environment variables from .env.local (same as main flow)
dotenv.config({ path: '.env.local' });

async function testMainFlowWithTest5() {
  try {
    console.log('===== Testing Full Hybrid OCR with test5.png =====');
    
    // Check environment variables
    console.log('🔍 Environment check:');
    console.log(`  - GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'SET' : 'NOT SET'}`);
    console.log(`  - MATHPIX_APP_ID: ${process.env.MATHPIX_APP_ID ? 'SET' : 'NOT SET'}`);
    console.log(`  - MATHPIX_API_KEY: ${process.env.MATHPIX_API_KEY ? 'SET' : 'NOT SET'}`);
    
    // Load test5.png image
    const imagePath = join(process.cwd(), '..', 'testingdata', 'test5.png');
    const buffer = readFileSync(imagePath);
    const base64 = `data:image/png;base64,${buffer.toString('base64')}`;

    console.log('🔍 Image loaded, testing FULL hybrid OCR...');
    
    // Test hybrid OCR (same as main flow)
    const hybridResult = await HybridOCRService.processImage(base64, {
      enablePreprocessing: true,
      mathThreshold: 0.10
    });

    console.log('✅ Hybrid OCR completed');
    console.log(`📊 Results: ${hybridResult.boundingBoxes.length} bounding boxes, ${hybridResult.mathBlocks.length} math blocks`);
    console.log(`📝 Text length: ${hybridResult.text.length} characters`);
    
    // Show Mathpix processing results
    if (hybridResult.mathBlocks.length > 0) {
      console.log('\n🔢 Mathpix processing results:');
      hybridResult.mathBlocks.forEach((block, index) => {
        console.log(`  Math Block ${index + 1}:`);
        console.log(`    - Google Vision text: "${block.googleVisionText}"`);
        console.log(`    - Mathpix LaTeX: "${block.mathpixLatex || 'Not processed'}"`);
        console.log(`    - Confidence: ${block.confidence}`);
        console.log(`    - Math likeness score: ${block.mathLikenessScore}`);
        console.log(`    - Coordinates: [${block.coordinates.x}, ${block.coordinates.y}, ${block.coordinates.width}, ${block.coordinates.height}]`);
      });
    } else {
      console.log('⚠️ No math blocks detected for Mathpix processing');
    }

    // Process bounding boxes (same as main flow)
    const boundingBoxes = Array.isArray(hybridResult.boundingBoxes) ? hybridResult.boundingBoxes as any[] : [];
    
    // Debug: Show raw bounding boxes before processing
    console.log('\n🔍 DEBUG: Raw bounding boxes from hybrid OCR:');
    boundingBoxes.forEach((bbox, index) => {
      console.log(`  ${index + 1}. "${bbox.text}" [${bbox.x}, ${bbox.y}, ${bbox.width}, ${bbox.height}]`);
    });
    
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
      
      if (textLines.length === 1) {
        splitLines.push(line);
      } else {
        const lineHeight = line.height / textLines.length;
        const avgCharWidth = line.width / line.text.length;
        
        textLines.forEach((text, index) => {
          const estimatedWidth = Math.min(line.width, text.length * avgCharWidth);
          splitLines.push({
            x: line.x,
            y: line.y + (index * lineHeight),
            width: estimatedWidth,
            height: lineHeight,
            text: text.trim(),
            confidence: line.confidence
          });
        });
      }
    }

    console.log(`🔍 After splitting: ${splitLines.length} individual lines`);
    
    // Test assertions
    console.log('\n🧪 Running assertions...');
    
    // Check for valid bounding box data
    const hasValidBboxes = splitLines.length > 0 && splitLines.every(line => 
      !isNaN(line.x) && !isNaN(line.y) && 
      !isNaN(line.width) && !isNaN(line.height) &&
      line.width > 0 && line.height > 0
    );
    
    console.log(`✅ Valid bounding boxes: ${hasValidBboxes ? 'PASS' : 'FAIL'}`);
    console.log(`   - Found ${splitLines.length} lines with valid coordinates`);
    
    // Check for specific text lines (with flexible character matching)
    const cEqualsMinus2 = splitLines.find(line => 
      line.text.includes('c = -2') || 
      line.text.includes('c = −2') ||
      line.text.includes('c=-2')
    );
    const fiveNFormula = splitLines.find(line => 
      line.text.includes('5n ^ ( 2 ) + 2n - 2') ||
      line.text.includes('5nˆ ( 2 ) + 2n − 2') ||
      line.text.includes('5n^ ( 2 ) + 2n - 2') ||
      line.text.includes('5nˆ( 2 ) + 2n − 2') ||
      line.text.includes('5n^2 + 2n - 2') ||
      line.text.includes('5nˆ2 + 2n − 2')
    );
    
    console.log(`✅ Contains "c = -2": ${cEqualsMinus2 ? 'PASS' : 'FAIL'}`);
    if (cEqualsMinus2) {
      console.log(`   - Found in line: "${cEqualsMinus2.text}"`);
      console.log(`   - Bbox: [${cEqualsMinus2.x}, ${cEqualsMinus2.y}, ${cEqualsMinus2.width}, ${cEqualsMinus2.height}]`);
    }
    
    console.log(`✅ Contains "5n ^ ( 2 ) + 2n - 2": ${fiveNFormula ? 'PASS' : 'FAIL'}`);
    if (fiveNFormula) {
      console.log(`   - Found in line: "${fiveNFormula.text}"`);
      console.log(`   - Bbox: [${fiveNFormula.x}, ${fiveNFormula.y}, ${fiveNFormula.width}, ${fiveNFormula.height}]`);
    }
    
    // Check for Mathpix LaTeX processing
    const hasMathpixLaTeX = hybridResult.mathBlocks.some(block => block.mathpixLatex && block.mathpixLatex.length > 0);
    console.log(`✅ Mathpix LaTeX processing: ${hasMathpixLaTeX ? 'PASS' : 'FAIL'}`);
    if (hasMathpixLaTeX) {
      const latexBlocks = hybridResult.mathBlocks.filter(block => block.mathpixLatex && block.mathpixLatex.length > 0);
      console.log(`   - ${latexBlocks.length} math blocks processed with LaTeX`);
      latexBlocks.forEach((block, index) => {
        console.log(`   - Block ${index + 1} LaTeX: "${block.mathpixLatex}"`);
      });
    } else {
      console.log('   - No LaTeX output from Mathpix');
    }
    
    // Show all detected lines for debugging
    console.log('\n📋 All detected lines:');
    splitLines.forEach((line, index) => {
      console.log(`  ${index + 1}. "${line.text}" [${line.x}, ${line.y}, ${line.width}, ${line.height}]`);
    });
    
    // Overall test result
    const allTestsPassed = hasValidBboxes && cEqualsMinus2 && fiveNFormula && hasMathpixLaTeX;
    console.log(`\n🎯 Overall test result: ${allTestsPassed ? 'PASS' : 'FAIL'}`);
    
    if (!allTestsPassed) {
      console.log('\n❌ Test failures:');
      if (!hasValidBboxes) console.log('  - No valid bounding boxes found');
      if (!cEqualsMinus2) console.log('  - "c = -2" not found in any line');
      if (!fiveNFormula) console.log('  - "5n ^ ( 2 ) + 2n - 2" not found in any line');
      if (!hasMathpixLaTeX) console.log('  - No Mathpix LaTeX processing detected');
    }
    
    return allTestsPassed;
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    return false;
  }
}

// Run the test
testMainFlowWithTest5().then(success => {
  process.exit(success ? 0 : 1);
});
