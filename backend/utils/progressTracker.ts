/**
 * Simple Progress Tracker Utility
 * Generic progress tracking for any service that needs step-by-step progress updates
 */

export interface ProgressData {
  currentStep: string;            // Current step description for UI
  completedSteps: string[];       // Array of completed step descriptions
  allSteps: string[];             // Complete array of all step descriptions
  isComplete: boolean;            // Whether all steps are completed
}

export class ProgressTracker {
  private steps: string[];
  private currentStepIndex: number = 0;
  private completedSteps: string[] = [];
  private onProgress: (data: ProgressData) => void;

  constructor(steps: string[], onProgress: (data: ProgressData) => void) {
    this.steps = steps;
    this.onProgress = onProgress;
  }

  startStep(stepDescription: string): void {
    const stepIndex = this.steps.findIndex(step => step === stepDescription);
    if (stepIndex === -1) {
      console.warn(`Step "${stepDescription}" not found in configuration`);
      return;
    }

    this.currentStepIndex = stepIndex;
    this.updateProgress();
  }

  completeStep(stepDescription: string): void {
    if (!this.completedSteps.includes(stepDescription)) {
      this.completedSteps.push(stepDescription);
    }
    this.updateProgress();
  }

  completeCurrentStep(): void {
    if (this.currentStepIndex < this.steps.length) {
      const currentStep = this.steps[this.currentStepIndex];
      this.completeStep(currentStep);
    }
  }

  finish(): void {
    this.completedSteps = [...this.steps];
    this.currentStepIndex = this.steps.length;
    this.updateProgress();
  }

  private updateProgress(): void {
    const currentStep = this.steps[this.currentStepIndex];
    const isComplete = this.completedSteps.length === this.steps.length;

    const progressData: ProgressData = {
      currentStep: currentStep || '',
      completedSteps: [...this.completedSteps],
      allSteps: [...this.steps],
      isComplete
    };

    this.onProgress(progressData);
  }
}

// Predefined step configurations
export const QUESTION_MODE_STEPS: string[] = [
  'Analyzing image...',
  'Detecting question type...',
  'Generating response...'
];

export const MARKING_MODE_STEPS: string[] = [
  'Analyzing image...',
  'Detecting question type...',
  'Extracting text and math...',
  'Generating feedback...',
  'Creating annotations...',
  'Finalizing response...',
  'Almost done...'
];
