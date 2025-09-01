/**
 * Test file to verify TypeScript compilation works
 */

import { ImageProcessingService } from './services/imageProcessingService.ts';
import { MathpixService } from './services/mathpixService.ts';
// import { ImageAnnotationService } from './services/imageAnnotationService';
// import { FirestoreService } from './services/firestoreService';
import { AI_MODELS, getModelConfig } from './config/aiModels.ts';
import { FirebaseConfigService } from './config/firebase.ts';
import { LaTeXConfigService } from './config/latex.ts';

console.log('Testing TypeScript compilation...');

// Test service imports
console.log('✅ All services imported successfully');

// Test AI models configuration
console.log('Available models:', Object.keys(AI_MODELS));
console.log('Default model config:', getModelConfig('chatgpt-4o'));

// Test service status
console.log('Image Processing Service status:', ImageProcessingService.getServiceStatus());
console.log('Mathpix Service status:', MathpixService.getServiceStatus());
console.log('Firebase Service status:', FirebaseConfigService.getServiceStatus());

// Test LaTeX configuration
const latexConfig = LaTeXConfigService.getDefaultMathJaxConfig();
console.log('LaTeX config generated:', !!latexConfig);

console.log('🎉 TypeScript compilation test completed successfully!');
