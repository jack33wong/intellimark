const fs = require('fs');
const path = require('path');

// Create dist/routes directory if it doesn't exist
const distRoutesDir = 'dist/routes';
if (!fs.existsSync(distRoutesDir)) {
  fs.mkdirSync(distRoutesDir, { recursive: true });
}

// Copy all .js files from routes to dist/routes
const routesDir = 'routes';
if (fs.existsSync(routesDir)) {
  const files = fs.readdirSync(routesDir).filter(file => file.endsWith('.js'));
  files.forEach(file => {
    const srcPath = path.join(routesDir, file);
    const destPath = path.join(distRoutesDir, file);
    fs.copyFileSync(srcPath, destPath);
    console.log(`Copied ${file} to dist/routes/`);
  });
} else {
  console.log('Routes directory not found');
}
