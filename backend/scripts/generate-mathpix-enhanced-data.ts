import fs from 'fs/promises';
import path from 'path';

// This script generates pre-processed data that includes Mathpix results
// to make the test representative of the real production flow

const TEST_CONFIG = {
  inputJsonPath: 'debug-images/filtered-google-vision-blocks.json',
  outputJsonPath: 'debug-images/mathpix-enhanced-blocks.json',
  imagePath: 'scripts/IMG_1596.jpg'
};

// Mock Mathpix results based on the actual blocks
const MOCK_MATHPIX_RESULTS = {
  '= 49.5': {
    latex_styled: '= 49.5',
    confidence: 0.95,
    source: 'mathpix'
  },
  'π2x7² = 1594385': {
    latex_styled: '\\pi \\cdot 2 \\cdot 7^2 = 1594.385',
    confidence: 0.92,
    source: 'mathpix'
  },
  '11x7 = 77': {
    latex_styled: '11 \\times 7 = 77',
    confidence: 0.98,
    source: 'mathpix'
  },
  '9 x 7 = 63': {
    latex_styled: '9 \\times 7 = 63',
    confidence: 0.97,
    source: 'mathpix'
  },
  '63+ 49.5 + 77.5 = 147.4': {
    latex_styled: '63 + 49.5 + 77.5 = 147.4',
    confidence: 0.94,
    source: 'mathpix'
  },
  '186.15 £': {
    latex_styled: '£186.15',
    confidence: 0.89,
    source: 'mathpix'
  },
  '10.95': {
    latex_styled: '10.95',
    confidence: 0.96,
    source: 'mathpix'
  },
  '14': {
    latex_styled: '14',
    confidence: 0.99,
    source: 'mathpix'
  },
  '7m': {
    latex_styled: '7\\text{ m}',
    confidence: 0.88,
    source: 'mathpix'
  },
  '38.5': {
    latex_styled: '38.5',
    confidence: 0.93,
    source: 'mathpix'
  },
  '228': {
    latex_styled: '228',
    confidence: 0.91,
    source: 'mathpix'
  },
  '17': {
    latex_styled: '17',
    confidence: 0.97,
    source: 'mathpix'
  },
  '159.4385': {
    latex_styled: '159.4385',
    confidence: 0.94,
    source: 'mathpix'
  },
  '24.5': {
    latex_styled: '24.5',
    confidence: 0.92,
    source: 'mathpix'
  },
  'π * 7^2 = 159.438': {
    latex_styled: '\\pi \\cdot 7^2 = 159.438',
    confidence: 0.93,
    source: 'mathpix'
  },
  'πx = 1594': {
    latex_styled: '\\pi x = 1594',
    confidence: 0.90,
    source: 'mathpix'
  },
  '147.4': {
    latex_styled: '147.4',
    confidence: 0.95,
    source: 'mathpix'
  }
};

function isMathBlock(text: string): boolean {
  const mathPatterns = [
    /[\d+\-×÷=√²³π]/,
    /\d+\s*[+\-×÷=]\s*\d+/,
    /[a-zA-Z]\s*=\s*\d+/,
    /[£$€]/,
    /\d+\.\d+/,
    /[a-zA-Z]\d+/
  ];
  
  return mathPatterns.some(pattern => pattern.test(text));
}

function findMathpixResult(text: string): any {
  // Try exact match first
  if (MOCK_MATHPIX_RESULTS[text]) {
    return MOCK_MATHPIX_RESULTS[text];
  }
  
  // Try partial matches
  for (const [key, result] of Object.entries(MOCK_MATHPIX_RESULTS)) {
    if (text.includes(key) || key.includes(text)) {
      return result;
    }
  }
  
  // Default fallback
  return {
    latex_styled: text,
    confidence: 0.85,
    source: 'mathpix'
  };
}

async function generateMathpixEnhancedData() {
  console.log('🎯 [GENERATE] Mathpix Enhanced Data Generator');
  console.log('===============================================');
  
  try {
    // Load the filtered blocks
    console.log('📂 [LOAD] Loading filtered blocks...');
    const jsonData = await fs.readFile(TEST_CONFIG.inputJsonPath, 'utf-8');
    const blocks = JSON.parse(jsonData);
    
    console.log(`✅ [LOAD] Loaded ${blocks.length} filtered blocks`);
    
    // Process each block to identify math blocks and add Mathpix results
    const enhancedBlocks = blocks.map(block => {
      const text = block.text || block.description || '';
      const isMath = isMathBlock(text);
      
      if (isMath) {
        const mathpixResult = findMathpixResult(text);
        return {
          ...block,
          mathpixLatex: mathpixResult.latex_styled,
          mathpixConfidence: mathpixResult.confidence,
          source: 'mathpix',
          isMathBlock: true
        };
      } else {
        return {
          ...block,
          source: 'pass_A_clean_scan',
          isMathBlock: false
        };
      }
    });
    
    // Count math blocks
    const mathBlocks = enhancedBlocks.filter(block => block.isMathBlock);
    console.log(`🔍 [MATH] Identified ${mathBlocks.length} math blocks`);
    console.log(`📊 [MATH] Math blocks:`, mathBlocks.map(b => b.text).slice(0, 5));
    
    // Save enhanced data
    await fs.writeFile(TEST_CONFIG.outputJsonPath, JSON.stringify(enhancedBlocks, null, 2));
    console.log(`💾 [SAVE] Saved enhanced data to ${TEST_CONFIG.outputJsonPath}`);
    
    // Show sample results
    console.log('\n📝 [SAMPLE ENHANCED BLOCKS]:');
    enhancedBlocks.slice(0, 5).forEach((block, index) => {
      console.log(`  Block ${index + 1}:`, {
        text: block.text,
        isMath: block.isMathBlock,
        latex: block.mathpixLatex || 'N/A',
        confidence: block.mathpixConfidence || 'N/A'
      });
    });
    
    console.log('\n✅ [GENERATE] Mathpix enhanced data generation completed!');
    
  } catch (error) {
    console.error('❌ [GENERATE] Failed:', error);
    process.exit(1);
  }
}

// Run the generator
generateMathpixEnhancedData();






