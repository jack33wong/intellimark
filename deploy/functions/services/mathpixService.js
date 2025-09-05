class OCRServiceError extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'OCRServiceError';
        this.code = code;
    }
}
const API_URL = 'https://api.mathpix.com/v3/text';
const APP_ID = process.env['MATHPIX_APP_ID'] || 'tutor_app';
export class MathpixService {
    static initialize(apiKey) {
        this.apiKey = apiKey || process.env['MATHPIX_API_KEY'];
    }
    static isAvailable() {
        if (!this.apiKey) {
            this.apiKey = process.env['MATHPIX_API_KEY'];
        }
        return !!this.apiKey;
    }
    static async processImage(imageData) {
        try {
            if (!this.isAvailable()) {
                throw new OCRServiceError('Mathpix API key not configured', 'MISSING_API_KEY');
            }
            console.log('🔍 ===== MATHPIX OCR STARTING =====');
            const rawResult = await this.callMathpixAPI(imageData);
            return this.processMathpixResults(rawResult);
        }
        catch (error) {
            if (error instanceof OCRServiceError) {
                throw error;
            }
            throw new OCRServiceError(`OCR processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 'PROCESSING_FAILED');
        }
    }
    static async callMathpixAPI(imageData) {
        console.log('🔍 ===== MATHPIX OCR STARTING =====');
        console.log('🔍 Image data length:', imageData.length);
        console.log('🔍 Image format:', imageData.substring(0, 30) + '...');
        const requestBody = {
            src: imageData,
            formats: ["text", "data"],
            "include_word_data": true
        };
        console.log('🔍 Sending request to Mathpix API...');
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'app_id': APP_ID,
                'app_key': this.apiKey
            },
            body: JSON.stringify(requestBody)
        });
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
            throw new Error(`Mathpix API error: ${response.status} ${response.statusText} - ${errorData.error || 'Unknown error'}`);
        }
        const result = await response.json();
        console.log('🔍 DEBUG: result.text exists:', !!result.text);
        console.log('🔍 DEBUG: result.text length:', result.text ? result.text.length : 'undefined');
        console.log('🔍 DEBUG: result.text preview:', result.text ? result.text.substring(0, 100) + '...' : 'undefined');
        console.log('🔍 DEBUG: result.word_data exists:', !!result.word_data);
        console.log('🔍 DEBUG: result.word_data is array:', Array.isArray(result.word_data));
        console.log('🔍 DEBUG: result.word_data length:', result.word_data ? result.word_data.length : 'undefined');
        if (result.word_data && Array.isArray(result.word_data) && result.word_data.length > 0) {
            console.log('🔍 DEBUG: First word_data item:', JSON.stringify(result.word_data[0], null, 2));
        }
        return result;
    }
    static processMathpixResults(rawResult) {
        try {
            let text = rawResult.text || '';
            if (!text && rawResult.word_data && Array.isArray(rawResult.word_data)) {
                text = this.extractTextFromWordData(rawResult.word_data);
                console.log('🔍 DEBUG: Constructed text from word_data, length:', text.length);
            }
            console.log('🔍 DEBUG: extracted text length:', text.length);
            console.log('🔍 DEBUG: extracted text preview:', text.substring(0, 100) + '...');
            const boundingBoxes = this.extractBoundingBoxes(rawResult);
            const confidence = this.calculateOverallConfidence(rawResult);
            const dimensions = this.extractImageDimensions(rawResult);
            console.log('🔍 ===== MATHPIX OCR COMPLETED =====');
            console.log(`🔍 Text length: ${text.length} characters`);
            console.log(`🔍 Text preview: "${text.substring(0, 100)}..."`);
            console.log(`🔍 Confidence: ${(confidence * 100).toFixed(2)}%`);
            console.log(`🔍 Bounding boxes: ${boundingBoxes.length}`);
            return {
                text,
                boundingBoxes,
                confidence,
                dimensions
            };
        }
        catch (error) {
            console.error('🔍 Error processing Mathpix results:', error);
            throw new OCRServiceError(`Failed to process Mathpix results: ${error instanceof Error ? error.message : 'Unknown error'}`, 'RESULT_PROCESSING_FAILED');
        }
    }
    static extractBoundingBoxes(rawResult) {
        const boundingBoxes = [];
        try {
            if (rawResult.word_data && Array.isArray(rawResult.word_data)) {
                rawResult.word_data.forEach((item) => {
                    if (item.cnt && Array.isArray(item.cnt) && item.cnt.length > 0) {
                        const text = item.text || '';
                        if (!this.isLatexLine(text)) {
                            return;
                        }
                        const points = item.cnt;
                        const rawX = Math.min(...points.map((p) => p[0] || 0));
                        const rawY = Math.min(...points.map((p) => p[1] || 0));
                        const rawWidth = Math.max(...points.map((p) => p[0] || 0)) - rawX;
                        const rawHeight = Math.max(...points.map((p) => p[1] || 0)) - rawY;
                        const x = Math.round(rawX);
                        const y = Math.round(rawY) - 20;
                        const width = Math.round(rawWidth);
                        const height = Math.round(rawHeight) - 20;
                        console.log('🔍 Bounding box coordinates:', {
                            raw: { x: rawX, y: rawY, width: rawWidth, height: rawHeight },
                            final: { x, y, width, height },
                            text: item.text.substring(0, 30) + '...'
                        });
                        boundingBoxes.push({
                            x: Math.max(0, x),
                            y: Math.max(0, y),
                            width: Math.max(1, width),
                            height: Math.max(1, height),
                            text: item.text || 'Unidentified text/diagram/graph/etc.',
                            confidence: item.confidence || 0.8
                        });
                    }
                });
            }
            if (boundingBoxes.length === 0 && rawResult.data && Array.isArray(rawResult.data)) {
                rawResult.data.forEach(item => {
                    if (item.bbox && Array.isArray(item.bbox) && item.bbox.length === 4) {
                        const [x, y, width, height] = item.bbox;
                        boundingBoxes.push({
                            x: Math.max(0, x),
                            y: Math.max(0, y),
                            width: Math.max(1, width),
                            height: Math.max(1, height),
                            text: item.value || '',
                            confidence: item.confidence || 0
                        });
                    }
                });
            }
            if (boundingBoxes.length === 0 && rawResult.text) {
                const lines = rawResult.text.split('\n').filter((line) => line.trim().length > 0);
                lines.forEach((line, index) => {
                    boundingBoxes.push({
                        x: 50,
                        y: 50 + (index * 30),
                        width: Math.max(line.length * 10, 100),
                        height: 25,
                        text: line,
                        confidence: 0.7
                    });
                });
            }
        }
        catch (error) {
            console.warn('🔍 Failed to extract bounding boxes from Mathpix response:', error);
        }
        return boundingBoxes;
    }
    static extractTextFromWordData(wordData) {
        try {
            const textParts = [];
            const sortedData = wordData
                .filter(item => item.text && typeof item.text === 'string')
                .sort((a, b) => {
                const aY = a.cnt && Array.isArray(a.cnt) ? Math.min(...a.cnt.map((p) => p[1] || 0)) : 0;
                const bY = b.cnt && Array.isArray(b.cnt) ? Math.min(...b.cnt.map((p) => p[1] || 0)) : 0;
                return aY - bY;
            });
            const lineGroups = {};
            sortedData.forEach(item => {
                if (item.cnt && Array.isArray(item.cnt)) {
                    const y = Math.min(...item.cnt.map((p) => p[1] || 0));
                    const lineKey = Math.round(y / 20) * 20;
                    if (!lineGroups[lineKey]) {
                        lineGroups[lineKey] = [];
                    }
                    lineGroups[lineKey].push(item);
                }
            });
            Object.keys(lineGroups)
                .sort((a, b) => parseInt(a) - parseInt(b))
                .forEach(lineKey => {
                const lineItems = lineGroups[lineKey];
                lineItems.sort((a, b) => {
                    const aX = a.cnt && Array.isArray(a.cnt) ? Math.min(...a.cnt.map((p) => p[0] || 0)) : 0;
                    const bX = b.cnt && Array.isArray(b.cnt) ? Math.min(...b.cnt.map((p) => p[0] || 0)) : 0;
                    return aX - bX;
                });
                lineItems.forEach(item => {
                    if (item.text && typeof item.text === 'string') {
                        textParts.push(item.text);
                    }
                });
                textParts.push('\n');
            });
            const fullText = textParts.join(' ').trim();
            console.log('🔍 DEBUG: Extracted text from word_data:', fullText.substring(0, 100) + '...');
            return fullText;
        }
        catch (error) {
            console.warn('🔍 Failed to extract text from word_data:', error);
            return '';
        }
    }
    static isLatexLine(text) {
        if (!text || typeof text !== 'string')
            return false;
        const latexPatterns = [
            /\\[a-zA-Z]+/,
            /\\[{}[\]]/,
            /\\left|\\right/,
            /\\[a-zA-Z]+\{[^}]*\}/,
            /\$[^$]+\$/,
            /\\\([^)]*\\\)/,
            /\\[a-zA-Z]+\([^)]*\)/,
            /[a-zA-Z]+\^[a-zA-Z0-9]/,
            /[a-zA-Z]+_[a-zA-Z0-9]/,
            /\\frac\{[^}]*\}\{[^}]*\}/,
            /\\sqrt\{[^}]*\}/,
            /\\sum|\\int|\\prod/,
            /\\alpha|\\beta|\\gamma|\\delta|\\theta|\\pi|\\sigma/,
            /\\mathrm\{[^}]*\}/,
            /\\approx|\\approxeq|\\simeq/,
            /\\Rightarrow|\\Leftarrow|\\Leftrightarrow/,
            /\\cdot|\\times|\\div/,
            /\\sin|\\cos|\\tan/,
            /\\log|\\ln/,
            /\\exp/,
        ];
        return latexPatterns.some(pattern => pattern.test(text));
    }
    static calculateOverallConfidence(rawResult) {
        try {
            if (rawResult.data && Array.isArray(rawResult.data)) {
                const confidences = rawResult.data
                    .filter((item) => item.confidence !== undefined)
                    .map((item) => item.confidence);
                if (confidences.length > 0) {
                    const avgConfidence = confidences.reduce((sum, conf) => sum + conf, 0) / confidences.length;
                    return Math.min(avgConfidence, 1.0);
                }
            }
            if (rawResult.text && rawResult.text.length > 0) {
                return 0.8;
            }
            else if (rawResult.data && rawResult.data.length > 0) {
                return 0.6;
            }
            else {
                return 0.3;
            }
        }
        catch (error) {
            return 0.5;
        }
    }
    static extractImageDimensions(rawResult) {
        console.log('🔍 DEBUG: Raw result keys:', Object.keys(rawResult));
        console.log('🔍 DEBUG: Raw result width:', rawResult.width);
        console.log('🔍 DEBUG: Raw result height:', rawResult.height);
        let width = rawResult.width || 0;
        let height = rawResult.height || 0;
        if ((!width || !height) && rawResult.word_data && Array.isArray(rawResult.word_data)) {
            let maxX = 0;
            let maxY = 0;
            rawResult.word_data.forEach((item) => {
                if (item.cnt && Array.isArray(item.cnt)) {
                    item.cnt.forEach((point) => {
                        if (point[0] !== undefined && point[0] > maxX)
                            maxX = point[0];
                        if (point[1] !== undefined && point[1] > maxY)
                            maxY = point[1];
                    });
                }
            });
            if (maxX > 0 && maxY > 0) {
                width = maxX + 50;
                height = maxY + 50;
                console.log('🔍 DEBUG: Estimated dimensions from bounding boxes:', { width, height });
            }
        }
        if (!width || !height) {
            width = 800;
            height = 600;
            console.log('🔍 DEBUG: Using fallback dimensions:', { width, height });
        }
        console.log('🔍 DEBUG: Final dimensions:', { width, height });
        return { width, height };
    }
    static validateImageData(imageData) {
        if (!imageData || typeof imageData !== 'string') {
            return false;
        }
        if (!imageData.startsWith('data:image/')) {
            return false;
        }
        const base64Data = imageData.split(',')[1];
        if (!base64Data || base64Data.length < 1024) {
            return false;
        }
        return true;
    }
    static getServiceStatus() {
        return {
            available: this.isAvailable(),
            configured: !!this.apiKey,
            apiKeyPresent: !!process.env['MATHPIX_API_KEY']
        };
    }
    static async testConnectivity() {
        try {
            if (!this.isAvailable()) {
                return false;
            }
            const response = await fetch(API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'app_id': APP_ID,
                    'app_key': this.apiKey
                },
                body: JSON.stringify({
                    src: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
                    formats: ['text']
                })
            });
            return response.status === 200 || response.status === 400;
        }
        catch {
            return false;
        }
    }
    static async testConnection() {
        try {
            if (!this.isAvailable()) {
                return { available: false, error: 'Mathpix API key not configured' };
            }
            const testImage = Buffer.from([
                0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
                0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
                0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
                0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
                0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,
                0x54, 0x08, 0x99, 0x01, 0x01, 0x00, 0x00, 0x00,
                0xFF, 0xFF, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01,
                0xE2, 0x21, 0xBC, 0x33, 0x00, 0x00, 0x00, 0x00,
                0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
            ]);
            const testImageData = `data:image/png;base64,${testImage.toString('base64')}`;
            await this.processImage(testImageData);
            return { available: true };
        }
        catch (error) {
            return {
                available: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }
}
