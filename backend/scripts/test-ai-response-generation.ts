#!/usr/bin/env tsx

/**
 * Standalone AI Testing Service
 * 
 * This service allows you to test both AI response generation and marking instructions
 * with hardcoded input without needing the full web server. Perfect for prompt iteration and testing.
 * 
 * Usage:
 *   # Test AI Response Generation (Call #2) - Legacy - default model
 *   npm run test:ai-response
 *   tsx scripts/test-ai-response-generation.ts response
 *   
 *   # Test Model Answer Generation (Call #2) - New - default model
 *   tsx scripts/test-ai-response-generation.ts model-answer
 *   
 *   # Test Marking Instructions (Call #1) - default model
 *   tsx scripts/test-ai-response-generation.ts marking
 *   
 *   # Test Marking Scheme Formatting - shows clean bulleted format
 *   tsx scripts/test-ai-response-generation.ts format
 *   
 *   # Test both marking and model answer - default model
 *   tsx scripts/test-ai-response-generation.ts both
 *   
 *   # Test all four - default model
 *   tsx scripts/test-ai-response-generation.ts all
 *   
 *   # Use specific model (Gemini 2.5 Pro)
 *   tsx scripts/test-ai-response-generation.ts model-answer gemini-2.5-pro
 *   tsx scripts/test-ai-response-generation.ts marking gemini-2.5-pro
 *   tsx scripts/test-ai-response-generation.ts format gemini-2.5-pro
 *   tsx scripts/test-ai-response-generation.ts both gemini-2.5-pro
 *   tsx scripts/test-ai-response-generation.ts all gemini-2.5-pro
 *   
 *   # Available models: auto, gemini-2.5-flash, gemini-2.5-pro
 */

import { AIMarkingService } from '../services/aiMarkingService.js';
import { MarkingInstructionService } from '../services/ai/MarkingInstructionService.js';
import { ModelType } from '../types/index.js';
import { validateModel, getSupportedModels } from '../config/aiModels.js';
import { getPromptPaths, getPrompt } from '../config/prompts.js';

// Real production test data
const TEST_DATA = {
  // For AI Response Generation (Call #2) - processed OCR text format
  aiResponseInput: `Question: "Here are the first four terms of a quadratic sequence.
3 20 47 84
Work out an expression for the nth term of the sequence."

Diff = 17, 27, 37
2 Diff = 10
Construct = -2, 0
Diff = +2
b = 2
c = -2
5n^2 + 2n - 2`,

  // For Marking Instructions (Call #1) - raw OCR text with step IDs (matches production format)
  markingInstructionInput: `{"question":"Here are the first four terms of a quadratic sequence.\\n3   20   47   84\\nWork out an expression for the nth term of the sequence.","steps":[{"unified_step_id":"step_1","bbox":[391,411,602,85],"cleanedText":"Diff = 17, 27, 37"},{"unified_step_id":"step_2","bbox":[485,525,412,65],"cleanedText":"2 Diff = 10"},{"unified_step_id":"step_3","bbox":[372,634,640,76],"cleanedText":"Construct = -2, 0"},{"unified_step_id":"step_4","bbox":[529,739,331,71],"cleanedText":"Diff = +2"},{"unified_step_id":"step_5","bbox":[618,850,146,63],"cleanedText":"b = 2"},{"unified_step_id":"step_6","bbox":[602,962,169,62],"cleanedText":"c = -2"},{"unified_step_id":"step_7","bbox":[430,1067,514,75],"cleanedText":"5n^(2) + 2n - 2"}]}`,

  // For Model Answer Generation - clean question text
  questionText: `Here are the first four terms of a quadratic sequence.
3   20   47   84
Work out an expression for the nth term of the sequence.`
};

// Geometry test data for question detection only
const GEOMETRY_TEST_DATA = {
  // For Question Detection - clean question text only
  questionText: `The diagram shows a plan of Jason's garden.
ABCO and DEFO are rectangles.
CDO is a right-angled triangle.
AFO is a sector of a circle with centre O and angle AOF = 90°.

[Diagram description: A composite shape representing a garden plan. It consists of a rectangle ABCO with AB = 11m and BC = 7m. A rectangle DEFO with DE = 7m and EF = 9m. A right-angled triangle CDO. A sector of a circle AFO with centre O and angle AOF = 90°. The dimensions shown are AB = 11m, BC = 7m, EF = 9m, DE = 7m. Right angles are indicated at B, C, E, and at O for the sector AOF.]

Jason is going to cover his garden with grass seed.
Each bag of grass seed covers 14 m² of garden.
Each bag of grass seed costs £10.95

Work out how much it will cost Jason to buy all the bags of grass seed he needs.`
};

// Test configuration
const TEST_CONFIG = {
  model: 'gemini-2.5-flash' as ModelType, // Changed to Gemini 2.5 Flash
  debug: false, // Use real API calls
  useOcrText: true // This will use the OCR text prompt
};

async function testAIResponseGeneration() {
  console.log('🎯 [TEST] AI Response Generation (Call #2) - Legacy');
  console.log('=' .repeat(50));
  
  try {
    const result = await AIMarkingService.generateChatResponse(
      TEST_DATA.aiResponseInput,
      '',
      TEST_CONFIG.model,
      false, // isQuestionOnly
      TEST_CONFIG.debug,
      undefined, // onProgress
      TEST_CONFIG.useOcrText
    );
    
    console.log('🤖 [LEGACY RESPONSE]:', result.response);
    console.log('📊 [TOKENS USED]:', result.usageTokens);
    
  } catch (error) {
    console.error('❌ [AI RESPONSE TEST] Test failed:', error);
    throw error;
  }
}

async function testModelAnswer() {
  console.log('🎯 [TEST] Model Answer Generation (Call #2) - New');
  console.log('=' .repeat(50));
  
  try {
    // Show API details before making the call
    const { getModelConfig } = await import('../config/aiModels.js');
    const modelConfig = getModelConfig(TEST_CONFIG.model);
    
    console.log('🔗 [API URL]:', modelConfig.apiEndpoint);
    console.log('🤖 [MODEL]:', modelConfig.name);
    console.log('📊 [MAX TOKENS]:', modelConfig.maxTokens);
    console.log('🌡️ [TEMPERATURE]:', modelConfig.temperature);
    console.log('📋 [API VERSION]:', modelConfig.apiEndpoint.includes('/v1beta/') ? 'v1beta' : 'v1');
    console.log('=' .repeat(50));
    
    // Create mock marking scheme for model answer
    const mockMarkingScheme = JSON.stringify({
      "answer": "`$5n^2 + 2n - 4$`",
      "marks": [
        {
          "mark": "M1",
          "answer": "Finds second differences = `$10$` or `$a=5$` or `$5n^2$`.",
          "comments": ""
        },
        {
          "mark": "M1dep",
          "answer": "Subtracts `$5n^2$` from terms to find linear part, e.g., `$3 - 5(1^2) = -2$` and `$20 - 5(2^2)=0$` OR sets up simultaneous equations for a and b.",
          "comments": ""
        },
        {
          "mark": "M1dep",
          "answer": "Finds `$c=-4$` by substituting known `$a=5$` and `$b=2$`.",
          "comments": "e.g., `$5(1)^2 + 2(1) + c = 3$`."
        },
        {
          "mark": "A1",
          "answer": "`$5n^2 + 2n - 4$`",
          "comments": "oe, terms in any order."
        }
      ]
    });
    
    // Show the prompts being used
    const { getPrompt } = await import('../config/prompts.js');
    const systemPrompt = getPrompt('modelAnswer.system');
    const totalMarks = 4; // Mock total marks for testing
    const userPrompt = getPrompt('modelAnswer.user', TEST_DATA.questionText, mockMarkingScheme, totalMarks);
    
    console.log('🔍 [MODEL ANSWER] System Prompt:', systemPrompt);
    console.log('🔍 [MODEL ANSWER] User Prompt:', userPrompt);
    console.log('🔍 [MODEL ANSWER] Total Marks:', totalMarks);
    console.log('🔍 [MODEL ANSWER] Question Text:', TEST_DATA.questionText);
    console.log('=' .repeat(50));
    
    const result = await AIMarkingService.generateChatResponse(
      userPrompt, // Use the formatted user prompt
      systemPrompt, // Use the system prompt
      TEST_CONFIG.model,
      false, // isQuestionOnly
      TEST_CONFIG.debug,
      undefined, // onProgress
      true // useOcrText
    );
    
    console.log('🤖 [MODEL ANSWER]:', result.response);
    console.log('📊 [TOKENS USED]:', result.usageTokens);
    
  } catch (error) {
    console.error('❌ [MODEL ANSWER TEST] Test failed:', error);
    throw error;
  }
}

async function testMarkingSchemeFormatting() {
  console.log('🎯 [TEST] Marking Scheme Formatting');
  console.log('=' .repeat(50));
  
  try {
    // Import the formatting function
    const { getPrompt } = await import('../config/prompts.js');
    
    // Create mock marking scheme
    const mockMarkingScheme = JSON.stringify({
      "answer": "`$5n^2 + 2n - 4$`",
      "marks": [
        {
          "mark": "M1",
          "answer": "Finds second differences = `$10$` or `$a=5$` or `$5n^2$`.",
          "comments": ""
        },
        {
          "mark": "M1dep",
          "answer": "Subtracts `$5n^2$` from terms to find linear part, e.g., `$3 - 5(1^2) = -2$` and `$20 - 5(2^2)=0$` OR sets up simultaneous equations for a and b.",
          "comments": ""
        },
        {
          "mark": "M1dep",
          "answer": "Finds `$c=-4$` by substituting known `$a=5$` and `$b=2$`.",
          "comments": "e.g., `$5(1)^2 + 2(1) + c = 3$`."
        },
        {
          "mark": "A1",
          "answer": "`$5n^2 + 2n - 4$`",
          "comments": "oe, terms in any order."
        }
      ]
    });
    
    // Test the formatting by calling the model answer prompt
    const formattedPrompt = getPrompt('modelAnswer.user', TEST_DATA.questionText, mockMarkingScheme, 4);
    
    console.log('📋 [FORMATTED PROMPT WITH CLEAN BULLETS]:');
    console.log(formattedPrompt);
    
  } catch (error) {
    console.error('❌ [FORMATTING TEST] Test failed:', error);
    throw error;
  }
}

async function testMarkingInstructions() {
  console.log('🎯 [TEST] Marking Instructions (Call #1) - Algebra');
  console.log('=' .repeat(50));
  
  try {
    // Show API details before making the call
    const { getModelConfig } = await import('../config/aiModels.js');
    const modelConfig = getModelConfig(TEST_CONFIG.model); // Use the actual model being tested
    
    console.log('🔗 [API URL]:', modelConfig.apiEndpoint);
    console.log('🤖 [MODEL]:', modelConfig.name);
    console.log('📊 [MAX TOKENS]:', modelConfig.maxTokens);
    console.log('🌡️ [TEMPERATURE]:', modelConfig.temperature);
    console.log('📋 [API VERSION]:', modelConfig.apiEndpoint.includes('/v1beta/') ? 'v1beta' : 'v1');
    console.log('=' .repeat(50));
    
    // Prompts will be logged by the service itself
    
    // Create a mock questionDetection object with marking scheme to match production
    const mockQuestionDetection = {
      match: {
        marks: 4, // Add total marks
        markingScheme: {
          questionMarks: {
            "answer": "`$5n^2 + 2n - 4$`",
            "marks": [
              {
                "mark": "M1",
                "answer": "Finds second differences = `$10$` or `$a=5$` or `$5n^2$`.",
                "comments": ""
              },
              {
                "mark": "M1dep",
                "answer": "Subtracts `$5n^2$` from terms to find linear part, e.g., `$3 - 5(1^2) = -2$` and `$20 - 5(2^2)=0$` OR sets up simultaneous equations for a and b.",
                "comments": ""
              },
              {
                "mark": "M1dep",
                "answer": "Finds `$c=-4$` by substituting known `$a=5$` and `$b=2$`.",
                "comments": "e.g., `$5(1)^2 + 2(1) + c = 3$`."
              },
              {
                "mark": "A1",
                "answer": "`$5n^2 + 2n - 4$`",
                "comments": "oe, terms in any order."
              }
            ],
            "guidance": [
              {
                "scenario": "SC2 for `$a=5$` and `$c=-4$`.",
                "outcome": ""
              },
              {
                "scenario": "SC1 for `$c=-4$`.",
                "outcome": ""
              },
              {
                "scenario": "Second differences = `$10$` scores M1 even if used incorrectly, e.g., `$10n$`.",
                "outcome": ""
              }
            ]
          }
        }
      }
    };
    
    const result = await MarkingInstructionService.generateFromOCR(
      TEST_CONFIG.model,
      TEST_DATA.markingInstructionInput,
      mockQuestionDetection
    );
    
    console.log('📝 [MARKING INSTRUCTIONS]:', result.annotations);
    console.log('📊 [TOKENS USED]:', result.usageTokens);
    
    // Debug: Check if annotations are empty
    if (!result.annotations || result.annotations.length === 0) {
      console.log('⚠️ [DEBUG] No annotations returned - this might indicate a parsing issue');
      console.log('💡 [TIP] Check the AI response format or JSON parsing logic');
    }
    
  } catch (error) {
    console.error('❌ [MARKING INSTRUCTIONS TEST] Test failed:', error);
    throw error;
  }
}

async function testQuestionDetection() {
  console.log('🎯 [TEST] Question Detection - Geometry');
  console.log('=' .repeat(50));
  
  try {
    // Show API details before making the call
    const { getModelConfig } = await import('../config/aiModels.js');
    const modelConfig = getModelConfig(TEST_CONFIG.model);
    
    console.log('🔗 [API URL]:', modelConfig.apiEndpoint);
    console.log('🤖 [MODEL]:', modelConfig.name);
    console.log('📊 [MAX TOKENS]:', modelConfig.maxTokens);
    console.log('🌡️ [TEMPERATURE]:', modelConfig.temperature);
    console.log('📋 [API VERSION]:', modelConfig.apiEndpoint.includes('/v1beta/') ? 'v1beta' : 'v1');
    console.log('=' .repeat(50));
    
    // Test question detection with geometry question
    console.log('📝 [QUESTION TEXT]:');
    console.log(GEOMETRY_TEST_DATA.questionText);
    console.log('=' .repeat(50));
    
    // Import and test the actual question detection service
    const { questionDetectionService } = await import('../services/questionDetectionService.js');
    
    console.log('🔍 [TESTING] Calling questionDetectionService.detectQuestion...');
    
    const detectionResult = await questionDetectionService.detectQuestion(
      GEOMETRY_TEST_DATA.questionText
    );
    
    console.log('📊 [DETECTION RESULT]:');
    console.log(JSON.stringify(detectionResult, null, 2));
    
    if (detectionResult.found && detectionResult.match) {
      console.log('✅ [SUCCESS] Question detected successfully!');
      console.log('📋 [QUESTION NUMBER]:', detectionResult.match.questionNumber);
      console.log('📋 [SUB QUESTION]:', detectionResult.match.subQuestionNumber || 'None');
      console.log('📋 [MARKS]:', detectionResult.match.marks);
      console.log('📋 [CONFIDENCE]:', detectionResult.match.confidence);
    } else {
      console.log('❌ [FAILED] Question detection failed - no match found');
      console.log('💡 [DEBUG] Check the question text format and exam paper database');
    }
    
  } catch (error) {
    console.error('❌ [QUESTION DETECTION TEST] Test failed:', error);
    console.error('🔍 [ERROR DETAILS]:', error instanceof Error ? error.message : 'Unknown error');
    console.error('📋 [STACK TRACE]:', error instanceof Error ? error.stack : 'No stack trace');
    throw error;
  }
}

async function runTests() {
  const testType = process.argv[2] || 'response';
  const modelParam = process.argv[3];
  
  // Override model if specified via command line
  if (modelParam) {
    try {
      const validatedModel = validateModel(modelParam);
      TEST_CONFIG.model = validatedModel;
      console.log(`🤖 [MODEL OVERRIDE] Using model: ${modelParam}`);
    } catch (error) {
      console.error(`❌ [MODEL ERROR] ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.log(`💡 [SUPPORTED MODELS] ${getSupportedModels().join(', ')}`);
      process.exit(1);
    }
  }
  
  try {
    switch (testType) {
      case 'response':
        await testAIResponseGeneration();
        break;
      case 'model-answer':
        await testModelAnswer();
        break;
      case 'marking':
        await testMarkingInstructions();
        break;
      case 'question-detection':
        await testQuestionDetection();
        break;
      case 'format':
        await testMarkingSchemeFormatting();
        break;
      case 'both':
        await testMarkingInstructions();
        console.log('\n');
        await testModelAnswer();
        break;
      case 'all':
        await testMarkingSchemeFormatting();
        console.log('\n');
        await testQuestionDetection();
        console.log('\n');
        await testMarkingInstructions();
        console.log('\n');
        await testModelAnswer();
        console.log('\n');
        await testAIResponseGeneration();
        break;
      default:
        console.log('❌ Invalid test type. Use: response, model-answer, marking, question-detection, format, both, or all');
        console.log('💡 [USAGE] tsx script.ts [testType] [model]');
        console.log('   testType: response, model-answer, marking, question-detection, format, both, all');
        console.log(`   model: ${getSupportedModels().join(', ')}`);
        process.exit(1);
    }
    
    console.log('\n✅ [ALL TESTS] Completed successfully!');
    
  } catch (error) {
    console.error('❌ [TEST FAILED]:', error);
    process.exit(1);
  }
}

// Run the tests
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests();
}

