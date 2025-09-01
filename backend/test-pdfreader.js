const PdfReader = require('pdfreader').PdfReader;
const fs = require('fs');

async function testPdfReader() {
  console.log('Testing pdfreader on AQA exam paper...');
  
  const items = [];
  const questions = [];
  
  return new Promise((resolve, reject) => {
    new PdfReader().parseFileItems('./uploads/AQA/2024/AQA-83001H-QP-JUN24.PDF', (err, item) => {
      if (err) {
        console.error('Error:', err);
        reject(err);
        return;
      }
      
      if (!item) {
        // End of file - process collected items
        console.log(`\nCollected ${items.length} text items from PDF`);
        
        // Group items by page and sort by position
        const pageItems = {};
        items.forEach(item => {
          if (!pageItems[item.page]) pageItems[item.page] = [];
          pageItems[item.page].push(item);
        });
        
        // Sort each page by Y position (top to bottom), then X position (left to right)
        Object.keys(pageItems).forEach(page => {
          pageItems[page].sort((a, b) => {
            if (Math.abs(a.y - b.y) < 0.5) { // Same line
              return a.x - b.x; // Sort by X position
            }
            return a.y - b.y; // Sort by Y position
          });
        });
        
        // Look for question patterns
        console.log('\n=== ANALYZING QUESTION PATTERNS ===');
        let foundQ7 = false;
        let q7Content = [];
        
        Object.keys(pageItems).forEach(page => {
          console.log(`\n--- Page ${page} ---`);
          const pageText = pageItems[page];
          
          pageText.forEach((item, index) => {
            // Look for question 7 specifically
            if (item.text && (item.text.trim() === '7' || item.text.includes('cone'))) {
              console.log(`Found Q7 candidate: "${item.text}" at (${item.x.toFixed(1)}, ${item.y.toFixed(1)})`);
              foundQ7 = true;
            }
            
            // Look for sub-question patterns
            if (item.text && /^\s*\(?\s*[abc]\s*\)?\s*$/.test(item.text.trim())) {
              console.log(`Found sub-question marker: "${item.text}" at (${item.x.toFixed(1)}, ${item.y.toFixed(1)})`);
            }
            
            // Show some context around question numbers
            if (item.text && /^\s*\d+\s*$/.test(item.text.trim())) {
              const qNum = parseInt(item.text.trim());
              if (qNum >= 1 && qNum <= 30) {
                console.log(`Question ${qNum} at (${item.x.toFixed(1)}, ${item.y.toFixed(1)})`);
                
                // Show next few items for context
                const context = pageText.slice(index + 1, index + 5)
                  .map(contextItem => contextItem.text)
                  .join(' ')
                  .substring(0, 100);
                console.log(`  Context: ${context}...`);
              }
            }
          });
        });
        
        // Specific analysis for Question 7
        console.log('\n=== QUESTION 7 DETAILED ANALYSIS ===');
        Object.keys(pageItems).forEach(page => {
          const pageText = pageItems[page];
          
          pageText.forEach((item, index) => {
            if (item.text && (item.text.trim() === '7' || item.text.includes('Here is a cone'))) {
              console.log(`\nQ7 found on page ${page}:`);
              console.log(`Position: (${item.x.toFixed(1)}, ${item.y.toFixed(1)})`);
              console.log(`Text: "${item.text}"`);
              
              // Extract surrounding content
              const surroundingItems = pageText.slice(Math.max(0, index - 2), index + 20);
              console.log('\nSurrounding content:');
              surroundingItems.forEach(surrounding => {
                if (surrounding.text) {
                  console.log(`  "${surrounding.text}" at (${surrounding.x.toFixed(1)}, ${surrounding.y.toFixed(1)})`);
                }
              });
            }
          });
        });
        
        resolve({ items, pageItems, totalItems: items.length });
      } else if (item.text) {
        // Store text item with position information
        items.push({
          page: item.page || 0,
          x: item.x || 0,
          y: item.y || 0,
          text: item.text,
          width: item.width || 0,
          height: item.height || 0
        });
      }
    });
  });
}

// Run the test
testPdfReader()
  .then(result => {
    console.log(`\nTest completed! Processed ${result.totalItems} text items.`);
  })
  .catch(error => {
    console.error('Test failed:', error);
  });

