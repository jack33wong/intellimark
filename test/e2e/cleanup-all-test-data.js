const DatabaseHelper = require('./utils/DatabaseHelper');

async function cleanupAllTestData() {
  const dbHelper = new DatabaseHelper();
  
  try {
    await dbHelper.connectToFirestore();
    console.log('🧹 Starting complete cleanup of all test data...');
    
    const result = await dbHelper.cleanupAllTestData();
    
    console.log('\n📊 CLEANUP SUMMARY:');
    console.log('==================================================');
    console.log(`✅ Sessions deleted: ${result.sessions}`);
    console.log(`✅ Messages deleted: ${result.messages}`);
    console.log('==================================================');
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
  } finally {
    await dbHelper.close();
    process.exit(0);
  }
}

cleanupAllTestData();
