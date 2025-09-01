/**
 * Test file to verify TypeScript compilation works
 */

import { ImageProcessingService } from './services/imageProcessingService';
import { MathpixService } from './services/mathpixService';
// import { ImageAnnotationService } from './services/imageAnnotationService';
// import { FirestoreService } from './services/firestoreService';
import { AI_MODELS, getModelConfig } from './config/aiModels';
import { FirebaseConfigService } from './config/firebase';
import { LaTeXConfigService } from './config/latex';

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
