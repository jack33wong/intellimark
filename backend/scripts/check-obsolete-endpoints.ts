#!/usr/bin/env tsx

/**
 * Check for Obsolete API Endpoints
 * Compares API spec with actual route implementations
 */

import fs from 'fs';
import path from 'path';

interface OpenAPISpec {
  paths: Record<string, any>;
}

interface RouteInfo {
  method: string;
  path: string;
  fullPath: string;
}

/**
 * Extract endpoints from API spec
 */
function getApiSpecEndpoints(spec: OpenAPISpec): string[] {
  const endpoints: string[] = [];
  
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const method of Object.keys(methods)) {
      endpoints.push(`${method.toUpperCase()} ${path}`);
    }
  }
  
  return endpoints.sort();
}

/**
 * Extract endpoints from route files
 */
function getRouteEndpoints(): string[] {
  const routesDir = path.join(process.cwd(), 'routes');
  const endpoints: string[] = [];
  
  const routeFiles = [
    'mark-homework.ts',
    'messages.ts', 
    'auth.ts',
    'payment.ts',
    'admin.ts'
  ];
  
  for (const file of routeFiles) {
    const filePath = path.join(routesDir, file);
    if (!fs.existsSync(filePath)) {
      console.warn(`⚠️  Route file not found: ${file}`);
      continue;
    }
    
    const content = fs.readFileSync(filePath, 'utf8');
    
    // Extract router method calls
    const routerMatches = content.match(/router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]/g);
    
    if (routerMatches) {
      for (const match of routerMatches) {
        const methodMatch = match.match(/router\.(get|post|put|delete|patch)/);
        const pathMatch = match.match(/['"`]([^'"`]+)['"`]/);
        
        if (methodMatch && pathMatch) {
          const method = methodMatch[1].toUpperCase();
          const routePath = pathMatch[1];
          
          // Determine the base path based on the file
          let basePath = '';
          switch (file) {
            case 'mark-homework.ts':
              basePath = '/api/mark-homework';
              break;
            case 'messages.ts':
              basePath = '/api/messages';
              break;
            case 'auth.ts':
              basePath = '/api/auth';
              break;
            case 'payment.ts':
              basePath = '/api/payment';
              break;
            case 'admin.ts':
              basePath = '/api/admin';
              break;
          }
          
          const fullPath = basePath + routePath;
          endpoints.push(`${method} ${fullPath}`);
        }
      }
    }
  }
  
  return endpoints.sort();
}

/**
 * Find differences between API spec and actual routes
 */
function findDifferences(apiSpecEndpoints: string[], routeEndpoints: string[]): {
  inSpecNotInRoutes: string[];
  inRoutesNotInSpec: string[];
} {
  const inSpecNotInRoutes = apiSpecEndpoints.filter(endpoint => !routeEndpoints.includes(endpoint));
  const inRoutesNotInSpec = routeEndpoints.filter(endpoint => !apiSpecEndpoints.includes(endpoint));
  
  return { inSpecNotInRoutes, inRoutesNotInSpec };
}

/**
 * Categorize endpoints
 */
function categorizeEndpoints(endpoints: string[]): {
  production: string[];
  debug: string[];
  test: string[];
  admin: string[];
} {
  const production: string[] = [];
  const debug: string[] = [];
  const test: string[] = [];
  const admin: string[] = [];
  
  for (const endpoint of endpoints) {
    if (endpoint.includes('/debug/') || endpoint.includes('debug')) {
      debug.push(endpoint);
    } else if (endpoint.includes('/test') || endpoint.includes('test-')) {
      test.push(endpoint);
    } else if (endpoint.includes('/admin/')) {
      admin.push(endpoint);
    } else {
      production.push(endpoint);
    }
  }
  
  return { production, debug, test, admin };
}

/**
 * Main function
 */
function main() {
  try {
    console.log('🔍 Checking for obsolete API endpoints...\n');
    
    // Read API spec
    const specPath = path.join(process.cwd(), 'api-spec.json');
    if (!fs.existsSync(specPath)) {
      console.error('❌ API spec not found at:', specPath);
      process.exit(1);
    }
    
    const specContent = fs.readFileSync(specPath, 'utf8');
    const spec: OpenAPISpec = JSON.parse(specContent);
    
    // Get endpoints from both sources
    const apiSpecEndpoints = getApiSpecEndpoints(spec);
    const routeEndpoints = getRouteEndpoints();
    
    console.log(`📊 API Spec Endpoints: ${apiSpecEndpoints.length}`);
    console.log(`📊 Actual Route Endpoints: ${routeEndpoints.length}\n`);
    
    // Find differences
    const { inSpecNotInRoutes, inRoutesNotInSpec } = findDifferences(apiSpecEndpoints, routeEndpoints);
    
    // Categorize endpoints
    const specCategories = categorizeEndpoints(apiSpecEndpoints);
    const routeCategories = categorizeEndpoints(routeEndpoints);
    
    // Report results
    console.log('📋 ENDPOINT ANALYSIS:\n');
    
    console.log('✅ PRODUCTION ENDPOINTS:');
    console.log(`   API Spec: ${specCategories.production.length}`);
    console.log(`   Routes: ${routeCategories.production.length}\n`);
    
    console.log('🔧 DEBUG ENDPOINTS:');
    console.log(`   API Spec: ${specCategories.debug.length}`);
    console.log(`   Routes: ${routeCategories.debug.length}`);
    if (routeCategories.debug.length > 0) {
      console.log('   Debug endpoints in routes:');
      routeCategories.debug.forEach(endpoint => console.log(`     - ${endpoint}`));
    }
    console.log();
    
    console.log('🧪 TEST ENDPOINTS:');
    console.log(`   API Spec: ${specCategories.test.length}`);
    console.log(`   Routes: ${routeCategories.test.length}`);
    if (routeCategories.test.length > 0) {
      console.log('   Test endpoints in routes:');
      routeCategories.test.forEach(endpoint => console.log(`     - ${endpoint}`));
    }
    console.log();
    
    console.log('👑 ADMIN ENDPOINTS:');
    console.log(`   API Spec: ${specCategories.admin.length}`);
    console.log(`   Routes: ${routeCategories.admin.length}\n`);
    
    // Report discrepancies
    if (inSpecNotInRoutes.length > 0) {
      console.log('❌ ENDPOINTS IN API SPEC BUT NOT IN ROUTES (OBSOLETE):');
      inSpecNotInRoutes.forEach(endpoint => console.log(`   - ${endpoint}`));
      console.log();
    }
    
    if (inRoutesNotInSpec.length > 0) {
      console.log('⚠️  ENDPOINTS IN ROUTES BUT NOT IN API SPEC (MISSING):');
      inRoutesNotInSpec.forEach(endpoint => console.log(`   - ${endpoint}`));
      console.log();
    }
    
    // Summary
    if (inSpecNotInRoutes.length === 0 && inRoutesNotInSpec.length === 0) {
      console.log('✅ PERFECT MATCH: All endpoints are synchronized!');
    } else {
      console.log('📝 SUMMARY:');
      console.log(`   - Obsolete endpoints (in spec, not in routes): ${inSpecNotInRoutes.length}`);
      console.log(`   - Missing endpoints (in routes, not in spec): ${inRoutesNotInSpec.length}`);
      
      if (inSpecNotInRoutes.length > 0) {
        console.log('\n🔧 RECOMMENDATION: Remove obsolete endpoints from API spec');
      }
      if (inRoutesNotInSpec.length > 0) {
        console.log('\n🔧 RECOMMENDATION: Add missing endpoints to API spec');
      }
    }
    
  } catch (error) {
    console.error('❌ Error checking endpoints:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { getApiSpecEndpoints, getRouteEndpoints, findDifferences };
