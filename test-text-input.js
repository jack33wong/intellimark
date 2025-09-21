#!/usr/bin/env node

const puppeteer = require('puppeteer');

async function testTextInput() {
  let browser;
  
  try {
    console.log('🧪 Testing text input functionality...\n');
    
    browser = await puppeteer.launch({ 
      headless: false,
      defaultViewport: null,
      args: ['--start-maximized']
    });
    
    const page = await browser.newPage();
    
    // Navigate to the app
    console.log('📱 Navigating to http://localhost:3000...');
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle2' });
    
    // Wait for the page to load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test 1: First-time mode text input
    console.log('\n🔍 Test 1: First-time mode text input');
    
    // Look for the main textarea in first-time mode
    const firstTimeTextarea = await page.$('.main-chat-input');
    if (firstTimeTextarea) {
      console.log('✅ Found first-time textarea');
      
      // Test typing in the textarea
      await firstTimeTextarea.click();
      await firstTimeTextarea.type('This is a test message for first-time mode');
      
      // Check if the text was actually entered
      const textValue = await firstTimeTextarea.evaluate(el => el.value);
      if (textValue.includes('test message')) {
        console.log('✅ First-time text input working - text was entered');
      } else {
        console.log('❌ First-time text input failed - text not entered');
      }
    } else {
      console.log('❌ First-time textarea not found');
    }
    
    // Test 2: Navigate to mark-homework page for follow-up mode
    console.log('\n🔍 Test 2: Follow-up mode text input');
    
    // Click on mark homework in sidebar
    const markHomeworkLink = await page.$('a[href="/mark-homework"]');
    if (markHomeworkLink) {
      await markHomeworkLink.click();
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Look for the follow-up textarea
      const followUpTextarea = await page.$('.followup-text-input');
      if (followUpTextarea) {
        console.log('✅ Found follow-up textarea');
        
        // Test typing in the follow-up textarea
        await followUpTextarea.click();
        await followUpTextarea.type('This is a test follow-up message');
        
        // Check if the text was actually entered
        const followUpTextValue = await followUpTextarea.evaluate(el => el.value);
        if (followUpTextValue.includes('follow-up message')) {
          console.log('✅ Follow-up text input working - text was entered');
        } else {
          console.log('❌ Follow-up text input failed - text not entered');
        }
      } else {
        console.log('❌ Follow-up textarea not found');
      }
    } else {
      console.log('❌ Mark homework link not found');
    }
    
    // Test 3: Check if textareas are not readOnly
    console.log('\n🔍 Test 3: Checking readOnly attributes');
    
    const allTextareas = await page.$$('textarea');
    for (let i = 0; i < allTextareas.length; i++) {
      const isReadOnly = await allTextareas[i].evaluate(el => el.readOnly);
      const placeholder = await allTextareas[i].evaluate(el => el.placeholder);
      console.log(`Textarea ${i + 1}: readOnly=${isReadOnly}, placeholder="${placeholder}"`);
      
      if (isReadOnly) {
        console.log('❌ Found readOnly textarea - this will prevent text input');
      } else {
        console.log('✅ Textarea is not readOnly - text input should work');
      }
    }
    
    console.log('\n🎉 Text input testing completed!');
    console.log('\nPress any key to close the browser...');
    
    // Wait for user input before closing
    await new Promise(resolve => {
      process.stdin.once('data', () => resolve());
    });
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

testTextInput();
