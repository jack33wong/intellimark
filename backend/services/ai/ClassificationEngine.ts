import type { ImageClassification, ModelType } from '../../types/index';

/**
 * ClassificationEngine
 * Delegates to existing AIMarkingService.classifyImage to avoid logic changes.
 */
export class ClassificationEngine {
  static async classifyImage(imageData: string, model: ModelType): Promise<ImageClassification> {
    const { AIMarkingService } = await import('../aiMarkingService');
    return AIMarkingService.classifyImage(imageData, model);
  }
}


