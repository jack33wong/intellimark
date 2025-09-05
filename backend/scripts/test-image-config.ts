import { getImageStorageConfig, validateFileSize, getFileSizeMB } from '../config/imageStorage';

/**
 * Test script for image storage configuration
 */
function testImageConfig() {
  console.log('🧪 Testing Image Storage Configuration');
  console.log('=====================================');
  
  const config = getImageStorageConfig();
  
  console.log('📋 Current Configuration:');
  console.log(`  Max file size: ${config.maxFileSizeMB}MB`);
  console.log(`  Max dimensions: ${config.maxWidth}x${config.maxHeight}`);
  console.log(`  Compression quality: ${config.compressionQuality}%`);
  console.log(`  Compression enabled: ${config.enableCompression}`);
  console.log(`  Bucket name: ${config.bucketName}`);
  console.log(`  Content type: ${config.defaultContentType}`);
  console.log(`  Filename prefix: ${config.filenamePrefix}`);
  console.log(`  Filename suffix: ${config.filenameSuffix}`);
  
  console.log('\n🔍 Size Validation Tests:');
  
  // Test different buffer sizes
  const testSizes = [0.5, 5, 10, 15, 20]; // MB
  
  testSizes.forEach(sizeMB => {
    const bufferSize = Math.floor(sizeMB * 1024 * 1024);
    const testBuffer = Buffer.alloc(bufferSize);
    const isValid = validateFileSize(testBuffer, config);
    const actualSize = getFileSizeMB(testBuffer);
    
    console.log(`  ${actualSize.toFixed(2)}MB: ${isValid ? '✅ Valid' : '❌ Too large'}`);
  });
  
  console.log('\n✅ Configuration test completed!');
}

// Run the test
testImageConfig();
