// Debug the specific line splitting issue
const testText = '2x1 + c = 0\nc = -2 5n ^ ( 2 ) + 2n - 2';

console.log('🔍 Debugging line splitting issue:');
console.log('Raw text:', JSON.stringify(testText));
console.log('Contains \\n:', testText.includes('\n'));

const textLines = testText.split('\n').filter(t => t.trim().length > 0);
console.log('Split lines:', textLines);
console.log('Number of lines:', textLines.length);

textLines.forEach((line, index) => {
  console.log(`Line ${index + 1}: "${line}" (length: ${line.length})`);
});

// Test the exact splitting logic from main flow
const lines = [{
  x: 261,
  y: 810,
  width: 423,
  height: 241,
  text: testText,
  confidence: 0
}];

const splitLines: Array<{ x: number; y: number; width: number; height: number; text: string; confidence: number }> = [];

for (const line of lines) {
  const textLines = line.text.split('\n').filter(t => t.trim().length > 0);
  
  console.log(`\n🔍 Processing line: "${line.text}"`);
  console.log(`   - Contains \\n: ${line.text.includes('\n')}`);
  console.log(`   - Split into ${textLines.length} lines:`, textLines);
  
  if (textLines.length === 1) {
    splitLines.push(line);
    console.log(`   - Single line, keeping as is`);
  } else {
    console.log(`   - Multi-line, splitting vertically`);
    const lineHeight = line.height / textLines.length;
    const avgCharWidth = line.width / line.text.length;
    
    textLines.forEach((text, index) => {
      const estimatedWidth = Math.min(line.width, text.length * avgCharWidth);
      const splitLine = {
        x: line.x,
        y: line.y + (index * lineHeight),
        width: estimatedWidth,
        height: lineHeight,
        text: text.trim(),
        confidence: line.confidence
      };
      console.log(`   - Split line ${index + 1}: "${text.trim()}" [${splitLine.x}, ${splitLine.y}, ${splitLine.width}, ${splitLine.height}]`);
      splitLines.push(splitLine);
    });
  }
}

console.log(`\n✅ Final result: ${splitLines.length} lines`);
splitLines.forEach((line, index) => {
  console.log(`  ${index + 1}. "${line.text}" [${line.x}, ${line.y}, ${line.width}, ${line.height}]`);
});
