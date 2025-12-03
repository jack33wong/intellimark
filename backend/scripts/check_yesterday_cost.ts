/**
 * Check Yesterday's Gemini Cost from Firestore
 * Calculates cost from usageRecords collection
 */

import admin from 'firebase-admin';
import { join } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function checkYesterdayCost(targetDate?: string) {
    try {
        // Try multiple possible paths for the service account file
        const possiblePaths = [
            process.env.GOOGLE_APPLICATION_CREDENTIALS,
            join(process.cwd(), 'backend', 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json'),
            join(process.cwd(), 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json'),
            join(__dirname, '..', 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json'),
            join(__dirname, 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json')
        ].filter(Boolean) as string[];

        // Find the first path that exists
        const keyFile = possiblePaths.find(path => existsSync(path));

        if (!keyFile) {
            console.error('❌ Service account file not found in any of these locations:');
            possiblePaths.forEach(p => console.error(`   - ${p}`));
            process.exit(1);
        }

        // Initialize Firebase Admin SDK
        if (!admin.apps.length) {
            const serviceAccount = await import(keyFile, { assert: { type: 'json' } });

            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount.default)
            });
        }

        const db = admin.firestore();

        // Calculate date range
        const now = new Date();
        let startDate: Date;
        let endDate: Date;

        if (targetDate) {
            // Parse target date (format: YYYY-MM-DD)
            startDate = new Date(targetDate);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(targetDate);
            endDate.setHours(23, 59, 59, 999);
        } else {
            // Yesterday
            startDate = new Date(now);
            startDate.setDate(startDate.getDate() - 1);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(now);
            endDate.setHours(0, 0, 0, 0);
        }

        console.log(`\n💰 Checking Gemini Cost from Firestore`);
        console.log(`📅 Date Range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

        // Query usageRecords
        const startTimestamp = admin.firestore.Timestamp.fromDate(startDate);
        const endTimestamp = admin.firestore.Timestamp.fromDate(endDate);

        const snapshot = await db.collection('usageRecords')
            .where('createdAt', '>=', startTimestamp)
            .where('createdAt', '<', endTimestamp)
            .get();

        console.log(`\n📊 Found ${snapshot.size} usage records`);

        let totalCost = 0;
        let geminiCost = 0;
        let sessionCount = 0;
        let geminiSessionCount = 0;

        snapshot.forEach((doc) => {
            const data = doc.data();
            sessionCount++;

            // Check if this is a Gemini model
            const modelUsed = data.modelUsed || '';
            const isGemini = modelUsed.toLowerCase().includes('gemini');

            if (isGemini) {
                geminiSessionCount++;
                const cost = data.geminiCost || data.llmCost || 0;
                geminiCost += cost;
            }

            totalCost += data.totalCost || 0;
        });

        console.log(`\n✅ Results:`);
        console.log(`   Total Sessions: ${sessionCount}`);
        console.log(`   Gemini Sessions: ${geminiSessionCount}`);
        console.log(`   Total Gemini Cost: $${geminiCost.toFixed(6)}`);
        console.log(`   Total Cost (All Models): $${totalCost.toFixed(6)}`);
        console.log(`   Date: ${targetDate || 'Yesterday'}`);

        process.exit(0);

    } catch (error) {
        console.error('\n❌ Error:', error instanceof Error ? error.message : error);
        if (error instanceof Error && error.stack) {
            console.error('Stack:', error.stack);
        }
        process.exit(1);
    }
}

// Parse command line arguments
const targetDate = process.argv[2]; // Optional: YYYY-MM-DD
checkYesterdayCost(targetDate);
