const fs = require('fs');
const path = require('path');

function convertFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  
  let content = fs.readFileSync(filePath, 'utf8');
  
  // Convert ES6 imports to CommonJS requires
  content = content.replace(/import express from 'express';/g, "const express = require('express');");
  content = content.replace(/import \* as express from 'express';/g, "const express = require('express');");
  content = content.replace(/import type { Request, Response } from 'express';/g, '');
  content = content.replace(/import { ([^}]+) } from '([^']+)';/g, "const { $1 } = require('$2');");
  content = content.replace(/import ([^}]+) from '([^']+)';/g, "const $1 = require('$2');");
  
  // Convert export default to module.exports
  content = content.replace(/export default router;/g, 'module.exports = router;');
  content = content.replace(/export default app;/g, 'module.exports = app;');
  
  // Convert export const to module.exports
  content = content.replace(/export const ([^=]+) =/g, 'const $1 =');
  content = content.replace(/export { ([^}]+) };/g, 'module.exports = { $1 };');
  
  // Remove type annotations
  content = content.replace(/: Request/g, '');
  content = content.replace(/: Response/g, '');
  content = content.replace(/: NextFunction/g, '');
  content = content.replace(/: any/g, '');
  content = content.replace(/: string/g, '');
  content = content.replace(/: number/g, '');
  content = content.replace(/: boolean/g, '');
  content = content.replace(/: object/g, '');
  content = content.replace(/: Array<[^>]+>/g, '');
  content = content.replace(/: Promise<[^>]+>/g, '');
  
  // Fix interface declarations
  content = content.replace(/interface \w+ \{[^}]*\}/g, '');
  
  // Fix type declarations
  content = content.replace(/type \w+ = [^;]+;/g, '');
  
  // Fix declare global
  content = content.replace(/declare global \{[^}]*\}/g, '');
  
  fs.writeFileSync(filePath, content);
  console.log(`Converted: ${filePath}`);
}

// Convert all route files
const routesDir = './routes';
const files = fs.readdirSync(routesDir);
files.forEach(file => {
  if (file.endsWith('.js')) {
    convertFile(path.join(routesDir, file));
  }
});

// Convert middleware files
const middlewareDir = './middleware';
if (fs.existsSync(middlewareDir)) {
  const middlewareFiles = fs.readdirSync(middlewareDir);
  middlewareFiles.forEach(file => {
    if (file.endsWith('.js')) {
      convertFile(path.join(middlewareDir, file));
    }
  });
}

// Convert service files
const servicesDir = './services';
if (fs.existsSync(servicesDir)) {
  const serviceFiles = fs.readdirSync(servicesDir);
  serviceFiles.forEach(file => {
    if (file.endsWith('.js')) {
      convertFile(path.join(servicesDir, file));
    }
  });
}

// Convert config files
const configDir = './config';
if (fs.existsSync(configDir)) {
  const configFiles = fs.readdirSync(configDir);
  configFiles.forEach(file => {
    if (file.endsWith('.js')) {
      convertFile(path.join(configDir, file));
    }
  });
}

console.log('Conversion complete!');
