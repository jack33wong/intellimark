/**
 * Core type definitions for the Mark Homework System
 */
// Error types
export class ImageProcessingError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'ImageProcessingError';
        this.code = code;
    }
}
export class OCRServiceError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'OCRServiceError';
        this.code = code;
    }
}
export class AIServiceError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'AIServiceError';
        this.code = code;
    }
}
