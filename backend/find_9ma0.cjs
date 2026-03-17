const admin = require('firebase-admin');
const serviceAccount = require('./intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function findMarkingScheme() {
    try {
        console.log('Searching markingSchemes...');
        const snapshot = await db.collection('markingSchemes').get();
        let matchCount = 0;
        
        snapshot.forEach(doc => {
            const data = doc.data();
            const details = data.examDetails || data.exam || data.metadata || {};
            const paperCode = (details.paperCode || details.code || details.exam_code || '').trim();
            
            if (paperCode.toLowerCase().includes('9ma0/31') || JSON.stringify(data).includes('9MA0/31')) {
                matchCount++;
                console.log(`\nMatch #${matchCount}: ID ${doc.id}`);
                console.log(`  Paper Code: "${paperCode}"`);
                console.log(`  Questions: ${Array.isArray(data.questions) ? 'Array' : typeof data.questions} (${Array.isArray(data.questions) ? data.questions.length : (data.questions ? Object.keys(data.questions).length : 0)})`);
            }
        });
        
        console.log(`\nTotal matches: ${matchCount}`);
    } catch (error) {
        console.error('Error:', error);
    } finally {
        process.exit();
    }
}

findMarkingScheme();
