/**
 * Test script for AI marking functionality
 * Tests the MarkingInstructionService with provided OCR text input
 */

// Load environment variables
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { LLMOrchestrator } from '../services/ai/LLMOrchestrator.ts.js';

async function testAIMarking() {

  // The OCR text from the user's input
  const ocrText = `   \\text { Question } 3
A particle P of mass 0.5 kg is attached to a light spring of natural length 0.6 m and A particle P of mass 0.5 kg is attached to a light spring of natural length 0.6 m and A particle P of mass 0.5 kg is attached to a light spring of natural length 0.6 m and modulus of elasticity 47 N. The other end of the spring is attached to a fixed point modulus of elasticity 47 N. The other end of the spring is attached to a fixed point modulus of elasticity 47 N. The other end of the spring is attached to a fixed point O on a ceiling , so that P is hanging at rest vertically below O. The particle is pulled O on a ceiling , so that P is hanging at rest vertically below O. The particle is pulled ◇ on a ceiling , so that P is hanging at rest vertically below O. The particle is pulled
\\text { vertically downwards so that }|O P|=1.16 \\mathrm{~m} \\text { and released from rest. }
\\text { Ignoring any external resistances, find the speed of } P \\text { when }|O P|=0.88 \\mathrm{~m} \\text {. }
\\text { (8) }
\\text { "A" AS THE POINT OF ZERO GRAVITATIANAL }
l=0.6
\\Rightarrow K E_{A}+D E_{A}+E E_{A}=K E_{B}+P E_{B}+E E_{B}
\\Rightarrow \\frac{\\lambda}{2 l} x_{1}^{2}=\\frac{1}{2} m v^{2}+m g h+\\frac{\\lambda}{2 l} x_{2}^{2}
0.281 .0 .881 .66
-
\\Rightarrow \\frac{\\lambda x_{1}^{2}}{l}=m v^{2}+2 m g h+\\frac{\\lambda}{l}-x_{2}^{2}
\\uparrow
\\Rightarrow \\frac{\\lambda}{m l} x^{2}=v^{2}+2 g h
t
\\frac{\\lambda}{m l} x_{2}^{2}
A .
\\phi_{u=0}
\\Rightarrow V^{2}=\\frac{\\lambda}{m l}\\left(x_{1}^{2}-x_{2}^{2}\\right)-2 g h
\\lambda=47 \\mathrm{~N}
\\Longrightarrow V^{2}=
\\frac{47}{0.5 \\times 0.6}\\left[0.56^{2}-0.28^{2}\\right]-2(9.8)(0.28)
l=0.6 \\mathrm{~m}
m=0.5
\\Rightarrow V^{2}=
\\frac{47}{0.3} \\times \\frac{147}{625}
- -
\\frac{686}{125}
\\Rightarrow v^{2}=
\\frac{4606}{125}
-
\\frac{686}{125}
\\Rightarrow V^{2}=
\\frac{784}{25}
\\Rightarrow|\\mathrm{V}|
=\\frac{28}{5}=5.6 \\mathrm{~ms}^{-1}`;

  try {

    // Test the full flow - OCR cleanup will be called automatically by LLMOrchestrator
    const mockImageData = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=';

    const processedImage = {
      ocrText: ocrText, // Use original OCR text - cleanup will happen in LLMOrchestrator
      boundingBoxes: [
        // Mock bounding boxes for testing - these should match the cleaned OCR text
        { x: 10, y: 10, width: 100, height: 20, text: 'l=0.6' },
        { x: 10, y: 40, width: 200, height: 20, text: 'KE_{A}+DE_{A}+EE_{A}=KE_{B}+PE_{B}+EE_{B}' },
        { x: 10, y: 70, width: 300, height: 20, text: '\\frac{\\lambda}{2 l} x_{1}^{2}=\\frac{1}{2} m v^{2}+m g h+\\frac{\\lambda}{2 l} x_{2}^{2}' },
        { x: 10, y: 100, width: 300, height: 20, text: '\\frac{\\lambda x_{1}^{2}}{l}=m v^{2}+2 m g h+\\frac{\\lambda}{l} x_{2}^{2}' },
        { x: 10, y: 130, width: 300, height: 20, text: 'V^{2}=\\frac{\\lambda}{m l}\\left(x_{1}^{2}-x_{2}^{2}\\right)-2 g h' },
        { x: 10, y: 160, width: 100, height: 20, text: '\\lambda=47 \\mathrm{~N}' },
        { x: 10, y: 190, width: 100, height: 20, text: 'l=0.6 \\mathrm{~m}' },
        { x: 10, y: 220, width: 50, height: 20, text: 'm=0.5' },
        { x: 10, y: 250, width: 400, height: 20, text: 'V^{2}=\\frac{47}{0.5 \\times 0.6}\\left[0.56^{2}-0.28^{2}\\right]-2(9.8)(0.28)' },
        { x: 10, y: 280, width: 300, height: 20, text: 'V^{2}=\\frac{47}{0.3} \\times \\frac{147}{625} - \\frac{686}{125}' },
        { x: 10, y: 310, width: 200, height: 20, text: 'V^{2}=\\frac{4606}{125} - \\frac{686}{125}' },
        { x: 10, y: 340, width: 100, height: 20, text: 'V^{2}=\\frac{784}{25}' },
        { x: 10, y: 370, width: 150, height: 20, text: '|V|=\\frac{28}{5}=5.6 \\mathrm{~ms}^{-1}' }
      ],
      confidence: 0.9,
      imageDimensions: { width: 800, height: 600 },
      isQuestion: false
    };

    const result = await LLMOrchestrator.executeMarking({
      imageData: mockImageData,
      model: 'gemini-2.5-pro',
      processedImage,
      questionDetection: undefined
    });


    // Show formatted annotations
    if (result.annotations?.length > 0) {
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testAIMarking()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });

export { testAIMarking };
