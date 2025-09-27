/**
 * Simple Progress Tracker Utility
 * Generic progress tracking for any service that needs step-by-step progress updates
 */

export interface ProgressData {
  currentStepIndex: number;       // Current step index (0-based)
  completedStepIndices: number[]; // Array of completed step indices
  allSteps: string[];             // Complete array of all step descriptions
  isComplete: boolean;            // Whether all steps are completed
}

export class ProgressTracker {
  private steps: string[];
  private currentStepIndex: number = 0;
  private completedStepIndices: number[] = [];
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
    const stepIndex = this.steps.findIndex(step => step === stepDescription);
    if (stepIndex !== -1 && !this.completedStepIndices.includes(stepIndex)) {
      this.completedStepIndices.push(stepIndex);
    }
    this.updateProgress();
  }

  completeCurrentStep(): void {
    if (this.currentStepIndex < this.steps.length && !this.completedStepIndices.includes(this.currentStepIndex)) {
      this.completedStepIndices.push(this.currentStepIndex);
    }
    this.updateProgress();
  }

  finish(): void {
    this.completedStepIndices = Array.from({ length: this.steps.length }, (_, i) => i);
    this.currentStepIndex = this.steps.length;
    this.updateProgress();
  }

  private updateProgress(): void {
    const isComplete = this.completedStepIndices.length === this.steps.length;

    const progressData: ProgressData = {
      currentStepIndex: this.currentStepIndex,
      completedStepIndices: [...this.completedStepIndices],
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
