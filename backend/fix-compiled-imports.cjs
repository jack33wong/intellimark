#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

function fixImportsInFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;

    // Fix relative imports that are missing .js extensions
    const importRegex = /import\s+.*?\s+from\s+['"](\.\/[^'"]+)['"]/g;
    content = content.replace(importRegex, (match, importPath) => {
      if (!importPath.endsWith('.js') && !importPath.endsWith('.json')) {
        modified = true;
        return match.replace(importPath, importPath + '.js');
      }
      return match;
    });

    // Fix dynamic imports
    const dynamicImportRegex = /import\s*\(\s*['"](\.\/[^'"]+)['"]\s*\)/g;
    content = content.replace(dynamicImportRegex, (match, importPath) => {
      if (!importPath.endsWith('.js') && !importPath.endsWith('.json')) {
        modified = true;
        return match.replace(importPath, importPath + '.js');
      }
      return match;
    });

    if (modified) {
      fs.writeFileSync(filePath, content);
      console.log(`Fixed imports in: ${filePath}`);
    }
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message);
  }
}

function walkDirectory(dir) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      walkDirectory(filePath);
    } else if (file.endsWith('.js')) {
      fixImportsInFile(filePath);
    }
  }
}

console.log('Fixing compiled imports...');
walkDirectory(path.join(__dirname, 'dist'));
console.log('Done!');
