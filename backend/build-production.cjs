#!/usr/bin/env node

/**
 * Production Build Script for Firebase Functions
 * 
 * This script creates a clean, production-ready build using esbuild:
 * 1. Bundles all TypeScript into a single CommonJS file
 * 2. Handles external dependencies properly
 * 3. Creates a clean deploy directory
 * 4. Ensures Firebase Functions compatibility
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🚀 Building production backend for Firebase Functions...');

// Clean up previous builds
const distDir = './dist';
const deployDir = '../deploy/functions';

if (fs.existsSync(distDir)) {
  console.log('🧹 Cleaning previous build...');
  fs.rmSync(distDir, { recursive: true, force: true });
}

if (fs.existsSync(deployDir)) {
  console.log('🧹 Cleaning previous deploy...');
  fs.rmSync(deployDir, { recursive: true, force: true });
}

// Create directories
fs.mkdirSync(distDir, { recursive: true });
fs.mkdirSync(deployDir, { recursive: true });

console.log('📦 Bundling TypeScript with esbuild...');

// Build the main server with esbuild
const esbuildCommand = [
  'npx esbuild server.ts',
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--outfile=dist/server.js',
  '--external:firebase-admin',
  '--external:@google-cloud/firestore',
  '--external:stripe',
  '--external:canvas',
  '--external:sharp',
  '--external:multer',
  '--external:busboy',
  '--external:axios',
  '--external:string-similarity',
  '--external:node-fetch',
  '--sourcemap'
].join(' ');

try {
  execSync(esbuildCommand, { stdio: 'inherit' });
  console.log('✅ TypeScript bundling complete');
} catch (error) {
  console.error('❌ TypeScript bundling failed:', error.message);
  process.exit(1);
}

// Create Firebase Functions package.json
const functionsPackageJson = {
  "name": "ai-marking-functions",
  "version": "1.0.0",
  "description": "AI Marking Firebase Functions",
  "main": "index.js",
  "type": "commonjs",
  "engines": {
    "node": "18"
  },
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "@google-cloud/firestore": "^7.11.3",
    "@grpc/proto-loader": "^0.8.0",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "express-rate-limit": "^7.1.5",
    "firebase-admin": "^13.5.0",
    "firebase-functions": "^6.4.0",
    "google-gax": "^5.0.3",
    "helmet": "^7.1.0",
    "sharp": "^0.34.3",
    "stripe": "^18.5.0",
    "uuid": "^9.0.1",
    "multer": "^1.4.4-lts.1",
    "busboy": "^1.6.0",
    "axios": "^1.11.0",
    "canvas": "^3.2.0",
    "string-similarity": "^4.0.4",
    "node-fetch": "^3.3.2"
  }
};

// Write package.json for Firebase Functions
fs.writeFileSync(
  path.join(deployDir, 'package.json'),
  JSON.stringify(functionsPackageJson, null, 2)
);

// Copy the bundled server.js
fs.copyFileSync(
  path.join(distDir, 'server.js'),
  path.join(deployDir, 'server.js')
);

// Create Firebase Functions index.js (v1)
const indexJs = `const functions = require('firebase-functions/v1');
const app = require('./server.js').default || require('./server.js');

// Export the Express app as a Firebase Function
// Using v1 specific package for stability in v6+ environments
exports.api = functions.runWith({
  timeoutSeconds: 300,
  memory: '2GB'
}).https.onRequest(app);
`;

fs.writeFileSync(path.join(deployDir, 'index.js'), indexJs);

// Copy environment file if it exists
const envFile = '.env.local';
if (fs.existsSync(envFile)) {
  fs.copyFileSync(envFile, path.join(deployDir, envFile));
  console.log('✅ Copied environment file');
}

// Copy Firebase service account key if it exists
const serviceAccountFile = 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json';
if (fs.existsSync(serviceAccountFile)) {
  fs.copyFileSync(serviceAccountFile, path.join(deployDir, serviceAccountFile));
  console.log('✅ Copied service account key');
}

console.log('✅ Production build complete!');
console.log(`📁 Files ready in ${deployDir}`);
console.log('📋 Build summary:');
console.log('  - server.js: Bundled CommonJS file');
console.log('  - index.js: Firebase Functions entry point');
console.log('  - package.json: Firebase Functions dependencies');
console.log('  - .env.local: Environment variables (if exists)');
console.log('  - Service account key (if exists)');
