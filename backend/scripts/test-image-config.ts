import { getImageStorageConfig, validateFileSize, getFileSizeMB } from '../config/imageStorage.js';

/**
 * Test script for image storage configuration
 */
function testImageConfig() {
  
  const config = getImageStorageConfig();
  
  
  
  // Test different buffer sizes
  const testSizes = [0.5, 5, 10, 15, 20]; // MB
  
  testSizes.forEach(sizeMB => {
    const bufferSize = Math.floor(sizeMB * 1024 * 1024);
    const testBuffer = Buffer.alloc(bufferSize);
    const isValid = validateFileSize(testBuffer, config);
    const actualSize = getFileSizeMB(testBuffer);
    
  });
  
}

// Run the test
testImageConfig();
