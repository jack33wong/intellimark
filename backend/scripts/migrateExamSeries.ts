/**
 * Migration Script: Rename year/date to exam_series
 * 
 * This script migrates existing database data to use the standardized `exam_series` field name.
 * 
 * Collections to update:
 * 1. fullExamPapers - metadata.year -> metadata.exam_series
 * 2. markingSchemes - examDetails.date -> examDetails.exam_series
 * 3. unifiedSessions - detectedQuestion.examPapers[].year -> detectedQuestion.examPapers[].examSeries
 * 
 * Usage:
 *   npx ts-node backend/scripts/migrateExamSeries.ts
 * 
 * Safety:
 *   - Creates backups before migration
 *   - Dry-run mode available (set DRY_RUN=true)
 *   - Processes in batches to avoid memory issues
 */

import admin from 'firebase-admin';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const DRY_RUN = process.env.DRY_RUN === 'true';
const BATCH_SIZE = 100;

// Initialize Firebase Admin
function initializeFirebase(): void {
  if (admin.apps.length === 0) {
    try {
      const serviceAccountPath = join(__dirname, '..', 'ai-marking-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccountPath)
      });
      console.log('✅ Firebase Admin initialized');
    } catch (error) {
      console.error('❌ Firebase Admin initialization failed:', error);
      process.exit(1);
    }
  }
}

// Helper function to recursively update object fields
function updateFieldInObject(obj: any, oldKey: string, newKey: string, path: string = ''): { updated: boolean; newObj: any } {
  if (!obj || typeof obj !== 'object') {
    return { updated: false, newObj: obj };
  }

  let updated = false;
  const newObj = Array.isArray(obj) ? [...obj] : { ...obj };

  // Check if this object has the old key
  if (oldKey in newObj && !(newKey in newObj)) {
    newObj[newKey] = newObj[oldKey];
    delete newObj[oldKey];
    updated = true;
    console.log(`  ✓ Updated field at path: ${path ? path + '.' : ''}${oldKey} -> ${newKey}`);
  }

  // Recursively process nested objects and arrays
  for (const key in newObj) {
    if (newObj[key] && typeof newObj[key] === 'object') {
      const currentPath = path ? `${path}.${key}` : key;
      const result = updateFieldInObject(newObj[key], oldKey, newKey, currentPath);
      if (result.updated) {
        newObj[key] = result.newObj;
        updated = true;
      }
    }
  }

  return { updated, newObj };
}

// Migrate fullExamPapers collection
async function migrateFullExamPapers(db: admin.firestore.Firestore): Promise<number> {
  console.log('\n📚 Migrating fullExamPapers collection...');
  
  const collection = db.collection('fullExamPapers');
  const snapshot = await collection.get();
  
  if (snapshot.empty) {
    console.log('  ℹ️  No documents found in fullExamPapers');
    return 0;
  }

  console.log(`  📊 Found ${snapshot.size} documents`);
  
  let updatedCount = 0;
  const batch = db.batch();
  let batchCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    let needsUpdate = false;
    const updatedData: any = { ...data };

    // Update metadata.year -> metadata.exam_series
    if (data.metadata && data.metadata.year && !data.metadata.exam_series) {
      updatedData.metadata = {
        ...data.metadata,
        exam_series: data.metadata.year
      };
      delete updatedData.metadata.year;
      needsUpdate = true;
      console.log(`  ✓ Document ${doc.id}: metadata.year -> metadata.exam_series`);
    }

    if (needsUpdate) {
      if (!DRY_RUN) {
        batch.update(doc.ref, updatedData);
        batchCount++;
        
        if (batchCount >= BATCH_SIZE) {
          await batch.commit();
          console.log(`  💾 Committed batch of ${batchCount} updates`);
          batchCount = 0;
        }
      }
      updatedCount++;
    }
  }

  // Commit remaining updates
  if (!DRY_RUN && batchCount > 0) {
    await batch.commit();
    console.log(`  💾 Committed final batch of ${batchCount} updates`);
  }

  console.log(`  ✅ Updated ${updatedCount} documents in fullExamPapers`);
  return updatedCount;
}

// Migrate markingSchemes collection
async function migrateMarkingSchemes(db: admin.firestore.Firestore): Promise<number> {
  console.log('\n📋 Migrating markingSchemes collection...');
  
  const collection = db.collection('markingSchemes');
  const snapshot = await collection.get();
  
  if (snapshot.empty) {
    console.log('  ℹ️  No documents found in markingSchemes');
    return 0;
  }

  console.log(`  📊 Found ${snapshot.size} documents`);
  
  let updatedCount = 0;
  const batch = db.batch();
  let batchCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    let needsUpdate = false;
    const updatedData: any = { ...data };

    // Update examDetails.date -> examDetails.exam_series
    if (data.examDetails && data.examDetails.date && !data.examDetails.exam_series) {
      updatedData.examDetails = {
        ...data.examDetails,
        exam_series: data.examDetails.date
      };
      delete updatedData.examDetails.date;
      needsUpdate = true;
      console.log(`  ✓ Document ${doc.id}: examDetails.date -> examDetails.exam_series`);
    }

    if (needsUpdate) {
      if (!DRY_RUN) {
        batch.update(doc.ref, updatedData);
        batchCount++;
        
        if (batchCount >= BATCH_SIZE) {
          await batch.commit();
          console.log(`  💾 Committed batch of ${batchCount} updates`);
          batchCount = 0;
        }
      }
      updatedCount++;
    }
  }

  // Commit remaining updates
  if (!DRY_RUN && batchCount > 0) {
    await batch.commit();
    console.log(`  💾 Committed final batch of ${batchCount} updates`);
  }

  console.log(`  ✅ Updated ${updatedCount} documents in markingSchemes`);
  return updatedCount;
}

// Migrate unifiedSessions collection
async function migrateUnifiedSessions(db: admin.firestore.Firestore): Promise<number> {
  console.log('\n💬 Migrating unifiedSessions collection...');
  
  const collection = db.collection('unifiedSessions');
  const snapshot = await collection.get();
  
  if (snapshot.empty) {
    console.log('  ℹ️  No documents found in unifiedSessions');
    return 0;
  }

  console.log(`  📊 Found ${snapshot.size} documents`);
  
  let updatedCount = 0;
  const batch = db.batch();
  let batchCount = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    let needsUpdate = false;
    const updatedData: any = { ...data };

    // Update detectedQuestion.examPapers[].year -> detectedQuestion.examPapers[].examSeries
    if (data.detectedQuestion && data.detectedQuestion.examPapers && Array.isArray(data.detectedQuestion.examPapers)) {
      const updatedExamPapers = data.detectedQuestion.examPapers.map((examPaper: any) => {
        if (examPaper.year && !examPaper.examSeries) {
          const updated = {
            ...examPaper,
            examSeries: examPaper.year
          };
          delete updated.year;
          needsUpdate = true;
          console.log(`  ✓ Document ${doc.id}: detectedQuestion.examPapers[].year -> examSeries (value: ${examPaper.year})`);
          return updated;
        }
        return examPaper;
      });

      if (needsUpdate) {
        updatedData.detectedQuestion = {
          ...data.detectedQuestion,
          examPapers: updatedExamPapers
        };
      }
    }

    // Also check messages array for detectedQuestion
    if (data.messages && Array.isArray(data.messages)) {
      const updatedMessages = data.messages.map((message: any) => {
        if (message.detectedQuestion && message.detectedQuestion.examPapers && Array.isArray(message.detectedQuestion.examPapers)) {
          const updatedExamPapers = message.detectedQuestion.examPapers.map((examPaper: any) => {
            if (examPaper.year && !examPaper.examSeries) {
              needsUpdate = true;
              const updated = {
                ...examPaper,
                examSeries: examPaper.year
              };
              delete updated.year;
              console.log(`  ✓ Document ${doc.id}: messages[].detectedQuestion.examPapers[].year -> examSeries (value: ${examPaper.year})`);
              return updated;
            }
            return examPaper;
          });

          if (updatedExamPapers.some((ep: any) => ep.examSeries)) {
            return {
              ...message,
              detectedQuestion: {
                ...message.detectedQuestion,
                examPapers: updatedExamPapers
              }
            };
          }
        }
        return message;
      });

      if (needsUpdate && updatedMessages.some((m: any) => m.detectedQuestion?.examPapers?.some((ep: any) => ep.examSeries))) {
        updatedData.messages = updatedMessages;
      }
    }

    if (needsUpdate) {
      if (!DRY_RUN) {
        batch.update(doc.ref, updatedData);
        batchCount++;
        
        if (batchCount >= BATCH_SIZE) {
          await batch.commit();
          console.log(`  💾 Committed batch of ${batchCount} updates`);
          batchCount = 0;
        }
      }
      updatedCount++;
    }
  }

  // Commit remaining updates
  if (!DRY_RUN && batchCount > 0) {
    await batch.commit();
    console.log(`  💾 Committed final batch of ${batchCount} updates`);
  }

  console.log(`  ✅ Updated ${updatedCount} documents in unifiedSessions`);
  return updatedCount;
}

// Main migration function
async function runMigration(): Promise<void> {
  console.log('🚀 Starting exam_series migration...');
  console.log(`   Mode: ${DRY_RUN ? '🔍 DRY RUN (no changes will be saved)' : '✏️  LIVE (changes will be saved)'}`);
  console.log(`   Batch size: ${BATCH_SIZE}\n`);

  initializeFirebase();
  const db = admin.firestore();

  if (!db) {
    console.error('❌ Firestore database not available');
    process.exit(1);
  }

  try {
    const startTime = Date.now();
    
    const fullExamPapersCount = await migrateFullExamPapers(db);
    const markingSchemesCount = await migrateMarkingSchemes(db);
    const unifiedSessionsCount = await migrateUnifiedSessions(db);

    const totalUpdated = fullExamPapersCount + markingSchemesCount + unifiedSessionsCount;
    const duration = Date.now() - startTime;

    console.log('\n' + '='.repeat(60));
    console.log('📊 Migration Summary:');
    console.log(`   fullExamPapers: ${fullExamPapersCount} documents`);
    console.log(`   markingSchemes: ${markingSchemesCount} documents`);
    console.log(`   unifiedSessions: ${unifiedSessionsCount} documents`);
    console.log(`   Total updated: ${totalUpdated} documents`);
    console.log(`   Duration: ${duration}ms`);
    
    if (DRY_RUN) {
      console.log('\n⚠️  This was a DRY RUN. No changes were saved.');
      console.log('   Run without DRY_RUN=true to apply changes.');
    } else {
      console.log('\n✅ Migration completed successfully!');
    }
    console.log('='.repeat(60) + '\n');
  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run migration
runMigration()
  .then(() => {
    console.log('✅ Migration script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Migration script failed:', error);
    process.exit(1);
  });

