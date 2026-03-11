import { ExamReferenceService } from '../services/ExamReferenceService.js';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { config } from 'dotenv';
import path from 'path';

config({ path: path.resolve(__dirname, '../../.env') });
import serviceAccount from '../secrets/service-account.json' assert { type: "json" };

const app = initializeApp({
    credential: cert(serviceAccount as any),
    projectId: process.env.FIREBASE_PROJECT_ID
});

async function run() {
    console.log("Searching for J560-01-NOV2020...");
    const res = await ExamReferenceService.findPaper("J560-01-NOV2020");
    if (res) {
        console.log("Matched paper metadata:");
        console.log(res.metadata);
    } else {
        console.log("No paper matched.");
    }
}
run();
