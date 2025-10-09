#!/usr/bin/env tsx

/**
 * Update All API Response Schemas
 * Replaces generic SuccessResponse with detailed response schemas
 */

import fs from 'fs';
import path from 'path';

interface OpenAPISpec {
  paths: Record<string, any>;
}

/**
 * Get appropriate response schema for an endpoint
 */
function getResponseSchema(endpoint: string, method: string): any {
  // Messages endpoints
  if (endpoint.includes('/messages') && method === 'post') {
    if (endpoint.includes('/chat')) {
      return {
        description: 'Chat response',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ChatResponse' }
          }
        }
      };
    }
    if (endpoint.includes('/batch')) {
      return {
        description: 'Batch messages created',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                success: { type: 'boolean', example: true },
                messageCount: { type: 'number', example: 3 },
                messageIds: {
                  type: 'array',
                  items: { type: 'string' },
                  example: ['msg-1', 'msg-2', 'msg-3']
                }
              }
            }
          }
        }
      };
    }
    return {
      description: 'Message created',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              messageId: { type: 'string', example: 'msg-1234567890' },
              message: { $ref: '#/components/schemas/UnifiedMessage' }
            }
          }
        }
      }
    };
  }

  if (endpoint.includes('/messages/session/') && method === 'get') {
    return {
      description: 'Session messages',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              messages: {
                type: 'array',
                items: { $ref: '#/components/schemas/UnifiedMessage' }
              }
            }
          }
        }
      }
    };
  }

  if (endpoint.includes('/messages/session/') && method === 'delete') {
    return {
      description: 'Session deleted',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Session deleted successfully' }
            }
          }
        }
      }
    };
  }

  if (endpoint.includes('/messages/session/') && method === 'put') {
    return {
      description: 'Session updated',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              session: { $ref: '#/components/schemas/UnifiedSession' }
            }
          }
        }
      }
    };
  }

  if (endpoint.includes('/messages/stats') && method === 'get') {
    return {
      description: 'Message statistics',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              stats: {
                type: 'object',
                properties: {
                  totalMessages: { type: 'number', example: 1250 },
                  totalSessions: { type: 'number', example: 85 },
                  averageMessagesPerSession: { type: 'number', example: 14.7 }
                }
              }
            }
          }
        }
      }
    };
  }

  // Auth endpoints
  if (endpoint.includes('/auth/providers') && method === 'get') {
    return {
      description: 'Available auth providers',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              providers: {
                type: 'array',
                items: { type: 'string' },
                example: ['google', 'email']
              }
            }
          }
        }
      }
    };
  }

  if (endpoint.includes('/auth/social-login') && method === 'post') {
    return {
      description: 'Social login successful',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
              user: {
                type: 'object',
                properties: {
                  uid: { type: 'string', example: 'user-1234567890' },
                  email: { type: 'string', example: 'user@example.com' },
                  displayName: { type: 'string', example: 'John Doe' }
                }
              }
            }
          }
        }
      }
    };
  }

  if (endpoint.includes('/auth/signup') && method === 'post') {
    return {
      description: 'User signed up successfully',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'User created successfully' },
              user: {
                type: 'object',
                properties: {
                  uid: { type: 'string', example: 'user-1234567890' },
                  email: { type: 'string', example: 'user@example.com' }
                }
              }
            }
          }
        }
      }
    };
  }

  if (endpoint.includes('/auth/signin') && method === 'post') {
    return {
      description: 'User signed in successfully',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              token: { type: 'string', example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...' },
              user: {
                type: 'object',
                properties: {
                  uid: { type: 'string', example: 'user-1234567890' },
                  email: { type: 'string', example: 'user@example.com' }
                }
              }
            }
          }
        }
      }
    };
  }

  if (endpoint.includes('/auth/check-user') && method === 'post') {
    return {
      description: 'User check result',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              exists: { type: 'boolean', example: true },
              email: { type: 'string', example: 'user@example.com' }
            }
          }
        }
      }
    };
  }

  if (endpoint.includes('/auth/logout') && method === 'post') {
    return {
      description: 'User logged out',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Logged out successfully' }
            }
          }
        }
      }
    };
  }

  if (endpoint.includes('/auth/test-updated-code') && method === 'get') {
    return {
      description: 'Test endpoint response',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Test endpoint working' },
              timestamp: { type: 'string', example: '2024-01-01T00:00:00Z' }
            }
          }
        }
      }
    };
  }

  // Payment endpoints
  if (endpoint.includes('/payment/config') && method === 'get') {
    return {
      description: 'Payment configuration',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              publishableKey: { type: 'string', example: 'pk_test_...' },
              plans: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string', example: 'pro' },
                    name: { type: 'string', example: 'Pro Plan' },
                    price: { type: 'number', example: 9.99 }
                  }
                }
              }
            }
          }
        }
      }
    };
  }

  if (endpoint.includes('/payment/create-checkout-session') && method === 'post') {
    return {
      description: 'Checkout session created',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              sessionId: { type: 'string', example: 'cs_test_...' },
              url: { type: 'string', example: 'https://checkout.stripe.com/pay/cs_test_...' }
            }
          }
        }
      }
    };
  }

  if (endpoint.includes('/payment/create-payment-intent') && method === 'post') {
    return {
      description: 'Payment intent created',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              clientSecret: { type: 'string', example: 'pi_..._secret_...' },
              paymentIntentId: { type: 'string', example: 'pi_1234567890' }
            }
          }
        }
      }
    };
  }

  if (endpoint.includes('/payment/create-subscription') && method === 'post') {
    return {
      description: 'Subscription created',
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
    };
  }

  if (endpoint.includes('/payment/user-subscription/') && method === 'get') {
    return {
      description: 'User subscription',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              subscription: {
                type: 'object',
                properties: {
                  id: { type: 'string', example: 'sub_1234567890' },
                  status: { type: 'string', example: 'active' },
                  planId: { type: 'string', example: 'pro' },
                  currentPeriodEnd: { type: 'string', example: '2024-01-01T00:00:00Z' }
                }
              }
            }
          }
        }
      }
    };
  }

  if (endpoint.includes('/payment/subscription/') && method === 'get') {
    return {
      description: 'Subscription details',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              subscription: {
                type: 'object',
                properties: {
                  id: { type: 'string', example: 'sub_1234567890' },
                  status: { type: 'string', example: 'active' },
                  customerId: { type: 'string', example: 'cus_1234567890' }
                }
              }
            }
          }
        }
      }
    };
  }

  if (endpoint.includes('/payment/cancel-subscription/') && method === 'delete') {
    return {
      description: 'Subscription cancelled',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Subscription cancelled successfully' },
              subscriptionId: { type: 'string', example: 'sub_1234567890' }
            }
          }
        }
      }
    };
  }

  if (endpoint.includes('/payment/webhook') && method === 'post') {
    return {
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
    };
  }

  // Admin endpoints
  if (endpoint.includes('/admin/json/collections/') && method === 'get') {
    return {
      description: 'Collection data',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              collectionName: { type: 'string', example: 'markingSchemes' },
              data: {
                type: 'array',
                items: { type: 'object' }
              }
            }
          }
        }
      }
    };
  }

  if (endpoint.includes('/admin/json/collections/') && method === 'post') {
    return {
      description: 'Data added to collection',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Data added successfully' },
              entryId: { type: 'string', example: 'entry-1234567890' }
            }
          }
        }
      }
    };
  }

  if (endpoint.includes('/admin/json/collections/') && method === 'delete') {
    return {
      description: 'Entry deleted from collection',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Entry deleted successfully' }
            }
          }
        }
      }
    };
  }

  if (endpoint.includes('/admin/json/upload') && method === 'post') {
    return {
      description: 'JSON data uploaded',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'Data uploaded successfully' },
              collectionsUpdated: {
                type: 'array',
                items: { type: 'string' },
                example: ['markingSchemes', 'examPapers']
              }
            }
          }
        }
      }
    };
  }

  if (endpoint.includes('/admin/clear-all-sessions') && method === 'delete') {
    return {
      description: 'All sessions cleared',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'All sessions cleared successfully' },
              deletedCount: { type: 'number', example: 25 }
            }
          }
        }
      }
    };
  }

  if (endpoint.includes('/admin/clear-all-marking-results') && method === 'delete') {
    return {
      description: 'All marking results cleared',
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: {
              success: { type: 'boolean', example: true },
              message: { type: 'string', example: 'All marking results cleared successfully' },
              deletedCount: { type: 'number', example: 150 }
            }
          }
        }
      }
    };
  }

  // Default response for unmatched endpoints
  return {
    description: 'Operation successful',
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: true },
            message: { type: 'string', example: 'Operation completed successfully' }
          }
        }
      }
    }
  };
}

/**
 * Update all response schemas in the API spec
 */
function updateAllResponses(spec: OpenAPISpec): OpenAPISpec {
  const updatedSpec = { ...spec };
  
  for (const [endpoint, methods] of Object.entries(spec.paths)) {
    for (const [method, details] of Object.entries(methods as any)) {
      if (details.responses && details.responses['200'] && 
          details.responses['200'].$ref === '#/components/responses/SuccessResponse') {
        
        const newResponse = getResponseSchema(endpoint, method);
        details.responses['200'] = newResponse;
      }
    }
  }
  
  return updatedSpec;
}

/**
 * Main function
 */
function main() {
  try {
    console.log('🔧 Updating all API response schemas...');
    
    const specPath = path.join(process.cwd(), 'api-spec.json');
    
    if (!fs.existsSync(specPath)) {
      console.error('❌ API spec not found at:', specPath);
      process.exit(1);
    }

    // Read the existing API spec
    const specContent = fs.readFileSync(specPath, 'utf8');
    const spec: OpenAPISpec = JSON.parse(specContent);

    // Update all response schemas
    const updatedSpec = updateAllResponses(spec);

    // Write the updated spec back
    fs.writeFileSync(specPath, JSON.stringify(updatedSpec, null, 2));

    console.log('✅ All response schemas updated successfully!');
    console.log(`📄 Updated: ${specPath}`);

  } catch (error) {
    console.error('❌ Error updating response schemas:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { updateAllResponses, getResponseSchema };
