/**
 * Image Annotation Service for Mark Homework System
 * Handles SVG overlay generation and image annotation placement
 */

import { 
    Annotation, 
    ImageAnnotation, 
    ImageAnnotationResult, 
    ImageDimensions, 
    BoundingBox 
  } from '../types/index.js';
  import { SVGOverlayService } from './svgOverlayService.js';
  
  // Define the structure for coordinates
  interface CoordinateBox {
      x: number;
      y: number;
      width: number;
      height: number;
  }

  // We will treat the input student work steps generically (any) in the main method for maximum robustness.
  
  /**
   * Image Annotation Service class
   */
  export class ImageAnnotationService {
    
    // Helper function to extract coordinates robustly from a generic object
    private static getStepCoordinates(step: any): CoordinateBox | null {
      if (!step) return null;

      // Check for Modern Pipeline structure (OptimizedOCRService)
      if (step.boundingBox && typeof step.boundingBox.x === 'number') {
        return step.boundingBox;
      }
      
      // Check for Legacy Pipeline structure (HybridOCRService)
      if (step.coordinates && typeof step.coordinates.x === 'number') {
        return step.coordinates;
      }

      // Check for flattened structure (sometimes used by older orchestrators or normalized inputs)
      if (typeof step.x === 'number' && typeof step.y === 'number' && typeof step.width === 'number' && typeof step.height === 'number') {
        return { x: step.x, y: step.y, width: step.width, height: step.height };
      }
      
      return null;
    }

    // Helper function to extract the step ID robustly
    private static getStepId(step: any): string | null {
        if (!step) return null;
        // Ensure the result is a string and trimmed
        const id = step.step_id || step.id;
        return typeof id === 'string' ? id.trim() : null;
    }


    /**
     * Create SVG overlay for image annotations
     * (Preserved implementation)
     */
    static createSVGOverlay(annotations: Annotation[], imageDimensions: ImageDimensions): string {
      if (!annotations || annotations.length === 0) {
        return '';
      }
  
      let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${imageDimensions.width}" height="${imageDimensions.height}" style="position: absolute; top: 0; left: 0; pointer-events: none;">`;
      
      annotations.forEach((annotation, index) => {
        if (annotation.text && annotation.bbox) {
          const commentSvg = this.createCommentAnnotation(annotation, imageDimensions, index);
          svg += commentSvg;
        }
      });
  
      const finalSvg = svg + '</svg>';
      return finalSvg;
    }
  
    /**
     * Create individual comment annotation in SVG
     * (Preserved implementation)
     */
    private static createCommentAnnotation(
      annotation: Annotation, 
      _imageDimensions: ImageDimensions, 
      index: number
    ): string {
      if (!annotation.text || !annotation.bbox) {
        return '';
      }
      
      const commentText = this.breakTextIntoLines(annotation.text, 50);
      let svg = '';
  
      // Add background rectangle for better readability
      const textWidth = this.estimateTextWidth(annotation.text, 24);
      const textHeight = commentText.length * 28.8;
      
      
      svg += `<rect 
        x="${annotation.bbox[0] - 5}" 
        y="${annotation.bbox[1] - 20}" 
        width="${textWidth + 10}" 
        height="${textHeight + 10}" 
        fill="rgba(255, 255, 255, 0.9)" 
        stroke="red" 
        stroke-width="2" 
        rx="5" 
        opacity="0.95"
      />`;
  
      // Add comment text
      commentText.forEach((line, lineIndex) => {
        const y = annotation.bbox![1] + (lineIndex * 28.8);
        svg += `<text 
          id="comment-${index}-${lineIndex}"
          x="${annotation.bbox![0]}" 
          y="${y}" 
          fill="red" 
          font-family="'Comic Neue', 'Comic Sans MS', 'Lucida Handwriting', cursive, Arial, sans-serif" 
          font-size="24" 
          font-weight="bold" 
          text-anchor="start" 
          dominant-baseline="middle"
          style="pointer-events: auto; cursor: pointer;"
        >${this.escapeHtml(line)}</text>`;
      });
  
      return svg;
    }
  
    // ... [Preserved helper methods: breakTextIntoLines, estimateTextWidth, escapeHtml, calculateCommentPosition, validateAnnotationPosition] ...
  
    private static breakTextIntoLines(text: string, maxCharsPerLine: number): string[] {
      if (!text || text.length <= maxCharsPerLine) {
        return [text];
      }
  
      const words = text.split(' ');
      const lines: string[] = [];
      let currentLine = '';
  
      words.forEach(word => {
        if ((currentLine + word).length <= maxCharsPerLine) {
          currentLine += (currentLine ? ' ' : '') + word;
        } else {
          if (currentLine) lines.push(currentLine);
          currentLine = word;
        }
      });
  
      if (currentLine) lines.push(currentLine);
      return lines;
    }
  
    private static estimateTextWidth(text: string, fontSize: number): number {
      return text.length * fontSize * 0.6;
    }
  
    private static escapeHtml(text: string): string {
      if (typeof text !== 'string') return '';
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }
  
    static calculateCommentPosition(
      boundingBox: BoundingBox, 
      imageDimensions: ImageDimensions, 
      commentLength: number
    ): { x: number; y: number } {
      const commentWidth = this.estimateTextWidth('A'.repeat(Math.min(commentLength, 50)), 24);
      const commentHeight = Math.ceil(commentLength / 50) * 28.8;
  
      let x = boundingBox.x + boundingBox.width + 10;
      let y = boundingBox.y + boundingBox.height / 2;
  
      // Adjust position to keep comment within image bounds
      if (x + commentWidth > imageDimensions.width) {
        x = boundingBox.x - commentWidth - 10;
      }
  
      if (y + commentHeight > imageDimensions.height) {
        y = imageDimensions.height - commentHeight - 10;
      }
  
      if (y < 0) {
        y = 10;
      }
  
      return { x: Math.max(0, x), y: Math.max(0, y) };
    }
  
    static validateAnnotationPosition(
      annotation: Annotation, 
      imageDimensions: ImageDimensions
    ): boolean {
      if (!annotation.text || !annotation.bbox) return false;
      
      const commentWidth = this.estimateTextWidth(annotation.text, 24);
      const commentHeight = this.breakTextIntoLines(annotation.text, 50).length * 28.8;
  
      return (
        annotation.bbox[0] >= 0 &&
        annotation.bbox[1] >= 0 &&
        annotation.bbox[0] + commentWidth <= imageDimensions.width &&
        annotation.bbox[1] + commentHeight <= imageDimensions.height
      );
    }
  
    /**
     * Generate complete annotation result with SVG overlay
     * @param originalImage - Base64 encoded original image
     * @param aiAnnotations - Array of annotations from the AI (linked by step_id)
      * @param studentWorkSteps - Array of detected student work steps (generic type for robustness)
     * @param imageDimensions - Dimensions of the original image
     * @param studentScore - Optional student score to burn into the image
     * @returns Complete annotation result
     */
    static async generateAnnotationResult(
      originalImage: string,
      aiAnnotations: Annotation[],
      // Changed type to any[] for robust debugging
      studentWorkSteps: any[],
      imageDimensions: ImageDimensions,
      studentScore?: any
    ): Promise<ImageAnnotationResult> {

    // --- DIAGNOSTIC LOGGING START ---
    // Log the structure of the incoming data to identify why coordinates are missing
    console.log("🔍 [ANNOTATION SERVICE DEBUG] Starting generateAnnotationResult.");
    if (studentWorkSteps && Array.isArray(studentWorkSteps) && studentWorkSteps.length > 0) {
        console.log(`🔍 [ANNOTATION SERVICE DEBUG] Received ${studentWorkSteps.length} studentWorkSteps. Inspecting first step structure:`);
        try {
            // Use JSON.stringify to inspect the actual runtime object structure
            console.log(JSON.stringify(studentWorkSteps[0], null, 2));
        } catch (e) {
            console.log("Could not stringify first step. Logging keys instead:", Object.keys(studentWorkSteps[0]));
        }
        const availableIds = studentWorkSteps.map(s => this.getStepId(s)).join(', ');
        console.log("🔍 [ANNOTATION SERVICE DEBUG] Available Step IDs:", availableIds);
    } else {
        console.log("🔍 [ANNOTATION SERVICE DEBUG] studentWorkSteps is empty or not an array.");
    }
    // --- DIAGNOSTIC LOGGING END ---


    try {
  
        // Early exit if there are no annotations to render
        if (!aiAnnotations || aiAnnotations.length === 0) {
          return {
            originalImage,
            annotatedImage: originalImage,
            annotations: [],
            svgOverlay: ''
          };
        }
  
        // Robustness check: Ensure studentWorkSteps is an array
        if (!Array.isArray(studentWorkSteps)) {
          console.error('❌ [ImageAnnotationService] studentWorkSteps is not an array. Attempting normalization.');
          if (typeof studentWorkSteps === 'object' && studentWorkSteps !== null) {
              studentWorkSteps = Object.values(studentWorkSteps);
          } else {
              console.error("❌ [ImageAnnotationService] Cannot map annotations because studentWorkSteps is invalid.");
              studentWorkSteps = []; 
          }
        }
  
        // --- CORE LOGIC: Map AI Annotations (step_id) to Coordinates (BoundingBox) ---
        const mappedAnnotations: Annotation[] = aiAnnotations.map(aiAnnotation => {
          
          const searchId = aiAnnotation.step_id?.trim();

          if (!searchId) {
            console.warn(`⚠️ [ANNOTATION SERVICE] AI annotation is missing step_id. Skipping.`);
            return null;
          }

          // Find the corresponding student work step using the robust ID getter
          const correspondingStep = studentWorkSteps.find(step => this.getStepId(step) === searchId);

          // Use the robust coordinate getter
          const coords = correspondingStep ? this.getStepCoordinates(correspondingStep) : null;

          // CRITICAL CHECK: Ensure coordinates were found AND are valid numbers
          if (coords && coords.x !== undefined && !isNaN(coords.x) && coords.y !== undefined && !isNaN(coords.y)) {
            // Create the bbox array [x, y, width, height]
            const bbox: [number, number, number, number] = [coords.x, coords.y, coords.width, coords.height];

            // Return the annotation with the actual coordinates included
            return {
              ...aiAnnotation,
              bbox: bbox
            };
          } else {
            // Handle cases where the step_id or coordinates could not be found
            console.warn(`⚠️ [ANNOTATION SERVICE] Could not find coordinates for step_id: "${searchId}". Skipping annotation.`);
            
            // DIAGNOSTIC LOGGING: Log the problematic step object if found but missing coords
            if (correspondingStep) {
                console.log(`🔍 [DEBUG ANNOTATION] Problematic step object found for "${searchId}" (Coordinates missing/invalid):`);
                try {
                    console.log(JSON.stringify(correspondingStep, null, 2));
                } catch (e) {
                    console.log("Could not stringify problematic step.");
                }
            } else {
                console.log(`🔍 [DEBUG ANNOTATION] No corresponding step found for "${searchId}".`);
            }

            return null;
          }
        }).filter((ann): ann is Annotation => ann !== null && ann.bbox !== undefined); // Filter out skipped annotations
  
        
        // Burn SVG overlay into the image (using mapped annotations)
        const burnedImage = await SVGOverlayService.burnSVGOverlayServerSide(
          originalImage,
          mappedAnnotations,
          imageDimensions,
           studentScore
        );
        
        // Convert annotations to ImageAnnotation format for the response
        const imageAnnotations: ImageAnnotation[] = mappedAnnotations.map(ann => ({
          position: { x: ann.bbox![0], y: ann.bbox![1] },
          comment: ann.text || '',
           hasComment: !!ann.text,
          boundingBox: {
            x: ann.bbox![0],
            y: ann.bbox![1],
            width: ann.bbox![2],
            height: ann.bbox![3],
            text: ann.text || ''
          }
        }));

        
        return {
           originalImage,
          annotatedImage: burnedImage,
          annotations: imageAnnotations,
          svgOverlay: ''
        };
      } catch (error) {
        console.error('❌ Failed to generate annotation result:', error);
        console.error('❌ Error details:', error instanceof Error ? error.message : 'Unknown error');
        console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
        
        // Throw the real error instead of failing silently
        throw new Error(`Image annotation generation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  
    /**
     * Get annotation statistics
     */
    static getAnnotationStats(annotations: Annotation[]): {
      totalAnnotations: number;
      totalComments: number;
      averageCommentLength: number;
    } {
      const totalAnnotations = annotations.length;
      const totalComments = annotations.filter(a => a.text).length;
      const totalCommentLength = annotations
        .filter(a => a.text)
        .reduce((sum, a) => sum + (a.text?.length || 0), 0);
  
      return {
        totalAnnotations,
        totalComments,
        averageCommentLength: totalComments > 0 ? totalCommentLength / totalComments : 0
      };
    }
  }