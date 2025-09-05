import sharp from 'sharp';
export class SVGOverlayService {
    static async burnSVGOverlayServerSide(originalImageData, annotations, imageDimensions) {
        try {
            console.log('🔥 Burning SVG overlay server-side with Sharp...');
            console.log('🔍 Image dimensions:', imageDimensions);
            console.log('🔍 Annotations count:', annotations.length);
            console.log('🔍 First annotation bbox:', annotations[0]?.bbox);
            if (!annotations || annotations.length === 0) {
                console.log('🔍 No annotations to burn, returning original image');
                return originalImageData;
            }
            const base64Data = originalImageData.replace(/^data:image\/[a-z]+;base64,/, '');
            const imageBuffer = Buffer.from(base64Data, 'base64');
            const imageMetadata = await sharp(imageBuffer).metadata();
            const originalWidth = imageMetadata.width || imageDimensions.width;
            const originalHeight = imageMetadata.height || imageDimensions.height;
            console.log('🔍 Original image dimensions:', originalWidth, 'x', originalHeight);
            console.log('🔍 Provided image dimensions:', imageDimensions.width, 'x', imageDimensions.height);
            const burnWidth = originalWidth;
            const burnHeight = originalHeight;
            console.log('🔍 Burning at original dimensions:', burnWidth, 'x', burnHeight);
            const svgOverlay = this.createSVGOverlay(annotations, burnWidth, burnHeight, imageDimensions);
            const svgBuffer = Buffer.from(svgOverlay);
            const burnedImageBuffer = await sharp(imageBuffer)
                .composite([
                {
                    input: svgBuffer,
                    top: 0,
                    left: 0
                }
            ])
                .png()
                .toBuffer();
            const burnedImageData = `data:image/png;base64,${burnedImageBuffer.toString('base64')}`;
            console.log('✅ Successfully burned SVG overlay server-side');
            console.log('🔍 Original size:', imageBuffer.length, 'bytes');
            console.log('🔍 Burned size:', burnedImageBuffer.length, 'bytes');
            return burnedImageData;
        }
        catch (error) {
            console.error('❌ Failed to burn SVG overlay server-side:', error);
            throw new Error(`Failed to burn SVG overlay: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
    static createSVGOverlay(annotations, actualWidth, actualHeight, originalDimensions) {
        if (!annotations || annotations.length === 0) {
            return '';
        }
        console.log('🔍 Creating SVG overlay with dimensions:', actualWidth, 'x', actualHeight);
        console.log('🔍 Original dimensions:', originalDimensions.width, 'x', originalDimensions.height);
        const scaleX = actualWidth / originalDimensions.width;
        const scaleY = actualHeight / originalDimensions.height;
        console.log('🔍 Scaling factors:', { scaleX, scaleY });
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${actualWidth}" height="${actualHeight}" viewBox="0 0 ${actualWidth} ${actualHeight}">`;
        annotations.forEach((annotation, index) => {
            svg += this.createAnnotationSVG(annotation, index, scaleX, scaleY);
        });
        return svg + '</svg>';
    }
    static createAnnotationSVG(annotation, index, scaleX, scaleY) {
        const [x, y, width, height] = annotation.bbox;
        const action = annotation.action || 'comment';
        const comment = annotation.comment || '';
        const scaledX = x * scaleX;
        const scaledY = y * scaleY;
        const scaledWidth = width * scaleX;
        const scaledHeight = height * scaleY;
        console.log(`🔍 Annotation ${index + 1}: Original(${x}, ${y}, ${width}, ${height}) -> Scaled(${scaledX}, ${scaledY}, ${scaledWidth}, ${scaledHeight})`);
        let svg = '';
        switch (action) {
            case 'tick':
                svg += this.createTickAnnotation(scaledX, scaledY, scaledWidth, scaledHeight);
                break;
            case 'cross':
                svg += this.createCrossAnnotation(scaledX, scaledY, scaledWidth, scaledHeight);
                break;
            case 'circle':
                svg += this.createCircleAnnotation(scaledX, scaledY, scaledWidth, scaledHeight);
                break;
            case 'underline':
                svg += this.createUnderlineAnnotation(scaledX, scaledY, scaledWidth, scaledHeight);
                break;
            case 'comment':
            default:
                svg += this.createCommentAnnotation(scaledX, scaledY, scaledWidth, scaledHeight, comment, scaleX, scaleY);
                break;
        }
        return svg;
    }
    static createTickAnnotation(x, y, width, height) {
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const fontSize = Math.max(12, Math.min(width, height) * 1.04);
        return `
      <text x="${centerX}" y="${centerY + fontSize / 3}" text-anchor="middle" fill="#ff0000" 
            font-family="Arial, sans-serif" font-size="${fontSize}" font-weight="bold">✔</text>`;
    }
    static createCrossAnnotation(x, y, width, height) {
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const size = Math.min(width, height) * 0.8;
        const strokeWidth = Math.max(6, Math.min(width, height) * 0.2);
        return `
      <g stroke="#ff0000" stroke-width="${strokeWidth}" fill="none" opacity="0.8">
        <line x1="${centerX - size / 2}" y1="${centerY - size / 2}" x2="${centerX + size / 2}" y2="${centerY + size / 2}" stroke-linecap="round"/>
        <line x1="${centerX + size / 2}" y1="${centerY - size / 2}" x2="${centerX - size / 2}" y2="${centerY + size / 2}" stroke-linecap="round"/>
      </g>`;
    }
    static createCircleAnnotation(x, y, width, height) {
        const centerX = x + width / 2;
        const centerY = y + height / 2;
        const radius = Math.min(width, height) * 0.4;
        const strokeWidth = Math.max(6, Math.min(width, height) * 0.2);
        return `<circle cx="${centerX}" cy="${centerY}" r="${radius}" 
            fill="none" stroke="#ffaa00" stroke-width="${strokeWidth}" opacity="0.8"/>`;
    }
    static createUnderlineAnnotation(x, y, width, height) {
        const underlineY = y + height - Math.max(3, height * 0.1);
        const strokeWidth = Math.max(6, Math.min(width, height) * 0.2);
        return `<line x1="${x}" y1="${underlineY}" x2="${x + width}" y2="${underlineY}" 
            stroke="#0066ff" stroke-width="${strokeWidth}" opacity="0.8" stroke-linecap="round"/>`;
    }
    static createCommentAnnotation(x, y, width, height, comment, scaleX, scaleY) {
        if (!comment)
            return '';
        const commentX = x;
        const commentY = Math.max(25 * scaleY, y - 10 * scaleY);
        const textFontSize = 18 * Math.min(scaleX, scaleY) * 2.1;
        return `<text x="${commentX}" y="${commentY - 4 * scaleY}" fill="#ff4444" 
            font-family="'Comic Neue', 'Comic Sans MS', 'Lucida Handwriting', cursive, Arial, sans-serif" 
            font-size="${textFontSize}" font-weight="bold" 
            opacity="0.9">${comment}</text>`;
    }
}
