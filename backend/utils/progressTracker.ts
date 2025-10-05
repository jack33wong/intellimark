/**
 * Simple Progress Tracker Utility
 * Generic progress tracking for any service that needs step-by-step progress updates
 */

export interface StepConfig {
  id: string;
  name: string;
  description: string;
}

export interface ProgressData {
  currentStepDescription: string; // Current step description for UI
  allSteps: string[];             // Simplified array of step descriptions
  currentStepIndex: number;       // Current active step index (0-based)
  isComplete: boolean;            // Whether all steps are completed
}

export class ProgressTracker {
  private steps: StepConfig[];
  private currentStepIndex: number = 0;
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

  completeCurrentStep(): void {
    if (this.currentStepIndex < this.steps.length - 1) {
      this.currentStepIndex++;
      this.updateProgress();
    }
  }

  finish(): void {
    // Don't change currentStepIndex - keep it at the last step that was actually reached
    // Just mark as complete
    this.updateProgress();
  }

  getCurrentStep(): string {
    const currentStep = this.steps[this.currentStepIndex];
    return currentStep ? `${currentStep.name} (${currentStep.description})` : 'Unknown step';
  }

  getCurrentStepId(): string {
    const currentStep = this.steps[this.currentStepIndex];
    return currentStep ? currentStep.id : 'unknown';
  }

  private updateProgress(): void {
    const currentStep = this.steps[this.currentStepIndex];
    const isComplete = this.currentStepIndex >= this.steps.length - 1;

    // For progressive display, show only steps up to the current one
    const visibleSteps = this.steps.slice(0, this.currentStepIndex + 1).map(step => step.description);

    const progressData: ProgressData = {
      currentStepDescription: currentStep?.description || (isComplete ? 'Complete' : ''),
      allSteps: visibleSteps, // Only show steps that have been reached
      currentStepIndex: this.currentStepIndex,
      isComplete
    };

    // Debug logging
    console.log('🔍 [BACKEND DEBUG] ProgressTracker updateProgress:', {
      currentStepIndex: this.currentStepIndex,
      totalSteps: this.steps.length,
      currentStepDescription: progressData.currentStepDescription,
      allSteps: progressData.allSteps,
      isComplete: progressData.isComplete,
      steps: this.steps.map(s => ({ id: s.id, name: s.name, description: s.description }))
    });

    this.onProgress(progressData);
  }
}

// Mode-specific step configurations
export const TEXT_MODE_STEPS: StepConfig[] = [
  {
    id: 'ai_thinking',
    name: 'AI Thinking',
    description: 'AI is thinking...'
  },
  {
    id: 'generating_response',
    name: 'Generating Response',
    description: 'Generating response...'
  }
];

export const QUESTION_MODE_STEPS: StepConfig[] = [
  {
    id: 'analyzing_image',
    name: 'Analyzing Image',
    description: 'Analyzing image...'
  },
  {
    id: 'classifying_image',
    name: 'Classifying Image',
    description: 'Classifying image...'
  },
  {
    id: 'generating_response',
    name: 'Generating Response',
    description: 'Generating response...'
  }
];

export const MARKING_MODE_STEPS: StepConfig[] = [
  {
    id: 'analyzing_image',
    name: 'Analyzing Image',
    description: 'Analyzing image...'
  },
  {
    id: 'classifying_image',
    name: 'Classifying Image',
    description: 'Classifying image...'
  },
  {
    id: 'detecting_question',
    name: 'Detecting Question',
    description: 'Detecting question type...'
  },
  {
    id: 'extracting_text',
    name: 'Extracting Text',
    description: 'Extracting text and math...'
  },
  {
    id: 'generating_feedback',
    name: 'Generating Feedback',
    description: 'Generating feedback...'
  },
  {
    id: 'creating_annotations',
    name: 'Creating Annotations',
    description: 'Creating annotations...'
  },
  {
    id: 'generating_response',
    name: 'Generating Response',
    description: 'Generating response...'
  }
];

// Helper function to get steps for a specific mode
export function getStepsForMode(mode: 'text' | 'question' | 'marking'): StepConfig[] {
  switch (mode) {
    case 'text':
      return TEXT_MODE_STEPS;
    case 'question':
      return QUESTION_MODE_STEPS;
    case 'marking':
      return MARKING_MODE_STEPS;
    default:
      return TEXT_MODE_STEPS;
  }
}