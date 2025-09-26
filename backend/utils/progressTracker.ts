/**
 * Simple Progress Tracker Utility
 * Generic progress tracking for any service that needs step-by-step progress updates
 */

export interface StepConfig {
  id: string;
  name: string;
  description: string;
  percentage: number;
}

export interface ProgressData {
  currentStepDescription: string; // Current step description for UI
  completedSteps: string[];       // Array of completed step IDs
  allSteps: StepConfig[];         // Complete array of all steps
  isComplete: boolean;            // Whether all steps are completed
}

export class ProgressTracker {
  private steps: StepConfig[];
  private currentStepIndex: number = 0;
  private completedSteps: string[] = [];
  private onProgress: (data: ProgressData) => void;

  constructor(steps: StepConfig[], onProgress: (data: ProgressData) => void) {
    this.steps = steps;
    this.onProgress = onProgress;
  }

  startStep(stepId: string): void {
    const stepIndex = this.steps.findIndex(step => step.id === stepId);
    if (stepIndex === -1) {
      console.warn(`Step ${stepId} not found in configuration`);
      return;
    }

    this.currentStepIndex = stepIndex;
    this.updateProgress();
  }

  completeStep(stepId: string): void {
    if (!this.completedSteps.includes(stepId)) {
      this.completedSteps.push(stepId);
    }
    this.updateProgress();
  }

  completeCurrentStep(): void {
    if (this.currentStepIndex < this.steps.length) {
      const currentStep = this.steps[this.currentStepIndex];
      this.completeStep(currentStep.id);
    }
  }

  finish(): void {
    this.completedSteps = this.steps.map(step => step.id);
    this.currentStepIndex = this.steps.length;
    this.updateProgress();
  }

  private updateProgress(): void {
    const currentStep = this.steps[this.currentStepIndex];
    const isComplete = this.completedSteps.length === this.steps.length;

    const progressData: ProgressData = {
      currentStepDescription: currentStep?.description || '',
      completedSteps: [...this.completedSteps],
      allSteps: [...this.steps],
      isComplete
    };

    this.onProgress(progressData);
  }
}

// Predefined step configurations
export const QUESTION_MODE_STEPS: StepConfig[] = [
  {
    id: 'classification',
    name: 'Classification',
    description: 'Analyzing image...',
    percentage: 14
  },
  {
    id: 'question_detection',
    name: 'Question Detection',
    description: 'Detecting question type...',
    percentage: 28
  }
];

export const MARKING_MODE_STEPS: StepConfig[] = [
  {
    id: 'classification',
    name: 'Classification',
    description: 'Analyzing image...',
    percentage: 14
  },
  {
    id: 'question_detection',
    name: 'Question Detection',
    description: 'Detecting question type...',
    percentage: 28
  },
  {
    id: 'ocr_processing',
    name: 'OCR Processing',
    description: 'Extracting text and math...',
    percentage: 57
  },
  {
    id: 'marking_instructions',
    name: 'Marking Instructions',
    description: 'Generating feedback...',
    percentage: 71
  },
  {
    id: 'burn_overlay',
    name: 'Burn Overlay',
    description: 'Creating annotations...',
    percentage: 85
  },
  {
    id: 'ai_response',
    name: 'AI Response',
    description: 'Finalizing response...',
    percentage: 95
  },
  {
    id: 'data_complete',
    name: 'Data Complete',
    description: 'Almost done...',
    percentage: 100
  }
];
