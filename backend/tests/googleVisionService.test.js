const { GoogleVisionService } = require('../services/googleVisionService');
const path = require('path');

describe('GoogleVisionService', () => {
  let visionService;
  const testImagePath = path.join(__dirname, 'test4.png');

  beforeAll(() => {
    visionService = new GoogleVisionService();
  });

  describe('recognizeHandwriting', () => {
    test('should recognize handwriting in test image', async () => {
      // Skip test if Google Cloud credentials are not available
      if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_CLOUD_PROJECT) {
        console.log('⚠️ Skipping Google Vision test - credentials not configured');
        return;
      }

      const result = await visionService.recognizeHandwriting(testImagePath);
      
      // The result should be either a string (if text detected) or null (if no text)
      expect(result === null || typeof result === 'string').toBe(true);
      
      if (result) {
        expect(result.length).toBeGreaterThan(0);
        console.log('Detected text:', result);
      }
    }, 30000); // 30 second timeout for API call

    test('should handle non-existent file gracefully', async () => {
      const nonExistentPath = path.join(__dirname, 'non-existent.png');
      
      await expect(visionService.recognizeHandwriting(nonExistentPath))
        .rejects
        .toThrow();
    });
  });

  describe('recognizeText', () => {
    test('should recognize text in test image', async () => {
      // Skip test if Google Cloud credentials are not available
      if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_CLOUD_PROJECT) {
        console.log('⚠️ Skipping Google Vision test - credentials not configured');
        return;
      }

      const result = await visionService.recognizeText(testImagePath);
      
      // The result should be either a string (if text detected) or null (if no text)
      expect(result === null || typeof result === 'string').toBe(true);
      
      if (result) {
        expect(result.length).toBeGreaterThan(0);
        console.log('Detected text:', result);
      }
    }, 30000); // 30 second timeout for API call

    test('should handle non-existent file gracefully', async () => {
      const nonExistentPath = path.join(__dirname, 'non-existent.png');
      
      await expect(visionService.recognizeText(nonExistentPath))
        .rejects
        .toThrow();
    });
  });

  describe('getDetailedTextAnnotations', () => {
    test('should get detailed text annotations from test image', async () => {
      // Skip test if Google Cloud credentials are not available
      if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_CLOUD_PROJECT) {
        console.log('⚠️ Skipping Google Vision test - credentials not configured');
        return;
      }

      const result = await visionService.getDetailedTextAnnotations(testImagePath);
      
      if (result) {
        expect(result).toHaveProperty('text');
        expect(result).toHaveProperty('pages');
        expect(result).toHaveProperty('blocks');
        expect(typeof result.text).toBe('string');
        expect(Array.isArray(result.pages)).toBe(true);
        expect(Array.isArray(result.blocks)).toBe(true);
        
        console.log('Detailed annotations:', JSON.stringify(result, null, 2));
      } else {
        expect(result).toBeNull();
      }
    }, 30000); // 30 second timeout for API call

    test('should handle non-existent file gracefully', async () => {
      const nonExistentPath = path.join(__dirname, 'non-existent.png');
      
      await expect(visionService.getDetailedTextAnnotations(nonExistentPath))
        .rejects
        .toThrow();
    });
  });

  describe('integration test', () => {
    test('should work with real test image file', async () => {
      // Skip test if Google Cloud credentials are not available
      if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !process.env.GOOGLE_CLOUD_PROJECT) {
        console.log('⚠️ Skipping Google Vision integration test - credentials not configured');
        return;
      }

      // Test that the service can be instantiated and methods exist
      expect(visionService).toBeDefined();
      expect(typeof visionService.recognizeHandwriting).toBe('function');
      expect(typeof visionService.recognizeText).toBe('function');
      expect(typeof visionService.getDetailedTextAnnotations).toBe('function');

      // Test with the actual test image
      const handwritingResult = await visionService.recognizeHandwriting(testImagePath);
      const textResult = await visionService.recognizeText(testImagePath);
      const detailedResult = await visionService.getDetailedTextAnnotations(testImagePath);

      console.log('=== Integration Test Results ===');
      console.log('Handwriting recognition:', handwritingResult);
      console.log('Text recognition:', textResult);
      console.log('Detailed annotations available:', detailedResult !== null);
      console.log('================================');
    }, 60000); // 60 second timeout for full integration test
  });
});
