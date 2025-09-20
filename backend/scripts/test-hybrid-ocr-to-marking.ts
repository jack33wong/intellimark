import fs from 'fs';
import path from 'path';
import * as dotenv from 'dotenv';
import { HybridOCRService } from '../services/hybridOCRService.js';

// Load env
dotenv.config({ path: '.env.local' });

async function run() {
  try {

    // Read test image
    const imagePath = path.join(process.cwd(), '..', 'testingdata', 'test3.png');
    if (!fs.existsSync(imagePath)) {
      console.error('❌ Image not found:', imagePath);
      process.exit(1);
    }
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Data = `data:image/png;base64,${imageBuffer.toString('base64')}`;

    // 1) Run Hybrid OCR (same service used by main flow)
    const start = Date.now();
    const ocr = await HybridOCRService.processImage(base64Data, {
      enablePreprocessing: true,
      mathThreshold: 0.10,
    });
    const ms = Date.now() - start;

    // Build processedImage compatible with LLMOrchestrator
    const sortedMathBlocks = [...ocr.mathBlocks].sort((a, b) => a.coordinates.y - b.coordinates.y);

    const processedImage = {
      ocrText: sortedMathBlocks
        .map((b: any) => b.mathpixLatex || b.googleVisionText || '')
        .filter(Boolean)
        .join('\n'),
      boundingBoxes: sortedMathBlocks
        .filter((b: any) => b.mathpixLatex)
        .map((b: any) => ({
          x: b.coordinates.x,
          y: b.coordinates.y,
          width: b.coordinates.width,
          height: b.coordinates.height,
          text: b.mathpixLatex as string,
          confidence: b.confidence,
        })),
      confidence: ocr.confidence,
      imageDimensions: ocr.dimensions,
      isQuestion: false,
    };


    // 2) Feed directly into LLMOrchestrator (skip re-OCR)
    const { LLMOrchestrator } = await import('../services/ai/LLMOrchestrator.js');

    const result = await LLMOrchestrator.executeMarking({
      imageData: base64Data,
      model: 'gemini-2.5-pro',
      processedImage: processedImage as any,
      questionDetection: undefined,
    });


    if (result.annotations?.length) {
    }
  } catch (err) {
    console.error('❌ Combined test failed:', err);
    process.exit(1);
  }
}

run();
