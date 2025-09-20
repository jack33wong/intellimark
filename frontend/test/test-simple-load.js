#!/usr/bin/env node

const puppeteer = require('puppeteer');

async function testSimpleLoad() {
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  try {
    console.log('🧪 Testing simple page load...');
    
    // Listen for console errors
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error('❌ Console Error:', msg.text());
      }
    });

    // Listen for page errors
    page.on('pageerror', error => {
      console.error('❌ Page Error:', error.message);
    });

    await page.goto('http://localhost:3000/mark-homework');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    const title = await page.title();
    console.log('Page title:', title);
    
    // Check if the page loaded
    const mainContent = await page.$('.mark-homework-main-content');
    if (mainContent) {
      console.log('✅ Main content loaded');
    } else {
      console.log('❌ Main content not found');
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await browser.close();
  }
}

testSimpleLoad();
