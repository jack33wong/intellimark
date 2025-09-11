import { readFileSync } from 'fs';
import { join } from 'path';
import * as dotenv from 'dotenv';
import { HybridOCRService } from '../services/hybridOCRService.js';

// Load environment variables from .env.local (same as main flow)
dotenv.config({ path: '.env.local' });

// Simulate the OLD merging logic (without line-aware merging)
function simulateOldMergingLogic(blocks: any[]): any[] {
  console.log('🔄 Simulating OLD merging logic (without line awareness)...');
  
  const finalBlocks: any[] = [];
  const processedIndices = new Set<number>();
  const IOU_THRESHOLD = 0.7;

  // Helper function to calculate IoU (same as in hybridOCRService)
  function calculateIoU(boxA: {minX: number, minY: number, width: number, height: number}, boxB: {minX: number, minY: number, width: number, height: number}): number {
    const xA = Math.max(boxA.minX, boxB.minX);
    const yA = Math.max(boxA.minY, boxB.minY);
    const xB = Math.min(boxA.minX + boxA.width, boxB.minX + boxB.width);
    const yB = Math.min(boxA.minY + boxA.height, boxB.minY + boxB.height);

    const intersectionArea = Math.max(0, xB - xA) * Math.max(0, yB - yA);
    const boxAArea = boxA.width * boxA.height;
    const boxBArea = boxB.width * boxB.height;
    
    const iou = intersectionArea / (boxAArea + boxBArea - intersectionArea);
    return isNaN(iou) ? 0 : iou;
  }

  for (let i = 0; i < blocks.length; i++) {
    if (processedIndices.has(i)) continue;

    const cluster = [blocks[i]];
    processedIndices.add(i);

    for (let j = i + 1; j < blocks.length; j++) {
      if (processedIndices.has(j)) continue;
      
      // OLD LOGIC: Only check IoU, no line awareness
      const iou = calculateIoU(blocks[i].geometry, blocks[j].geometry);
      
      if (iou > IOU_THRESHOLD) {
        console.log(`🔄 OLD MERGING: "${blocks[i].text}" + "${blocks[j].text}" (IoU: ${iou.toFixed(3)})`);
        cluster.push(blocks[j]);
        processedIndices.add(j);
      }
    }
    
    let bestBlock = cluster[0];
    for (let k = 1; k < cluster.length; k++) {
      const currentBestText = bestBlock.text || '';
      const candidateText = cluster[k].text || '';
      if (candidateText.length > currentBestText.length) {
        bestBlock = cluster[k];
      }
    }
    
    finalBlocks.push(bestBlock);
  }
  
  console.log(`✅ OLD merging complete: ${finalBlocks.length} unique blocks found`);
  return finalBlocks;
}

async function testOldMergingLogic() {
  try {
    console.log('===== Testing OLD Merging Logic (Reproducing Main Flow Issue) =====');
    
    // Load test5.png image
    const imagePath = join(process.cwd(), '..', 'testingdata', 'test5.png');
    const buffer = readFileSync(imagePath);
    const base64 = `data:image/png;base64,${buffer.toString('base64')}`;

    console.log('🔍 Image loaded, testing with OLD merging logic...');
    
    // Get the raw blocks from hybrid OCR (before merging)
    const hybridResult = await HybridOCRService.processImage(base64, {
      enablePreprocessing: true,
      mathThreshold: 0.10
    });

    console.log('✅ Hybrid OCR completed');
    console.log(`📊 Results: ${hybridResult.boundingBoxes.length} bounding boxes, ${hybridResult.mathBlocks.length} math blocks`);
    
    // Show raw bounding boxes before any processing
    console.log('\n🔍 DEBUG: Raw bounding boxes from hybrid OCR:');
    hybridResult.boundingBoxes.forEach((bbox, index) => {
      console.log(`  ${index + 1}. "${bbox.text}" [${bbox.x}, ${bbox.y}, ${bbox.width}, ${bbox.height}]`);
    });

    // Simulate the OLD merging logic that would cause the issue
    const oldMergedBlocks = simulateOldMergingLogic(hybridResult.boundingBoxes.map(bbox => ({
      text: bbox.text,
      geometry: {
        minX: bbox.x,
        minY: bbox.y,
        width: bbox.width,
        height: bbox.height
      }
    })));

    console.log('\n🔍 DEBUG: After OLD merging logic:');
    oldMergedBlocks.forEach((block, index) => {
      console.log(`  ${index + 1}. "${block.text}" [${block.geometry.minX}, ${block.geometry.minY}, ${block.geometry.width}, ${block.geometry.height}]`);
    });

    // Apply the same line splitting logic as main flow
    const splitLines: Array<{ x: number; y: number; width: number; height: number; text: string; confidence: number }> = [];
    
    for (const block of oldMergedBlocks) {
      const textLines = block.text.split('\n').filter(t => t.trim().length > 0);
      
      if (textLines.length === 1) {
        splitLines.push({
          x: block.geometry.minX,
          y: block.geometry.minY,
          width: block.geometry.width,
          height: block.geometry.height,
          text: block.text.trim(),
          confidence: 0
        });
      } else {
        const lineHeight = block.geometry.height / textLines.length;
        const avgCharWidth = block.geometry.width / block.text.length;
        
        textLines.forEach((text, index) => {
          const estimatedWidth = Math.min(block.geometry.width, text.length * avgCharWidth);
          splitLines.push({
            x: block.geometry.minX,
            y: block.geometry.minY + (index * lineHeight),
            width: estimatedWidth,
            height: lineHeight,
            text: text.trim(),
            confidence: 0
          });
        });
      }
    }

    console.log(`\n🔍 After line splitting: ${splitLines.length} individual lines`);
    
    // Check for the problematic case
    const problematicLine = splitLines.find(line => 
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
      const cEqualsMinus2 = splitLines.find(line => line.text.includes('c = -2'));
      const fiveNFormula = splitLines.find(line => line.text.includes('5n'));
      
      console.log(`✅ "c = -2" found: ${cEqualsMinus2 ? 'YES' : 'NO'}`);
      console.log(`✅ "5n" formula found: ${fiveNFormula ? 'YES' : 'NO'}`);
      
      return true;
    }
    
  } catch (error) {
    console.error('❌ Test failed with error:', error);
    return false;
  }
}

// Run the test
testOldMergingLogic().then(success => {
  process.exit(success ? 0 : 1);
});
