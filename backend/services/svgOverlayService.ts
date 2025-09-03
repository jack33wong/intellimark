/**
 * SVG Overlay Service
 * Generates SVG overlays for homework marking annotations
 */

import { MarkingInstructions, Annotation } from '../types/index.ts';

export class SVGOverlayService {
  /**
   * Create SVG overlay from marking instructions
   */
  static createSVGOverlay(
    instructions: MarkingInstructions, 
    imageWidth: number = 400, 
    imageHeight: number = 300
  ): string | null {
    if (!instructions.annotations || instructions.annotations.length === 0) {
      return null;
    }

    console.log('🔍 Creating SVG overlay with annotations:', instructions.annotations.length);
    instructions.annotations.forEach((annotation, index) => {
      console.log(`🔍 Annotation ${index + 1}:`, {
        action: annotation.action,
        comment: annotation.comment,
        text: annotation.text,
        bbox: annotation.bbox,
        hasComment: !!(annotation.comment || annotation.text),
        commentLength: (annotation.comment ? annotation.comment.length : 0) + (annotation.text ? annotation.text.length : 0)
      });
    });

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}" style="position: absolute; top: 0; left: 0;">`;
    
    instructions.annotations.forEach((annotation, index) => {
      // Bounding box format: [x, y, width, height]
      const [x, y, width, height] = annotation.bbox;
      const centerX = x + (width / 2);
      const centerY = y + (height / 2);
      
      // Handle comment actions separately
      if (annotation.action === 'comment') {
        if (annotation.text && annotation.text.trim()) {
          this.addCommentText(svg, annotation.text, x, y, width, height, index);
        }
        return; // Skip visual annotation for comment actions
      }
      
      // Handle legacy comment field for backward compatibility (write actions)
      if (annotation.comment && annotation.comment.trim()) {
        this.addCommentText(svg, annotation.comment, x, y, width, height, index);
      }
      
      // Add the visual annotation based on type
      this.addVisualAnnotation(svg, annotation, centerX, centerY, x, y, width, height);
    });
    
    svg += '</svg>';
    
    console.log('🔍 SVG overlay created successfully, length:', svg.length);
    console.log('🔍 SVG preview (first 500 chars):', svg.substring(0, 500));
    
    // Validate SVG structure
    if (!this.validateSVG(svg)) {
      console.error('🔍 SVG validation failed, trying simple fallback...');
      return this.createSimpleSVGOverlay(instructions, imageWidth, imageHeight);
    }
    
    return svg;
  }

  /**
   * Add comment text to SVG
   */
  private static addCommentText(
    svg: string, 
    comment: string, 
    x: number, 
    y: number, 
    width: number, 
    height: number, 
    index: number
  ): void {
    // Clean and escape the comment text for SVG
    let cleanComment = comment
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
    
    // Handle LaTeX expressions by converting them to plain text
    cleanComment = cleanComment
      .replace(/\\\(/g, '(') // Convert \( to (
      .replace(/\\\)/g, ')') // Convert \) to )
      .replace(/\\\\/g, '\\') // Convert \\ to \
      .replace(/\\mathrm\{([^}]*)\}/g, '$1') // Convert \mathrm{text} to text
      .replace(/\\approx/g, '≈') // Convert \approx to ≈
      .replace(/\\mathrm/g, '') // Remove \mathrm
      .replace(/\\text\{([^}]*)\}/g, '$1'); // Convert \text{text} to text
    
    // Split text by line breaks and handle each line separately
    const lines = cleanComment.split('\n');
    
    // Calculate font size based on bounding box size
    const baseFontSize = Math.max(24, Math.min(width, height) / 8);
    const scaledFontSize = Math.min(baseFontSize, 80); // Cap at 80px to avoid oversized text
    
    // Calculate dynamic line height based on font size
    const lineHeight = scaledFontSize * 1.2; // 1.2x font size for line height
    
    // Position comment text to the right of the annotation area
    const commentX = x; // 10px to the right of the bounding box
    const startY = y - ((lines.length - 1) * lineHeight / 2); // Center the multi-line text
    
    console.log(`🔍 Adding comment text for annotation ${index + 1}:`, {
      original: comment,
      cleaned: cleanComment,
      lines: lines.length,
      position: { x: commentX, y: startY }
    });
    
    // Add each line as a separate text element
    lines.forEach((line, lineIndex) => {
      if (line.trim()) { // Only add non-empty lines
        const lineY = startY + (lineIndex * lineHeight);
                 svg += `<text x="${commentX}" y="${lineY}" fill="green" font-family="Bradley Hand ITC, cursive, Arial, sans-serif" font-size="${scaledFontSize * 2}" font-weight="900" text-anchor="start" dominant-baseline="middle">${line}</text>`;
      }
    });
  }

  /**
   * Add visual annotation to SVG
   */
  private static addVisualAnnotation(
    svg: string, 
    annotation: Annotation, 
    centerX: number, 
    centerY: number, 
    x: number, 
    y: number, 
    width: number, 
    height: number
  ): void {
    switch (annotation.action) {
      case 'tick':
        // Calculate font size based on bounding box size for tick
        const tickFontSize = Math.max(40, Math.min(width, height) / 2);
        const scaledTickSize = Math.min(tickFontSize, 200); // Cap at 200px
        svg += `<text x="${centerX}" y="${centerY + 5}" fill="green" font-family="Arial, sans-serif" font-size="${scaledTickSize}" font-weight="bold" text-anchor="middle">✔</text>`;
        break;
        
      case 'cross':
        // Calculate font size based on bounding box size for cross
        const crossFontSize = Math.max(40, Math.min(width, height) / 2);
        const scaledCrossSize = Math.min(crossFontSize, 250); // Cap at 250px
        svg += `<text x="${centerX}" y="${centerY + 5}" fill="red" font-family="Arial, sans-serif" font-size="${scaledCrossSize}" font-weight="bold" text-anchor="middle">✘</text>`;
        break;
        
      case 'circle':
        // Draw a red circle around the area with better positioning
        const radius = Math.max(width, height) / 2 + 5;
        const strokeWidth = Math.max(2, Math.min(width, height) / 20); // Scale stroke width
        svg += `<circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="none" stroke="red" stroke-width="${strokeWidth}" opacity="0.8"/>`;
        console.log(`🔍 Added circle annotation:`, {
          center: { x: centerX, y: centerY },
          radius: radius,
          bbox: { width, height },
          strokeWidth: strokeWidth
        });
        break;
        
      case 'underline':
        // Draw a red underline with scaled stroke width
        const underlineStrokeWidth = Math.max(2, Math.min(width, height) / 20); // Scale stroke width
        svg += `<line x1="${x}" y1="${y + height + 5}" x2="${x + width}" y2="${y + height + 5}" stroke="red" stroke-width="${underlineStrokeWidth}" opacity="0.8"/>`;
        break;
        
      case 'write':
      default:
        // For write actions, just show the comment text (already added above)
        break;
    }
  }

  /**
   * Create simple SVG overlay as fallback
   */
  static createSimpleSVGOverlay(
    instructions: MarkingInstructions, 
    imageWidth: number = 400, 
    imageHeight: number = 300
  ): string | null {
    if (!instructions.annotations || instructions.annotations.length === 0) {
      return null;
    }

    console.log('🔍 Creating simple SVG overlay as fallback...');
    
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${imageWidth}" height="${imageHeight}">`;
    
    instructions.annotations.forEach((annotation) => {
      const [x, y, width, height] = annotation.bbox;
      const centerX = x + (width / 2);
      const centerY = y + (height / 2);
      
      // Handle comments first
      if (annotation.action === 'comment' && annotation.text && annotation.text.trim()) {
        this.addSimpleCommentText(svg, annotation.text, x, y, width, height);
        return;
      }
      
      // Handle legacy comment field for write actions
      if (annotation.comment && annotation.comment.trim()) {
        this.addSimpleCommentText(svg, annotation.comment, x, y, width, height);
      }
      
      // Add visual marks
      switch (annotation.action) {
        case 'tick':
          svg += `<text x="${centerX}" y="${centerY}" fill="green" font-family="Arial" font-size="40" text-anchor="middle">✔</text>`;
          break;
        case 'cross':
          svg += `<text x="${centerX}" y="${centerY}" fill="red" font-family="Arial" font-size="40" text-anchor="middle">✗</text>`;
          break;
        case 'circle':
          const radius = Math.max(width, height) / 2 + 5;
          svg += `<circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="none" stroke="red" stroke-width="3"/>`;
          break;
        case 'underline':
          svg += `<line x1="${x}" y1="${y + height + 5}" x2="${x + width}" y2="${y + height + 5}" stroke="red" stroke-width="3"/>`;
          break;
      }
    });
    
    svg += '</svg>';
    console.log('🔍 Simple SVG overlay created, length:', svg.length);
    
    return svg;
  }

  /**
   * Add simple comment text to SVG
   */
  private static addSimpleCommentText(
    svg: string, 
    comment: string, 
    x: number, 
    y: number, 
    width: number, 
    height: number
  ): void {
    const cleanComment = comment
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\')
      .replace(/\\mathrm\{([^}]*)\}/g, '$1')
      .replace(/\\approx/g, '≈')
      .replace(/\\mathrm/g, '')
      .replace(/\\text\{([^}]*)\}/g, '$1');
    
    const lines = cleanComment.split('\n');
    const commentX = x + width + 10;
    const startY = y + (height / 2) - ((lines.length - 1) * 30 / 2);
    
    lines.forEach((line, lineIndex) => {
      if (line.trim()) {
        const lineY = startY + (lineIndex * 30);
                 svg += `<text x="${commentX}" y="${lineY}" fill="green" font-family="Bradley Hand ITC, cursive, Arial, sans-serif" font-size="48" font-weight="900" text-anchor="start" dominant-baseline="middle">${line}</text>`;
      }
    });
  }

  /**
   * Validate SVG structure
   */
  private static validateSVG(svg: string): boolean {
    // Check for basic SVG structure
    if (!svg.includes('<svg') || !svg.includes('</svg>') || !svg.includes('xmlns=')) {
      console.error('🔍 Invalid SVG structure');
      return false;
    }
    
    // Check for common XML issues - more sophisticated ampersand detection
    const ampersandRegex = /&(?!amp;|lt;|gt;|quot;|#39;|#x[0-9a-fA-F]+;)/g;
    if (ampersandRegex.test(svg)) {
      console.error('🔍 Unescaped ampersands detected in SVG');
      return false;
    }
    
    // Additional validation
    if (svg.length < 100) {
      console.error('🔍 SVG too short, likely invalid');
      return false;
    }
    
    return true;
  }
}
