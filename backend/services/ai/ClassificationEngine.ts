import type { ImageClassification, ModelType } from '../../types/index.js';

/**
 * ClassificationEngine
 * Delegates to existing AIMarkingService.classifyImage to avoid logic changes.
 */
export class ClassificationEngine {
  static async classifyImage(imageData: string, model: ModelType): Promise<ImageClassification> {
    const { ClassificationService } = await import('./ClassificationService');
    return ClassificationService.classifyImage(imageData, model);
  }
}


