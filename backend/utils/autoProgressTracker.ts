/**
 * Auto Progress Tracker
 * Automatically tracks function calls and updates progress without manual step management
 * Non-breaking: works alongside existing ProgressTracker
 */

import { ProgressTracker, StepConfig } from './progressTracker.js';

export interface AutoProgressOptions {
  stepId: string;
  stepName: string;
  stepDescription: string;
}

export class AutoProgressTracker {
  private progressTracker: ProgressTracker;
  private stepMap: Map<string, AutoProgressOptions> = new Map();
  private currentStepId: string | null = null;

  constructor(steps: StepConfig[], onProgress: (data: any) => void) {
    this.progressTracker = new ProgressTracker(steps, onProgress);
  }

  /**
   * Register a function with auto-progress tracking
   */
  registerStep(stepId: string, options: AutoProgressOptions): void {
    this.stepMap.set(stepId, options);
  }

  /**
   * Decorator function that automatically tracks progress
   */
  withProgress<T extends any[], R>(
    stepId: string,
    fn: (...args: T) => Promise<R>
  ): (...args: T) => Promise<R> {
    return async (...args: T): Promise<R> => {
      const stepOptions = this.stepMap.get(stepId);
      if (!stepOptions) {
        console.warn(`Step ${stepId} not registered for auto-progress`);
        return fn(...args);
      }

      // Start the step
      this.currentStepId = stepId;
      this.progressTracker.startStep(stepId);

      try {
        // Execute the function
        const result = await fn(...args);
        
        // Complete the step
        this.progressTracker.completeCurrentStep();
        this.currentStepId = null;
        
        return result;
      } catch (error) {
        // If there's an error, still complete the step to avoid hanging
        this.progressTracker.completeCurrentStep();
        this.currentStepId = null;
        throw error;
      }
    };
  }

  /**
   * Manually start a step (for backward compatibility)
   */
  startStep(stepId: string): void {
    this.progressTracker.startStep(stepId);
    this.currentStepId = stepId;
  }

  /**
   * Manually complete current step (for backward compatibility)
   */
  completeCurrentStep(): void {
    this.progressTracker.completeCurrentStep();
    this.currentStepId = null;
  }

  /**
   * Finish progress tracking
   */
  finish(): void {
    this.progressTracker.finish();
    this.currentStepId = null;
  }

  /**
   * Get current step info
   */
  getCurrentStep(): string {
    return this.progressTracker.getCurrentStep();
  }

  /**
   * Get current step ID
   */
  getCurrentStepId(): string {
    return this.progressTracker.getCurrentStepId();
  }
}

/**
 * Helper function to create auto-progress tracker with predefined steps
 */
export function createAutoProgressTracker(
  steps: StepConfig[],
  onProgress: (data: any) => void
): AutoProgressTracker {
  return new AutoProgressTracker(steps, onProgress);
}
