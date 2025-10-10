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
      // Mark Homework Routes
      '/api/mark-homework/upload': {
        post: {
          summary: 'Upload homework image',
          description: 'Upload an image for homework marking',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    imageData: { type: 'string' },
                    model: { type: 'string', enum: ['auto', 'gemini-2.5-pro', 'gemini-2.5-flash'] },
                    sessionId: { type: 'string' }
                  },
                  required: ['imageData']
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Upload successful',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      message: { type: 'string', example: 'Image uploaded successfully' },
                      sessionId: { type: 'string', example: 'session-1234567890' },
                      imageUrl: { type: 'string', example: 'https://firebasestorage.googleapis.com/v0/b/example.appspot.com/o/images%2Fuploaded.png' }
                    }
                  }
                }
              }
            },
            '400': { $ref: '#/components/responses/ErrorResponse' }
          }
        }
      },
      '/api/mark-homework/process': {
        post: {
          summary: 'Process homework marking',
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
            '400': { $ref: '#/components/responses/ErrorResponse' }
          }
        }
      },
      '/api/mark-homework/process-single-stream': {
        post: {
          summary: 'Process homework with streaming',
          description: 'Process homework with real-time streaming response',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    imageData: { type: 'string' },
                    model: { type: 'string' },
                    customText: { type: 'string' },
                    debug: { type: 'boolean' },
                    aiMessageId: { type: 'string' },
                    sessionId: { type: 'string' }
                  },
                  required: ['imageData']
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Streaming response',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      responseType: { type: 'string', example: 'streaming' },
                      sessionId: { type: 'string', example: 'session-1234567890' },
                      messageId: { type: 'string', example: 'msg-1234567890' },
                      progressData: { $ref: '#/components/schemas/ProgressData' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/mark-homework/model-answer': {
        post: {
          summary: 'Get model answer',
          description: 'Get model answer for a specific question',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    messageId: { type: 'string' },
                    sessionId: { type: 'string' }
                  },
                  required: ['messageId', 'sessionId']
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Model answer response',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      responseType: { type: 'string', example: 'model_answer' },
                      aiMessage: { $ref: '#/components/schemas/UnifiedMessage' },
                      sessionId: { type: 'string', example: 'session-1234567890' },
                      progressData: { $ref: '#/components/schemas/ProgressData' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/mark-homework/stats': {
        get: {
          summary: 'Get marking statistics',
          description: 'Get statistics about homework marking',
          responses: {
            '200': {
              description: 'Marking statistics',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      stats: {
                        type: 'object',
                        properties: {
                          totalMarkings: { type: 'number', example: 150 },
                          averageProcessingTime: { type: 'number', example: 2500 },
                          successRate: { type: 'number', example: 0.95 },
                          totalSessions: { type: 'number', example: 75 }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/mark-homework/health': {
        get: {
          summary: 'Mark homework health check',
          description: 'Health check for mark homework service',
          responses: {
            '200': {
              description: 'Health status',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'OK' },
                      timestamp: { type: 'string', example: '2024-01-01T00:00:00Z' },
                      service: { type: 'string', example: 'mark-homework' }
                    }
                  }
                }
              }
            }
          }
        }
      },

      // Messages Routes
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
      },
      '/api/messages': {
        post: {
          summary: 'Create message',
          description: 'Create a new message',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/UnifiedMessage'
                }
              }
            }
          },
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/messages/session/{sessionId}': {
        get: {
          summary: 'Get session messages',
          description: 'Get all messages for a specific session',
          parameters: [
            {
              name: 'sessionId',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            }
          ],
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/messages/sessions/{userId}': {
        get: {
          summary: 'Get user sessions',
          description: 'Get all sessions for a specific user',
          parameters: [
            {
              name: 'userId',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            }
          ],
          responses: {
            '200': {
              description: 'User sessions',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      sessions: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/UnifiedSession' }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/messages/batch': {
        post: {
          summary: 'Create multiple messages',
          description: 'Create multiple messages in batch',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    messages: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/UnifiedMessage' }
                    }
                  },
                  required: ['messages']
                }
              }
            }
          },
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/messages/session/{sessionId}': {
        delete: {
          summary: 'Delete session',
          description: 'Delete a specific session',
          parameters: [
            {
              name: 'sessionId',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            }
          ],
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        },
        put: {
          summary: 'Update session',
          description: 'Update a specific session',
          parameters: [
            {
              name: 'sessionId',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  $ref: '#/components/schemas/UnifiedSession'
                }
              }
            }
          },
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/messages/stats': {
        get: {
          summary: 'Get message statistics',
          description: 'Get statistics about messages',
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },

      // Auth Routes
      '/api/auth/test-updated-code': {
        get: {
          summary: 'Test auth code',
          description: 'Test endpoint for updated auth code',
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/auth/providers': {
        get: {
          summary: 'Get auth providers',
          description: 'Get available authentication providers',
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/auth/social-login': {
        post: {
          summary: 'Social login',
          description: 'Authenticate with social provider',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    idToken: { type: 'string' },
                    provider: { type: 'string' }
                  },
                  required: ['idToken', 'provider']
                }
              }
            }
          },
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/auth/profile': {
        get: {
          summary: 'Get user profile',
          description: 'Get current user profile',
          security: [{ bearerAuth: [] }],
          responses: {
            '200': {
              description: 'User profile',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      user: {
                        type: 'object',
                        properties: {
                          uid: { type: 'string', example: 'user-1234567890' },
                          email: { type: 'string', example: 'user@example.com' },
                          displayName: { type: 'string', example: 'John Doe' },
                          photoURL: { type: 'string', example: 'https://example.com/photo.jpg' }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        },
        put: {
          summary: 'Update user profile',
          description: 'Update current user profile',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    displayName: { type: 'string' },
                    photoURL: { type: 'string' }
                  }
                }
              }
            }
          },
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/auth/signup': {
        post: {
          summary: 'Email signup',
          description: 'Sign up with email and password',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    email: { type: 'string' },
                    password: { type: 'string' },
                    fullName: { type: 'string' }
                  },
                  required: ['email', 'password', 'fullName']
                }
              }
            }
          },
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/auth/signin': {
        post: {
          summary: 'Email signin',
          description: 'Sign in with email and password',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    email: { type: 'string' },
                    password: { type: 'string' }
                  },
                  required: ['email', 'password']
                }
              }
            }
          },
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/auth/check-user': {
        post: {
          summary: 'Check if user exists',
          description: 'Check if a user exists by email',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    email: { type: 'string' }
                  },
                  required: ['email']
                }
              }
            }
          },
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/auth/logout': {
        post: {
          summary: 'Logout user',
          description: 'Logout current user',
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },

      // Payment Routes
      '/api/payment/config': {
        get: {
          summary: 'Get payment config',
          description: 'Get Stripe payment configuration',
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/payment/create-checkout-session': {
        post: {
          summary: 'Create checkout session',
          description: 'Create Stripe checkout session',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    planId: { type: 'string' },
                    billingCycle: { type: 'string' },
                    successUrl: { type: 'string' },
                    cancelUrl: { type: 'string' },
                    userId: { type: 'string' }
                  },
                  required: ['planId', 'billingCycle', 'successUrl', 'cancelUrl', 'userId']
                }
              }
            }
          },
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/payment/create-payment-intent': {
        post: {
          summary: 'Create payment intent',
          description: 'Create Stripe payment intent',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    planId: { type: 'string' },
                    billingCycle: { type: 'string' },
                    customerEmail: { type: 'string' },
                    customerId: { type: 'string' }
                  },
                  required: ['planId', 'billingCycle', 'customerEmail', 'customerId']
                }
              }
            }
          },
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/payment/create-subscription': {
        post: {
          summary: 'Create subscription',
          description: 'Create Stripe subscription',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    planId: { type: 'string' },
                    billingCycle: { type: 'string' },
                    customerEmail: { type: 'string' },
                    customerId: { type: 'string' }
                  },
                  required: ['planId', 'billingCycle', 'customerEmail', 'customerId']
                }
              }
            }
          },
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/payment/user-subscription/{userId}': {
        get: {
          summary: 'Get user subscription',
          description: 'Get subscription for a specific user',
          parameters: [
            {
              name: 'userId',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            }
          ],
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/payment/subscription/{id}': {
        get: {
          summary: 'Get subscription by ID',
          description: 'Get subscription by Stripe subscription ID',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            }
          ],
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/payment/cancel-subscription/{id}': {
        delete: {
          summary: 'Cancel subscription',
          description: 'Cancel a subscription',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            }
          ],
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/payment/create-subscription-after-payment': {
        post: {
          summary: 'Create subscription after payment',
          description: 'Create subscription after successful payment',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    sessionId: { type: 'string' },
                    userId: { type: 'string' },
                    email: { type: 'string' }
                  },
                  required: ['sessionId', 'userId', 'email']
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Subscription created after payment',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      subscriptionId: { type: 'string', example: 'sub_1234567890' },
                      status: { type: 'string', example: 'active' }
                    }
                  }
                }
              }
            }
          }
        }
      },
      '/api/payment/webhook': {
        post: {
          summary: 'Stripe webhook',
          description: 'Handle Stripe webhook events',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object'
                }
              }
            }
          },
          responses: {
            '200': {
              description: 'Webhook processed',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      success: { type: 'boolean', example: true },
                      message: { type: 'string', example: 'Webhook processed successfully' }
                    }
                  }
                }
              }
            }
          }
        }
      },

      // Admin Routes
      '/api/admin/json/collections/{collectionName}': {
        get: {
          summary: 'Get collection data',
          description: 'Get data from a specific collection',
          parameters: [
            {
              name: 'collectionName',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            }
          ],
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        },
        post: {
          summary: 'Add to collection',
          description: 'Add data to a specific collection',
          parameters: [
            {
              name: 'collectionName',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            }
          ],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object'
                }
              }
            }
          },
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/admin/json/collections/markingSchemes': {
        post: {
          summary: 'Add marking scheme',
          description: 'Add a new marking scheme',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    markingSchemeData: { type: 'object' }
                  },
                  required: ['markingSchemeData']
                }
              }
            }
          },
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/admin/json/collections/{collectionName}/{entryId}': {
        delete: {
          summary: 'Delete collection entry',
          description: 'Delete a specific entry from collection',
          parameters: [
            {
              name: 'collectionName',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            },
            {
              name: 'entryId',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            }
          ],
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/admin/json/collections/{collectionName}/clear-all': {
        delete: {
          summary: 'Clear collection',
          description: 'Clear all entries from a collection',
          parameters: [
            {
              name: 'collectionName',
              in: 'path',
              required: true,
              schema: { type: 'string' }
            }
          ],
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/admin/json/upload': {
        post: {
          summary: 'Upload JSON data',
          description: 'Upload JSON data to collections',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { type: 'object' }
                  },
                  required: ['data']
                }
              }
            }
          },
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/admin/clear-all-sessions': {
        delete: {
          summary: 'Clear all sessions',
          description: 'Clear all user sessions',
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      },
      '/api/admin/clear-all-marking-results': {
        delete: {
          summary: 'Clear all marking results',
          description: 'Clear all marking results',
          responses: {
            '200': { $ref: '#/components/responses/SuccessResponse' }
          }
        }
      }
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        }
      },
      responses: {
        SuccessResponse: {
          description: 'Successful response',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  success: { type: 'boolean' }
                }
              }
            }
          }
        },
        ErrorResponse: {
          description: 'Error response',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/ErrorResponse'
              }
            }
          }
        }
      },
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
            studentScore: {
              type: 'object',
              properties: {
                totalMarks: { type: 'number' },
                awardedMarks: { type: 'number' },
                scoreText: { type: 'string' }
              }
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
