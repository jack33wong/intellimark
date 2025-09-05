"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIServiceError = exports.OCRServiceError = exports.ImageProcessingError = void 0;
class ImageProcessingError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'ImageProcessingError';
        this.code = code;
    }
}
exports.ImageProcessingError = ImageProcessingError;
class OCRServiceError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'OCRServiceError';
        this.code = code;
    }
}
exports.OCRServiceError = OCRServiceError;
class AIServiceError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'AIServiceError';
        this.code = code;
    }
}
exports.AIServiceError = AIServiceError;
