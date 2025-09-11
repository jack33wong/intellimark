import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { HybridOCRService } from '../services/hybridOCRService.js';
import { MarkHomeworkWithAnswer } from '../services/marking/MarkHomeworkWithAnswer.js';

// Load environment variables
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

/**
 * Create verification image with bounding boxes drawn on the original image
 */
async function createVerificationImage(
  clusteredBoxes: any[],
  rawVisionBlocks: any[] | undefined,
  originalImagePath: string,
  outputImagePath: string
) {
  console.log('\n🎨 Creating verification image with bounding boxes...');
  try {
    const image = sharp(originalImagePath);
    const metadata = await image.metadata();
    const imageWidth = metadata.width || 856;
    const imageHeight = metadata.height || 1258;

    // Draw raw Vision boxes first (blue, lighter stroke)
    const rawElements = (rawVisionBlocks || []).map((block: any, index: number) => {
      const { minX, minY } = block.geometry || {};
      const width = (block.geometry?.width) || 0;
      const height = (block.geometry?.height) || 0;
      const x = minX || 0;
      const y = minY || 0;
      const color = 'blue';
      const rect = `<rect x="${x}" y="${y}" width="${width}" height="${height}" style="fill:rgba(0,0,255,0.06);stroke:${color};stroke-width:1" />`;
      return rect;
    }).join('');

    // Draw clustered (final) boxes (red, thicker stroke with labels)
    const clusteredElements = clusteredBoxes.map((block, index) => {
      const { x, y, width, height } = block;
      const blockIndex = index + 1;
      const color = 'red';
      const rect = `<rect x="${x}" y="${y}" width="${width}" height="${height}" style="fill:rgba(255,0,0,0.12);stroke:${color};stroke-width:2" />`;
      const text = `<text x="${x + 5}" y="${y + 18}" font-family="Arial" font-size="14" fill="${color}" font-weight="bold">${blockIndex}</text>`;
      return rect + text;
    }).join('');

    const legend = `
      <rect x="10" y="10" width="14" height="14" style="fill:rgba(0,0,255,0.06);stroke:blue;stroke-width:1" />
      <text x="30" y="22" font-family="Arial" font-size="14" fill="blue">Raw Vision</text>
      <rect x="120" y="10" width="14" height="14" style="fill:rgba(255,0,0,0.12);stroke:red;stroke-width:2" />
      <text x="140" y="22" font-family="Arial" font-size="14" fill="red">Clustered</text>
    `;

    const svgElements = rawElements + clusteredElements + legend;

    const svgOverlay = `<svg width="${imageWidth}" height="${imageHeight}">${svgElements}</svg>`;
    const svgBuffer = Buffer.from(svgOverlay);

    await image.composite([{ input: svgBuffer, top: 0, left: 0 }]).toFile(outputImagePath);
    console.log(`✅ Verification image saved to: ${outputImagePath}`);
  } catch (error) {
    console.error('❌ Failed to create verification image:', error);
  }
}

async function testHybridOCRWithTest3() {
  try {
    console.log('🧪 Testing Hybrid OCR with test3.png...');
    
    // Check environment variables
    console.log('🔍 Environment check:');
    console.log('  GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS ? 'SET' : 'NOT SET');
    console.log('  MATHPIX_APP_ID:', process.env.MATHPIX_APP_ID ? 'SET' : 'NOT SET');
    console.log('  MATHPIX_API_KEY:', process.env.MATHPIX_API_KEY ? 'SET' : 'NOT SET');
    
    // Check service availability
    const status = HybridOCRService.getServiceStatus();
    console.log('🔍 Service status:', status);
    
    if (!status.hybrid) {
      console.log('❌ Hybrid OCR not available. Check credentials.');
      return;
    }
    
    // Read test3.png
    const imagePath = path.join(process.cwd(), '..', 'testingdata', 'test3.png');
    console.log('📁 Reading image from:', imagePath);
    
    if (!fs.existsSync(imagePath)) {
      console.log('❌ Image file not found:', imagePath);
      return;
    }
    
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Data = `data:image/png;base64,${imageBuffer.toString('base64')}`;
    
    console.log('🖼️ Image loaded, size:', imageBuffer.length, 'bytes');
    
    // Process with main flow service (includes proper sorting)
    console.log('🔄 Processing with main flow service...');
    const startTime = Date.now();
    
    // Optional DBSCAN tuning via env
    const dbscanEpsPx = process.env.DBSCAN_EPS ? Number(process.env.DBSCAN_EPS) : undefined;
    const dbscanMinPts = process.env.DBSCAN_MINPTS ? Number(process.env.DBSCAN_MINPTS) : undefined;
    
    const result = await MarkHomeworkWithAnswer.getHybridOCRResult(base64Data, {
      ...(dbscanEpsPx ? { dbscanEpsPx } : {}),
      ...(dbscanMinPts ? { dbscanMinPts } : {})
    });
    
    const processingTime = Date.now() - startTime;
    console.log(`⏱️ Processing completed in ${processingTime}ms`);
    
    // Extract data from main flow result
    const sortedBoundingBoxes = result.boundingBoxes.sort((a, b) => a.y - b.y);
    const sortedMathBlocks = result.mathBlocks; // Already sorted by main flow service
    
    // Print final JSON result
    console.log('\n📊 FINAL HYBRID OCR RESULT:');
    console.log('=' .repeat(50));
    
    const finalResult = {
      text: result.text,
      boundingBoxes: sortedBoundingBoxes,
      confidence: result.confidence,
      dimensions: result.dimensions,
      symbols: result.symbols,
      mathBlocks: sortedMathBlocks.map(block => ({
        googleVisionText: block.googleVisionText,
        mathpixLatex: block.mathpixLatex,
        confidence: block.confidence,
        mathLikenessScore: block.mathLikenessScore,
        coordinates: block.coordinates
      })),
      processingTime: result.processingTime,
      summary: {
        totalBlocks: result.boundingBoxes.length,
        totalMathBlocks: result.mathBlocks.length,
        averageConfidence: result.confidence,
        textLength: result.text.length
      }
    };
    
    console.log(JSON.stringify(finalResult, null, 2));

    // Extract raw vision detected blocks if available (pre-cluster)
    const rawVisionBlocks = (result as any)?.rawResponse?.detectedBlocks || [];
    console.log(`\n📌 Raw Vision blocks (pre-cluster): ${rawVisionBlocks.length}`);
    
    console.log('\n📋 SUMMARY:');
    console.log(`  Total text blocks: ${finalResult.summary.totalBlocks}`);
    console.log(`  Total math blocks: ${finalResult.summary.totalMathBlocks}`);
    console.log(`  Average confidence: ${finalResult.summary.averageConfidence.toFixed(3)}`);
    console.log(`  Text length: ${finalResult.summary.textLength} characters`);
    console.log(`  Processing time: ${processingTime}ms`);
    
    // Print merged clusters (post-DBSCAN + overlap-merge)
    console.log('\n🔗 MERGED CLUSTERS (post-DBSCAN + overlap-merge):');
    sortedBoundingBoxes.forEach((block, index) => {
      const preview = (block.text || '').replace(/\s+/g, ' ').trim();
      const trimmed = preview.length > 120 ? preview.slice(0, 117) + '...' : preview;
      console.log(`  ${index + 1}. bbox: [${block.x}, ${block.y}, ${block.width}, ${block.height}]`);
      console.log(`     text: "${trimmed}"`);
    });

    // Print math detection filtering results
    console.log('\n🧮 MATH DETECTION FILTERING:');
    console.log(`  Total clusters: ${sortedBoundingBoxes.length}`);
    console.log(`  Math blocks detected: ${finalResult.summary.totalMathBlocks}`);
    console.log(`  Filtered out: ${sortedBoundingBoxes.length - finalResult.summary.totalMathBlocks} clusters`);
    
    // Show which clusters passed/failed math detection
    if (finalResult.rawResponse?.detectedBlocks) {
      const mathBlocks = finalResult.mathBlocks || [];
      const mathBlockCoords = new Set(mathBlocks.map(mb => `${mb.coordinates.x},${mb.coordinates.y}`));
      
      console.log('\n📊 CLUSTER FILTERING BREAKDOWN:');
      sortedBoundingBoxes.forEach((block, index) => {
        const coordKey = `${block.x},${block.y}`;
        const isMathBlock = mathBlockCoords.has(coordKey);
        const status = isMathBlock ? '✅ MATH' : '❌ FILTERED';
        const preview = (block.text || '').replace(/\s+/g, ' ').trim().slice(0, 50);
        console.log(`  ${index + 1}. ${status} | "${preview}${preview.length >= 50 ? '...' : ''}"`);
      });
    }

    console.log('\n🔍 Sorted lines by y-coordinate (top to bottom)');
    console.log('🔍 First few sorted lines:', sortedBoundingBoxes.slice(0, 5).map(l => `"${l.text}" at y=${l.y}`));
    
    // Print detected text lines
    console.log('\n📝 DETECTED TEXT LINES (sorted by y-coordinate):');
    sortedBoundingBoxes.forEach((block, index) => {
      console.log(`  ${index + 1}. "${block.text}" (conf: ${block.confidence.toFixed(3)}, bbox: [${block.x}, ${block.y}, ${block.width}, ${block.height}])`);
    });
    
    // Print math blocks if any (sorted by y-coordinate)
    if (sortedMathBlocks.length > 0) {
      console.log('\n🔢 MATH BLOCKS (sorted by y-coordinate):');
      sortedMathBlocks.forEach((block, index) => {
        console.log(`  ${index + 1}. Vision: "${block.googleVisionText}"`);
        console.log(`     LaTeX: "${block.mathpixLatex || 'N/A'}"`);
        console.log(`     Confidence: ${block.confidence.toFixed(3)}`);
        console.log(`     Coordinates: [${block.coordinates.x}, ${block.coordinates.y}, ${block.coordinates.width}, ${block.coordinates.height}]`);
      });
    }
    
    // Create verification image with both raw (blue) and clustered (red)
    const outputImagePath = path.join(process.cwd(), 'scripts', 'test3-verification-overlay.png');
    await createVerificationImage(sortedBoundingBoxes, rawVisionBlocks, imagePath, outputImagePath);
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    if (error instanceof Error) {
      console.error('   Error message:', error.message);
      console.error('   Stack trace:', error.stack);
    }
  }
}

// Run the test
testHybridOCRWithTest3();
