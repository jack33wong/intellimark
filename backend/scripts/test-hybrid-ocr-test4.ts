import { readFileSync } from 'fs';
import { join } from 'path';
import { HybridOCRService } from '../services/hybridOCRService';

async function main() {
  try {
    const imagePath = join(process.cwd(), '..', 'testingdata', 'test4.png');
    const buffer = readFileSync(imagePath);
    const base64 = `data:image/png;base64,${buffer.toString('base64')}`;

    console.log('===== Hybrid OCR Test: test4.png =====');
    const result = await HybridOCRService.processImage(base64, {
      enablePreprocessing: true,
      mathThreshold: 0.10
    });

    console.log('Text length:', result.text.length);
    console.log('Bounding boxes:', result.boundingBoxes.length);
    console.log('Math blocks:', result.mathBlocks.length);
    console.log('Confidence:', result.confidence);
    console.log('Dimensions:', result.dimensions);

    result.mathBlocks.slice(0, 5).forEach((b, i) => {
      console.log(`Block ${i + 1}:`, {
        text: b.googleVisionText?.slice(0, 80),
        latex: b.mathpixLatex?.slice(0, 80),
        score: b.mathLikenessScore,
        bbox: b.coordinates
      });
    });

    console.log('Processing time (ms):', result.processingTime);
  } catch (err) {
    console.error('Hybrid OCR test failed:', err);
    process.exit(1);
  }
}

main();
