"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImageAnnotationService = void 0;
const svgOverlayService_1 = require("./svgOverlayService");
class ImageAnnotationService {
    static createSVGOverlay(annotations, imageDimensions) {
        if (!annotations || annotations.length === 0) {
            return '';
        }
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${imageDimensions.width}" height="${imageDimensions.height}" style="position: absolute; top: 0; left: 0; pointer-events: none;">`;
        annotations.forEach((annotation, index) => {
            if (annotation.comment) {
                svg += this.createCommentAnnotation(annotation, imageDimensions, index);
            }
        });
        return svg + '</svg>';
    }
    static createCommentAnnotation(annotation, _imageDimensions, index) {
        if (!annotation.comment)
            return '';
        const commentText = this.breakTextIntoLines(annotation.comment, 50);
        let svg = '';
        const textWidth = this.estimateTextWidth(annotation.comment, 24);
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
    static breakTextIntoLines(text, maxCharsPerLine) {
        if (!text || text.length <= maxCharsPerLine) {
            return [text];
        }
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        words.forEach(word => {
            if ((currentLine + word).length <= maxCharsPerLine) {
                currentLine += (currentLine ? ' ' : '') + word;
            }
            else {
                if (currentLine)
                    lines.push(currentLine);
                currentLine = word;
            }
        });
        if (currentLine)
            lines.push(currentLine);
        return lines;
    }
    static estimateTextWidth(text, fontSize) {
        return text.length * fontSize * 0.6;
    }
    static escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    static calculateCommentPosition(boundingBox, imageDimensions, commentLength) {
        const commentWidth = this.estimateTextWidth('A'.repeat(Math.min(commentLength, 50)), 24);
        const commentHeight = Math.ceil(commentLength / 50) * 28.8;
        let x = boundingBox.x + boundingBox.width + 10;
        let y = boundingBox.y + boundingBox.height / 2;
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
    static createAnnotationsFromBoundingBoxes(boundingBoxes) {
        return boundingBoxes.map((box, index) => {
            const comment = `Text ${index + 1}: ${box.text}`;
            return {
                action: 'comment',
                bbox: [box.x, box.y, box.width, box.height],
                comment
            };
        });
    }
    static validateAnnotationPosition(annotation, imageDimensions) {
        if (!annotation.comment)
            return false;
        const commentWidth = this.estimateTextWidth(annotation.comment, 24);
        const commentHeight = this.breakTextIntoLines(annotation.comment, 50).length * 28.8;
        return (annotation.bbox[0] >= 0 &&
            annotation.bbox[1] >= 0 &&
            annotation.bbox[0] + commentWidth <= imageDimensions.width &&
            annotation.bbox[1] + commentHeight <= imageDimensions.height);
    }
    static async generateAnnotationResult(originalImage, annotations, imageDimensions) {
        try {
            console.log('🔥 Generating annotation result with burned overlays...');
            const svgOverlay = this.createSVGOverlay(annotations, imageDimensions);
            const burnedImage = await svgOverlayService_1.SVGOverlayService.burnSVGOverlayServerSide(originalImage, annotations, imageDimensions);
            const imageAnnotations = annotations.map(ann => ({
                position: { x: ann.bbox[0], y: ann.bbox[1] },
                comment: ann.comment || '',
                hasComment: !!ann.comment,
                boundingBox: {
                    x: ann.bbox[0],
                    y: ann.bbox[1],
                    width: ann.bbox[2],
                    height: ann.bbox[3],
                    text: ann.comment || ''
                }
            }));
            console.log('✅ Successfully generated annotation result with burned image');
            return {
                originalImage,
                annotatedImage: burnedImage,
                annotations: imageAnnotations,
                svgOverlay
            };
        }
        catch (error) {
            console.error('❌ Failed to generate annotation result:', error);
            const svgOverlay = this.createSVGOverlay(annotations, imageDimensions);
            const imageAnnotations = annotations.map(ann => ({
                position: { x: ann.bbox[0], y: ann.bbox[1] },
                comment: ann.comment || '',
                hasComment: !!ann.comment,
                boundingBox: {
                    x: ann.bbox[0],
                    y: ann.bbox[1],
                    width: ann.bbox[2],
                    height: ann.bbox[3],
                    text: ann.comment || ''
                }
            }));
            return {
                originalImage,
                annotatedImage: originalImage,
                annotations: imageAnnotations,
                svgOverlay
            };
        }
    }
    static getAnnotationStats(annotations) {
        const totalAnnotations = annotations.length;
        const totalComments = annotations.filter(a => a.comment).length;
        const totalCommentLength = annotations
            .filter(a => a.comment)
            .reduce((sum, a) => sum + (a.comment?.length || 0), 0);
        return {
            totalAnnotations,
            totalComments,
            averageCommentLength: totalComments > 0 ? totalCommentLength / totalComments : 0
        };
    }
}
exports.ImageAnnotationService = ImageAnnotationService;
