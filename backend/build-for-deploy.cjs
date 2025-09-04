#!/usr/bin/env node

/**
 * Build script for Firebase deployment
 * This script creates a clean deployment build by copying existing compiled files
 * and ensuring all necessary files are included
 */

const fs = require('fs');
const path = require('path');

console.log('🚀 Building backend for Firebase deployment...');

// Create dist directory
const distDir = './dist';
if (fs.existsSync(distDir)) {
  console.log('📁 Using existing dist directory');
} else {
  console.log('📁 Creating dist directory');
  fs.mkdirSync(distDir, { recursive: true });
}

// Copy essential files
const filesToCopy = [
  { src: './server.js', dest: './dist/server.js' },
  { src: './package.json', dest: './dist/package.json' },
  { src: './package-lock.json', dest: './dist/package-lock.json' }
];

// Copy directories
const dirsToCopy = [
  { src: './routes', dest: './dist/routes' },
  { src: './services', dest: './dist/services' },
  { src: './config', dest: './dist/config' },
  { src: './types', dest: './dist/types' },
  { src: './middleware', dest: './dist/middleware' }
];

// Copy files
filesToCopy.forEach(({ src, dest }) => {
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log(`✅ Copied ${src} → ${dest}`);
  } else {
    console.log(`⚠️  File not found: ${src}`);
  }
});

// Copy directories
dirsToCopy.forEach(({ src, dest }) => {
  if (fs.existsSync(src)) {
    copyDir(src, dest);
    console.log(`✅ Copied directory ${src} → ${dest}`);
  } else {
    console.log(`⚠️  Directory not found: ${src}`);
  }
});

// Copy environment files if they exist
const envFiles = ['.env.local', 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json'];
envFiles.forEach(file => {
  if (fs.existsSync(file)) {
    fs.copyFileSync(file, `./dist/${file}`);
    console.log(`✅ Copied ${file}`);
  }
});

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }
  
  const items = fs.readdirSync(src);
  items.forEach(item => {
    const srcPath = path.join(src, item);
    const destPath = path.join(dest, item);
    
    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  });
}

console.log('✅ Backend build complete!');
console.log('📁 Files ready in ./dist/ directory');
