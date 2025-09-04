#!/usr/bin/env node

/**
 * Script to fix import statements in deployment files
 * Adds .js extensions to relative imports for ES modules
 */

const fs = require('fs');
const path = require('path');

function fixImportsInFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    // Fix import statements with relative paths (missing .js extension)
    const importRegex = /import\s+.*?\s+from\s+['"](\.\/[^'"]*?)(?<!\.js)['"]/g;
    content = content.replace(importRegex, (match, importPath) => {
      if (!importPath.endsWith('.js') && !importPath.endsWith('.json')) {
        const newPath = importPath + '.js';
        modified = true;
        return match.replace(importPath, newPath);
      }
      return match;
    });

    // Fix import statements with relative paths (missing .js extension) - more comprehensive
    const importRegex2 = /import\s+.*?\s+from\s+['"](\.\.\/[^'"]*?)(?<!\.js)['"]/g;
    content = content.replace(importRegex2, (match, importPath) => {
      if (!importPath.endsWith('.js') && !importPath.endsWith('.json')) {
        const newPath = importPath + '.js';
        modified = true;
        return match.replace(importPath, newPath);
      }
      return match;
    });

    if (modified) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`✅ Fixed imports in: ${filePath}`);
    }

    return modified;
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error.message);
    return false;
  }
}

function processDirectory(dirPath) {
  const items = fs.readdirSync(dirPath);
  let totalFixed = 0;

  for (const item of items) {
    const fullPath = path.join(dirPath, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory() && !['node_modules'].includes(item)) {
      totalFixed += processDirectory(fullPath);
    } else if (stat.isFile() && item.endsWith('.js')) {
      if (fixImportsInFile(fullPath)) {
        totalFixed++;
      }
    }
  }

  return totalFixed;
}

// Main execution
console.log('🔧 Fixing import statements in deployment files...');
const totalFixed = processDirectory('./functions');
console.log(`\n✅ Fixed imports in ${totalFixed} files`);
console.log('🚀 Ready for Firebase deployment!');