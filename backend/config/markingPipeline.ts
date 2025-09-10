import { LLMOrchestrator } from '../services/ai/LLMOrchestrator';
import { AnnotationMapper } from '../services/ai/AnnotationMapper';
import { ClassificationService } from '../services/ai/ClassificationService';
import { MarkingInstructionService } from '../services/ai/MarkingInstructionService';

export interface MarkingPipeline {
  orchestrator: typeof LLMOrchestrator;
  annotationMapper: typeof AnnotationMapper;
  classification: typeof ClassificationService;
  markingInstruction: typeof MarkingInstructionService;
}

export function buildMarkingPipeline(): MarkingPipeline {
  return {
    orchestrator: LLMOrchestrator,
    annotationMapper: AnnotationMapper,
    classification: ClassificationService,
    markingInstruction: MarkingInstructionService
  };
}


