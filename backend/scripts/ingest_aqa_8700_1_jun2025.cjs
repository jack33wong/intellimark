/**
 * Ingests AQA GCSE English Language Paper 1 (8700/1) — June 2025
 * (Question Paper, Level-of-Response Mark Scheme, Source A Extracts, and Chief Examiner Report)
 * into Firestore collections: `fullExamPapers` and `markingSchemes`.
 */
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const serviceAccountPath = path.join(__dirname, '..', 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');
const serviceAccount = require(serviceAccountPath);

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
}

const db = admin.firestore();

async function ingest() {
  const jsonPath = path.join(__dirname, '..', 'data', 'english', 'aqa_8700_1_jun2025.json');
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));

  const now = new Date().toISOString();

  // 1. Upsert into fullExamPapers
  const qpDocId = raw.fullExamPaper.id || 'aqa-8700-1-jun2025-qp';
  const qpPayload = {
    ...raw.fullExamPaper,
    id: qpDocId,
    uploadedAt: now,
    updatedAt: now
  };
  await db.collection('fullExamPapers').doc(qpDocId).set(qpPayload, { merge: true });
  console.log(`✅ Upserted fullExamPapers/${qpDocId} (${qpPayload.metadata.exam_board} ${qpPayload.metadata.exam_code} ${qpPayload.metadata.exam_series}, ${qpPayload.questions.length} questions, ${qpPayload.totalMarks} marks)`);

  // 2. Upsert into markingSchemes
  const msDocId = raw.markingScheme.id || 'aqa-8700-1-jun2025-ms';
  const msPayload = {
    ...raw.markingScheme,
    id: msDocId,
    uploadedAt: now,
    createdAt: now,
    updatedAt: now
  };
  await db.collection('markingSchemes').doc(msDocId).set(msPayload, { merge: true });
  console.log(`✅ Upserted markingSchemes/${msDocId} (${msPayload.examDetails.board} ${msPayload.examDetails.paperCode} ${msPayload.examDetails.exam_series}, ${msPayload.totalQuestions} questions, ${msPayload.totalMarks} marks)`);

  // 3. Upsert into examinerReports
  if (raw.examinerReport) {
    const erDocId = raw.examinerReport.id || 'aqa-8700-1-jun2025-er';
    const erPayload = {
      ...raw.examinerReport,
      id: erDocId,
      uploadedAt: now,
      createdAt: now,
      updatedAt: now
    };
    await db.collection('examinerReports').doc(erDocId).set(erPayload, { merge: true });
    console.log(`✅ Upserted examinerReports/${erDocId} (${erPayload.examDetails.board} ${erPayload.examDetails.paperCode} ${erPayload.examDetails.exam_series}, ${erPayload.totalQuestions} questions)`);
  }
}

ingest()
  .then(() => {
    console.log('🎉 AQA 8700/1 June 2025 ingestion complete.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('❌ Ingestion failed:', err);
    process.exit(1);
  });
