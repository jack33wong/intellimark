#!/usr/bin/env tsx

/**
 * List All Available Prompts
 * 
 * This script shows all available prompts in the centralized configuration.
 * 
 * Usage:
 *   npm run list-prompts
 *   or
 *   tsx scripts/list-prompts.ts
 */

import { getPromptPaths, getPrompt } from '../config/prompts.js';

function listPrompts() {
  console.log('📋 [CENTRALIZED PROMPTS] All available prompts:');
  console.log('=' .repeat(60));
  
  const promptPaths = getPromptPaths();
  
  promptPaths.forEach(path => {
    console.log(`\n🔹 ${path}`);
    try {
      const prompt = getPrompt(path);
      const preview = prompt.length > 100 
        ? prompt.substring(0, 100) + '...' 
        : prompt;
      console.log(`   Preview: ${preview}`);
    } catch (error) {
      console.log(`   ⚠️  Function prompt (requires parameters)`);
    }
  });
  
  console.log('\n' + '=' .repeat(60));
  console.log('💡 [EDIT PROMPTS] File: backend/config/prompts.ts');
  console.log('🚀 [TEST PROMPTS] Run: npm run test:ai-response');
}

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  listPrompts();
}
