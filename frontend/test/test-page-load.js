#!/usr/bin/env node

const puppeteer = require('puppeteer');

async function testPageLoad() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  try {
    console.log('🧪 Testing page load...');
    
    // Listen for console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error('❌ Console Error:', msg.text());
      } else if (msg.text().includes('error') || msg.text().includes('Error')) {
        console.log('⚠️  Console Warning:', msg.text());
      }
    });

    // Listen for page errors
    page.on('pageerror', error => {
      console.error('❌ Page Error:', error.message);
    });

    await page.goto('http://localhost:3000/mark-homework');
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    const title = await page.title();
    console.log('Page title:', title);
    
    // Check if the page loaded
    const mainContent = await page.$('.mark-homework-main-content');
    if (mainContent) {
      console.log('✅ Main content loaded');
    } else {
      console.log('❌ Main content not found');
    }
    
    // Check for any error messages
    const errorElements = await page.$$('[class*="error"], [class*="Error"]');
    if (errorElements.length > 0) {
      console.log('❌ Error elements found:', errorElements.length);
      for (let i = 0; i < errorElements.length; i++) {
        const text = await errorElements[i].evaluate(el => el.textContent);
        console.log(`  Error ${i + 1}:`, text);
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
}

testPageLoad();
