/**
 * Manual Firestore Backup Script
 * 
 * Exports key collections (or all collections) to timestamped JSON files.
 * 
 * Usage:
 *   npx tsx scripts/backup_firestore.ts
 *   npx tsx scripts/backup_firestore.ts --collections=fullExamPapers,markingSchemes,gradeBoundaries,examinerReports
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const serviceAccountPath = path.join(__dirname, '..', 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');

if (!admin.apps.length) {
  if (!fs.existsSync(serviceAccountPath)) {
    console.error(`❌ Service account key not found at: ${serviceAccountPath}`);
    process.exit(1);
  }
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccountPath)
  });
}

const db = admin.firestore();

// Default collections to backup
const DEFAULT_COLLECTIONS = [
  'fullExamPapers',
  'markingSchemes',
  'examinerReports',
  'gradeBoundaries',
  'users',
  'system_config'
];

async function main() {
  const args = process.argv.slice(2);
  let collectionsToBackup = DEFAULT_COLLECTIONS;

  for (const arg of args) {
    if (arg.startsWith('--collections=')) {
      collectionsToBackup = arg.split('=')[1].split(',').map(s => s.trim()).filter(Boolean);
    }
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupDir = path.join(__dirname, '..', 'backups', `firestore_${timestamp}`);
  fs.mkdirSync(backupDir, { recursive: true });

  console.log(`=======================================================`);
  console.log(`📦 Firestore Manual Backup`);
  console.log(`📁 Destination: ${backupDir}`);
  console.log(`=======================================================`);

  const summary: Record<string, { count: number; bytes: number }> = {};

  for (const colName of collectionsToBackup) {
    process.stdout.write(`⏳ Backing up collection: ${colName}... `);
    try {
      const snapshot = await db.collection(colName).get();
      const records: Record<string, any> = {};

      snapshot.forEach(doc => {
        records[doc.id] = doc.data();
      });

      const filePath = path.join(backupDir, `${colName}.json`);
      const jsonContent = JSON.stringify(records, null, 2);
      fs.writeFileSync(filePath, jsonContent, 'utf8');

      summary[colName] = {
        count: snapshot.size,
        bytes: Buffer.byteLength(jsonContent, 'utf8')
      };

      console.log(`✅ ${snapshot.size} docs (${(summary[colName].bytes / 1024).toFixed(1)} KB)`);
    } catch (err: any) {
      console.log(`❌ Error: ${err.message}`);
    }
  }

  // Save metadata file
  const metaPath = path.join(backupDir, '_backup_manifest.json');
  fs.writeFileSync(metaPath, JSON.stringify({
    createdAt: new Date().toISOString(),
    project: 'intellimark-6649e',
    summary
  }, null, 2), 'utf8');

  console.log(`\n🎉 Backup complete! All files saved in:`);
  console.log(`   ${backupDir}\n`);
}

main().catch(err => {
  console.error(`❌ Backup failed:`, err);
  process.exit(1);
});
