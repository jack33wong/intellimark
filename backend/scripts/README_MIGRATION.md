# Database Migration: exam_series Field Standardization

## Overview

This migration script renames the `year`/`date` fields to `exam_series` across all collections to standardize the field naming.

## Collections Affected

1. **fullExamPapers**
   - Field change: `metadata.year` → `metadata.exam_series`

2. **markingSchemes**
   - Field change: `examDetails.date` → `examDetails.exam_series`

3. **unifiedSessions**
   - Field change: `detectedQuestion.examPapers[].year` → `detectedQuestion.examPapers[].examSeries`
   - Also updates: `messages[].detectedQuestion.examPapers[].year` → `messages[].detectedQuestion.examPapers[].examSeries`

## Safety Features

- **Dry-run mode**: Test the migration without making changes
- **Batch processing**: Processes documents in batches to avoid memory issues
- **Non-destructive**: Only adds new field, doesn't remove old field until confirmed
- **Detailed logging**: Shows exactly what changes are being made

## Usage

### Step 1: Dry Run (Recommended)

First, run the migration in dry-run mode to see what will be changed:

```bash
cd backend
npm run migrate:exam-series:dry-run
```

This will:
- Show all documents that would be updated
- Display the field changes
- **NOT** save any changes to the database

### Step 2: Run Migration

Once you've reviewed the dry-run output and are satisfied, run the actual migration:

```bash
cd backend
npm run migrate:exam-series
```

This will:
- Update all documents in the affected collections
- Process in batches of 100 documents
- Show progress and summary

## Output Example

```
🚀 Starting exam_series migration...
   Mode: ✏️  LIVE (changes will be saved)
   Batch size: 100

📚 Migrating fullExamPapers collection...
  📊 Found 25 documents
  ✓ Document abc123: metadata.year -> metadata.exam_series
  💾 Committed batch of 25 updates
  ✅ Updated 25 documents in fullExamPapers

📋 Migrating markingSchemes collection...
  📊 Found 15 documents
  ✓ Document xyz789: examDetails.date -> examDetails.exam_series
  💾 Committed batch of 15 updates
  ✅ Updated 15 documents in markingSchemes

💬 Migrating unifiedSessions collection...
  📊 Found 150 documents
  ✓ Document session1: detectedQuestion.examPapers[].year -> examSeries
  💾 Committed batch of 100 updates
  💾 Committed final batch of 50 updates
  ✅ Updated 150 documents in unifiedSessions

============================================================
📊 Migration Summary:
   fullExamPapers: 25 documents
   markingSchemes: 15 documents
   unifiedSessions: 150 documents
   Total updated: 190 documents
   Duration: 2345ms

✅ Migration completed successfully!
============================================================
```

## Environment Variables

- `DRY_RUN=true`: Run in dry-run mode (no database changes)
- Default: Live mode (changes will be saved)

## Notes

- The migration is **idempotent**: Running it multiple times is safe
- Documents that already have `exam_series` will be skipped
- The old `year`/`date` fields are removed after the new field is added
- Processing is done in batches to handle large collections efficiently

## Troubleshooting

If the migration fails:

1. Check Firebase credentials are properly configured
2. Ensure you have write permissions to Firestore
3. Review the error logs for specific document issues
4. Run in dry-run mode first to identify problematic documents

## Rollback

If you need to rollback (not recommended after code changes):

1. The old field names are removed, so you'd need to restore from backup
2. Consider creating a backup before running the migration
3. The migration script does not create automatic backups

