/**
 * Create a simple test image for testing
 */

const fs = require('fs');

// Create a simple 1x1 pixel PNG image in base64
const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

// Convert to buffer and save
const imageBuffer = Buffer.from(testImageBase64, 'base64');
fs.writeFileSync('/Users/ytwong/github/intellimark/test-image.png', imageBuffer);

console.log('✅ Test image created: test-image.png');
console.log(`📊 Image size: ${imageBuffer.length} bytes`);

