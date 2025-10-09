#!/usr/bin/env tsx

/**
 * OpenAPI Specification Generator
 * Automatically generates API spec from backend types and routes
 */

import fs from 'fs';
import path from 'path';

// Import all types from the main types file
import type { 
  MarkHomeworkRequest, 
  MarkHomeworkResponse, 
  ChatRequest, 
  ChatResponse,
  UnifiedMessage,
  UnifiedSession,
  DetectedQuestion,
  ModelType
} from '../types/index.js';

/**
 * Generate OpenAPI 3.0 specification from backend types
 */
function generateOpenAPISpec() {
  const spec = {
    openapi: '3.0.0',
    info: {
      title: 'IntelliMark API',
      description: 'AI-powered homework marking and question detection API',
      version: '1.0.0',
      contact: {
        name: 'IntelliMark Team'
      }
    },
    servers: [
      {
        url: 'http://localhost:5001',
        description: 'Development server'
      }
    ],
    paths: {
      '/api/mark-homework': {
        post: {
          summary: 'Mark homework with AI',
          description: 'Process uploaded image and generate marking instructions',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/MarkHomeworkRequest'
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Successful marking response',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/MarkHomeworkResponse'
                  }
                }
              }
            },
            '400': {
              description: 'Bad request',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/ErrorResponse'
                  }
                }
              }
            }
          }
        }
      },
      '/api/messages/chat': {
        post: {
          summary: 'Send chat message',
          description: 'Send a text message and get AI response',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/ChatRequest'
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Successful chat response',
              content: {
                'application/json': {
                  schema: {
                    $ref: '#/components/schemas/ChatResponse'
                  }
                }
              }
            }
          }
        }
      }
    },
    components: {
      schemas: {
        // Core Types
        DetectedQuestion: {
          type: 'object',
          properties: {
            found: { type: 'boolean' },
            questionText: { type: 'string' },
            questionNumber: { type: 'string' },
            subQuestionNumber: { type: 'string' },
            examBoard: { type: 'string' },
            examCode: { type: 'string' },
            paperTitle: { type: 'string' },
            subject: { type: 'string' },
            tier: { type: 'string' },
            year: { type: 'string' },
            marks: { type: 'number' },
            markingScheme: { type: 'string' }
          },
          required: ['found']
        },
        
        UnifiedMessage: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            messageId: { type: 'string' },
            sessionId: { type: 'string' },
            userId: { type: 'string' },
            role: { 
              type: 'string',
              enum: ['user', 'assistant', 'system']
            },
            content: { type: 'string' },
            timestamp: { type: 'string' },
            type: {
              type: 'string',
              enum: ['chat', 'marking_original', 'marking_annotated', 'question_original', 'question_response', 'follow_up']
            },
            imageLink: { type: 'string' },
            imageData: { type: 'string' },
            fileName: { type: 'string' },
            isImageContext: { type: 'boolean' },
            isProcessing: { type: 'boolean' },
            detectedQuestion: {
              $ref: '#/components/schemas/DetectedQuestion'
            },
            processingStats: {
              $ref: '#/components/schemas/ProcessingStats'
            },
            progressData: {
              $ref: '#/components/schemas/ProgressData'
            },
            suggestedFollowUps: {
              type: 'array',
              items: {
                oneOf: [
                  { type: 'string' },
                  {
                    type: 'object',
                    properties: {
                      text: { type: 'string' },
                      mode: { type: 'string' }
                    }
                  }
                ]
              }
            },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' }
          },
          required: ['id', 'messageId', 'role', 'content', 'timestamp']
        },
        
        UnifiedSession: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            title: { type: 'string' },
            messages: {
              type: 'array',
              items: {
                $ref: '#/components/schemas/UnifiedMessage'
              }
            },
            userId: { type: 'string' },
            messageType: {
              type: 'string',
              enum: ['Marking', 'Question', 'Chat', 'Mixed']
            },
            createdAt: { type: 'string' },
            updatedAt: { type: 'string' },
            favorite: { type: 'boolean' },
            rating: { type: 'number' },
            isPastPaper: { type: 'boolean' },
            detectedQuestion: {
              $ref: '#/components/schemas/DetectedQuestion'
            },
            sessionStats: {
              $ref: '#/components/schemas/SessionStats'
            }
          },
          required: ['id', 'title', 'messages', 'userId', 'messageType', 'createdAt', 'updatedAt']
        },
        
        ProcessingStats: {
          type: 'object',
          properties: {
            processingTimeMs: { type: 'number' },
            confidence: { type: 'number' },
            annotations: { type: 'number' },
            imageSize: { type: 'number' },
            ocrMethod: { type: 'string' },
            classificationResult: { type: 'object' },
            modelUsed: { type: 'string' },
            apiUsed: { type: 'string' },
            llmTokens: { type: 'number' },
            mathpixCalls: { type: 'number' }
          }
        },
        
        ProgressData: {
          type: 'object',
          properties: {
            currentStepDescription: { type: 'string' },
            allSteps: {
              type: 'array',
              items: { type: 'string' }
            },
            currentStepIndex: { type: 'number' },
            isComplete: { type: 'boolean' }
          },
          required: ['currentStepDescription', 'allSteps', 'currentStepIndex', 'isComplete']
        },
        
        SessionStats: {
          type: 'object',
          properties: {
            totalProcessingTimeMs: { type: 'number' },
            totalLlmTokens: { type: 'number' },
            totalMathpixCalls: { type: 'number' },
            totalMessages: { type: 'number' },
            totalTokens: { type: 'number' },
            imageSize: { type: 'number' },
            averageConfidence: { type: 'number' },
            totalAnnotations: { type: 'number' },
            lastApiUsed: { type: 'string' },
            lastModelUsed: { type: 'string' }
          }
        },
        
        // Request/Response Types
        MarkHomeworkRequest: {
          type: 'object',
          properties: {
            imageData: { type: 'string' },
            model: {
              type: 'string',
              enum: ['auto', 'gemini-2.5-pro', 'gemini-2.5-flash']
            },
            additionalInstructions: { type: 'string' }
          },
          required: ['imageData', 'model']
        },
        
        MarkHomeworkResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            isQuestionOnly: { type: 'boolean' },
            annotatedImage: { type: 'string' },
            message: { type: 'string' },
            suggestedFollowUps: {
              type: 'array',
              items: {
                oneOf: [
                  { type: 'string' },
                  {
                    type: 'object',
                    properties: {
                      text: { type: 'string' },
                      mode: { type: 'string' }
                    }
                  }
                ]
              }
            },
            apiUsed: { type: 'string' },
            ocrMethod: { type: 'string' },
            classification: { type: 'object' },
            questionDetection: { type: 'object' },
            sessionId: { type: 'string' },
            sessionTitle: { type: 'string' },
            isPastPaper: { type: 'boolean' },
            processingStats: {
              $ref: '#/components/schemas/ProcessingStats'
            }
          },
          required: ['success']
        },
        
        ChatRequest: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            model: {
              type: 'string',
              enum: ['auto', 'gemini-2.5-pro', 'gemini-2.5-flash']
            },
            imageData: { type: 'string' },
            sessionId: { type: 'string' },
            mode: {
              type: 'string',
              enum: ['marking', 'question', 'chat']
            }
          },
          required: ['message', 'model']
        },
        
        ChatResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'object' },
            error: { type: 'string' }
          },
          required: ['success']
        },
        
        ErrorResponse: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            error: { type: 'string' },
            code: { type: 'string' }
          },
          required: ['success', 'error']
        }
      }
    }
  };
  
  return spec;
}

/**
 * Main function to generate and save API spec
 */
function main() {
  try {
    console.log('🔧 Generating OpenAPI specification...');
    
    const spec = generateOpenAPISpec();
    const outputPath = path.join(process.cwd(), 'api-spec.json');
    
    fs.writeFileSync(outputPath, JSON.stringify(spec, null, 2));
    
    console.log('✅ OpenAPI specification generated successfully!');
    console.log(`📄 Saved to: ${outputPath}`);
    console.log(`📊 Generated ${Object.keys(spec.components.schemas).length} schemas`);
    console.log(`🛣️  Generated ${Object.keys(spec.paths).length} API endpoints`);
    
  } catch (error) {
    console.error('❌ Error generating API specification:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { generateOpenAPISpec };
