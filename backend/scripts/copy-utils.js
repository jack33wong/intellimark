const fs = require('fs');
const path = require('path');

// Function to recursively copy directory
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
      console.log(`Copied ${item} to dist/utils/`);
    }
  });
}

// Copy utils directory if it exists
const utilsDir = 'utils';
const distUtilsDir = 'dist/utils';

if (fs.existsSync(utilsDir)) {
  copyDir(utilsDir, distUtilsDir);
  console.log('Utils directory copied successfully');
} else {
  console.log('Utils directory not found');
}
