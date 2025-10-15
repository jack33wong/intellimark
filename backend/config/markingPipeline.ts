import { LLMOrchestrator } from '../services/marking/LLMOrchestrator.js';
import { AnnotationMapper } from '../services/marking/AnnotationMapper.js';
import { ClassificationService } from '../services/ai/ClassificationService.js';
import { MarkingInstructionService } from '../services/marking/MarkingInstructionService.js';

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


