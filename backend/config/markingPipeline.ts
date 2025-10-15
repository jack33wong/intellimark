import { AnnotationMapper } from '../utils/AnnotationMapper.js';
import { ClassificationService } from '../services/marking/ClassificationService.js';
import { MarkingInstructionService } from '../services/marking/MarkingInstructionService.js';

export interface MarkingPipeline {
  annotationMapper: typeof AnnotationMapper;
  classification: typeof ClassificationService;
  markingInstruction: typeof MarkingInstructionService;
}

export function buildMarkingPipeline(): MarkingPipeline {
  return {
    annotationMapper: AnnotationMapper,
    classification: ClassificationService,
    markingInstruction: MarkingInstructionService
  };
}


