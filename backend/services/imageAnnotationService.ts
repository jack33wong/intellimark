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

/**
 * Image Annotation Service class
 */
export class ImageAnnotationService {
  /**
   * Create SVG overlay for image annotations
   * @param annotations - Array of annotations to overlay
   * @param imageDimensions - Dimensions of the original image
   * @returns SVG markup string for the overlay
   */
  static createSVGOverlay(annotations: Annotation[], imageDimensions: ImageDimensions): string {
    if (!annotations || annotations.length === 0) {
      return '';
    }

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${imageDimensions.width}" height="${imageDimensions.height}" style="position: absolute; top: 0; left: 0; pointer-events: none;">`;
    
    annotations.forEach((annotation, index) => {
      if (annotation.text) {
        const commentSvg = this.createCommentAnnotation(annotation, imageDimensions, index);
        svg += commentSvg;
      }
    });

    const finalSvg = svg + '</svg>';
    return finalSvg;
  }

  /**
   * Create individual comment annotation in SVG
   * @param annotation - The annotation to render
   * @param imageDimensions - Dimensions of the original image
   * @param index - Index of the annotation for unique IDs
   * @returns SVG markup for the comment
   */
  private static createCommentAnnotation(
    annotation: Annotation, 
    _imageDimensions: ImageDimensions, 
    index: number
  ): string {
    if (!annotation.text) {
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
      const y = annotation.bbox[1] + (lineIndex * 28.8);
      svg += `<text 
        id="comment-${index}-${lineIndex}"
        x="${annotation.bbox[0]}" 
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

  /**
   * Break text into lines based on maximum characters per line
   * @param text - Text to break into lines
   * @param maxCharsPerLine - Maximum characters allowed per line
   * @returns Array of text lines
   */
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

  /**
   * Estimate text width based on character count and font size
   * @param text - Text to measure
   * @param fontSize - Font size in pixels
   * @returns Estimated width in pixels
   */
  private static estimateTextWidth(text: string, fontSize: number): number {
    // Rough estimation: average character width is about 0.6 * fontSize
    return text.length * fontSize * 0.6;
  }

  /**
   * Escape HTML special characters for SVG text
   * @param text - Text to escape
   * @returns Escaped text safe for SVG
   */
  private static escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Calculate optimal comment position to avoid overlapping
   * @param boundingBox - The bounding box of the text being commented on
   * @param imageDimensions - Dimensions of the original image
   * @param commentLength - Length of the comment text
   * @returns Optimal position for the comment
   */
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


  /**
   * Validate annotation position within image bounds
   * @param annotation - Annotation to validate
   * @param imageDimensions - Dimensions of the original image
   * @returns True if annotation is within bounds
   */
  static validateAnnotationPosition(
    annotation: Annotation, 
    imageDimensions: ImageDimensions
  ): boolean {
    if (!annotation.text) return false;
    
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
   * @param annotations - Array of annotations
   * @param imageDimensions - Dimensions of the original image
   * @returns Complete annotation result
   */
  static async generateAnnotationResult(
    originalImage: string,
    annotations: Annotation[],
    imageDimensions: ImageDimensions
  ): Promise<ImageAnnotationResult> {
    try {
      if (annotations) {
        annotations.forEach((annotation, index) => {
        });
      }

      // Early exit if there are no annotations to render
      if (!annotations || annotations.length === 0) {
        return {
          originalImage,
          annotatedImage: originalImage,
          annotations: [],
          svgOverlay: ''
        };
      }

      
      // Create SVG overlay for reference
      const svgOverlay = this.createSVGOverlay(annotations, imageDimensions);
      
      // Burn SVG overlay into the image
      const burnedImage = await SVGOverlayService.burnSVGOverlayServerSide(
        originalImage,
        annotations,
        imageDimensions
      );
      
      // Convert annotations to ImageAnnotation format
      const imageAnnotations: ImageAnnotation[] = annotations.map(ann => ({
        position: { x: ann.bbox[0], y: ann.bbox[1] },
        comment: ann.text || '', // Legacy field for ImageAnnotation interface
        hasComment: !!ann.text,
        boundingBox: {
          x: ann.bbox[0],
          y: ann.bbox[1],
          width: ann.bbox[2],
          height: ann.bbox[3],
          text: ann.text || ''
        }
      }));

      
      return {
        originalImage,
        annotatedImage: burnedImage, // Return burned image instead of original
        annotations: imageAnnotations,
        svgOverlay
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
   * @param annotations - Array of annotations
   * @returns Statistics about the annotations
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
