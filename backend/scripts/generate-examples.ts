#!/usr/bin/env tsx

/**
 * Example Generator for OpenAPI Schemas
 * Automatically generates realistic examples from schema definitions
 */

import fs from 'fs';
import path from 'path';

interface SchemaProperty {
  type?: string;
  enum?: string[];
  example?: any;
  properties?: Record<string, SchemaProperty>;
  items?: SchemaProperty;
  oneOf?: SchemaProperty[];
  required?: string[];
}

interface Schema {
  type?: string;
  properties?: Record<string, SchemaProperty>;
  required?: string[];
  example?: any;
}

interface OpenAPISpec {
  components?: {
    schemas?: Record<string, Schema>;
  };
}

/**
 * Generate example value based on property type and name
 */
function generateExampleValue(property: SchemaProperty, propertyName: string): any {
  // If example already exists, use it
  if (property.example !== undefined) {
    return property.example;
  }

  // Handle enum values
  if (property.enum) {
    return property.enum[0];
  }

  // Handle oneOf (union types)
  if (property.oneOf) {
    return generateExampleValue(property.oneOf[0], propertyName);
  }

  // Handle arrays
  if (property.type === 'array' && property.items) {
    return [generateExampleValue(property.items, propertyName)];
  }

  // Handle objects
  if (property.type === 'object' && property.properties) {
    const example: any = {};
    for (const [key, value] of Object.entries(property.properties)) {
      example[key] = generateExampleValue(value, key);
    }
    return example;
  }

  // Generate based on type and property name
  switch (property.type) {
    case 'boolean':
      return true;
    
    case 'number':
    case 'integer':
      // Smart defaults based on property name
      if (propertyName.includes('marks') || propertyName.includes('score')) return 3;
      if (propertyName.includes('time') || propertyName.includes('ms')) return 1500;
      if (propertyName.includes('tokens')) return 150;
      if (propertyName.includes('confidence')) return 0.85;
      if (propertyName.includes('size')) return 1024;
      if (propertyName.includes('count') || propertyName.includes('total')) return 5;
      return 42;
    
    case 'string':
      // Smart defaults based on property name
      if (propertyName.includes('id') || propertyName.includes('Id')) {
        if (propertyName.includes('session')) return 'session-1234567890';
        if (propertyName.includes('message')) return 'msg-1234567890';
        if (propertyName.includes('user')) return 'user-1234567890';
        return 'id-1234567890';
      }
      if (propertyName.includes('email')) return 'user@example.com';
      if (propertyName.includes('name') || propertyName.includes('Name')) {
        if (propertyName.includes('display')) return 'John Doe';
        if (propertyName.includes('full')) return 'John Smith';
        return 'John';
      }
      if (propertyName.includes('title')) return 'Math Homework - Question 5';
      if (propertyName.includes('content') || propertyName.includes('message')) {
        return 'Here is the solution to your math problem...';
      }
      if (propertyName.includes('text') || propertyName.includes('question')) {
        return 'Solve for x: 2x + 5 = 13';
      }
      if (propertyName.includes('model')) return 'gemini-2.5-pro';
      if (propertyName.includes('api') || propertyName.includes('url')) {
        return 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent';
      }
      if (propertyName.includes('method') || propertyName.includes('ocr')) {
        return 'google-vision';
      }
      if (propertyName.includes('board') || propertyName.includes('exam')) {
        return 'AQA';
      }
      if (propertyName.includes('subject')) return 'Mathematics';
      if (propertyName.includes('tier')) return 'Higher';
      if (propertyName.includes('year')) return '2023';
      if (propertyName.includes('timestamp') || propertyName.includes('time')) {
        return new Date().toISOString();
      }
      if (propertyName.includes('image') || propertyName.includes('data')) {
        return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
      }
      if (propertyName.includes('link') || propertyName.includes('url')) {
        return 'https://firebasestorage.googleapis.com/v0/b/example.appspot.com/o/images%2Fannotated.png';
      }
      if (propertyName.includes('fileName')) return 'homework.png';
      if (propertyName.includes('role')) return 'assistant';
      if (propertyName.includes('type')) return 'chat';
      if (propertyName.includes('mode')) return 'modelanswer';
      if (propertyName.includes('provider')) return 'google';
      if (propertyName.includes('plan')) return 'pro';
      if (propertyName.includes('cycle')) return 'monthly';
      return 'example-string';
    
    default:
      return null;
  }
}

/**
 * Add examples to a schema
 */
function addExamplesToSchema(schema: Schema, schemaName: string): Schema {
  if (!schema.properties) {
    return schema;
  }

  const updatedSchema = { ...schema };
  updatedSchema.properties = {};

  for (const [propertyName, property] of Object.entries(schema.properties)) {
    const updatedProperty = { ...property };
    
    // Generate example if not already present
    if (updatedProperty.example === undefined) {
      updatedProperty.example = generateExampleValue(updatedProperty, propertyName);
    }

    // Recursively add examples to nested objects
    if (updatedProperty.type === 'object' && updatedProperty.properties) {
      updatedProperty.properties = {};
      for (const [nestedName, nestedProperty] of Object.entries(property.properties)) {
        updatedProperty.properties[nestedName] = addExamplesToSchema(nestedProperty, nestedName);
      }
    }

    // Handle array items
    if (updatedProperty.type === 'array' && updatedProperty.items) {
      updatedProperty.items = addExamplesToSchema(updatedProperty.items, `${propertyName}Item`);
    }

    updatedSchema.properties[propertyName] = updatedProperty;
  }

  return updatedSchema;
}

/**
 * Generate examples for all schemas in the OpenAPI spec
 */
function generateExamplesForSpec(spec: OpenAPISpec): OpenAPISpec {
  if (!spec.components?.schemas) {
    return spec;
  }

  const updatedSpec = { ...spec };
  updatedSpec.components = { ...spec.components };
  updatedSpec.components.schemas = {};

  for (const [schemaName, schema] of Object.entries(spec.components.schemas)) {
    updatedSpec.components.schemas[schemaName] = addExamplesToSchema(schema, schemaName);
  }

  return updatedSpec;
}

/**
 * Main function to generate examples and update API spec
 */
function main() {
  try {
    console.log('🔧 Generating examples for OpenAPI schemas...');
    
    const specPath = path.join(process.cwd(), 'api-spec.json');
    
    if (!fs.existsSync(specPath)) {
      console.error('❌ API spec not found at:', specPath);
      console.error('   Run: npm run generate-api-spec');
      process.exit(1);
    }

    // Read the existing API spec
    const specContent = fs.readFileSync(specPath, 'utf8');
    const spec: OpenAPISpec = JSON.parse(specContent);

    // Generate examples for all schemas
    const specWithExamples = generateExamplesForSpec(spec);

    // Write the updated spec back
    fs.writeFileSync(specPath, JSON.stringify(specWithExamples, null, 2));

    console.log('✅ Examples generated successfully!');
    console.log(`📄 Updated: ${specPath}`);
    
    const schemaCount = Object.keys(specWithExamples.components?.schemas || {}).length;
    console.log(`📊 Added examples to ${schemaCount} schemas`);

  } catch (error) {
    console.error('❌ Error generating examples:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { generateExamplesForSpec, addExamplesToSchema };
