const admin = require('firebase-admin');
const serviceAccount = require('./intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}

const db = admin.firestore();

async function findId() {
    const id = '019349c2-5c8e-7356-8367-9d7e3240ea05';
    const collections = ['fullExamPapers', 'markingSchemes', 'gradeBoundaries'];
    
    for (const coll of collections) {
        console.log(`Checking collection ${coll} for ID ${id}...`);
        const doc = await db.collection(coll).doc(id).get();
        if (doc.exists) {
            console.log(`FOUND in ${coll}!`);
            const data = doc.data();
            console.log('Questions field exists:', !!data.questions);
            if (data.questions) {
                console.log('Questions is array:', Array.isArray(data.questions));
                console.log('Questions length/keys:', Array.isArray(data.questions) ? data.questions.length : Object.keys(data.questions).length);
            }
            console.log('markingSchemeData exists:', !!data.markingSchemeData);
        }
    }
    process.exit();
}

findId();
