# Marking Scheme Alternative Methods Design

## Problem
Some questions (e.g., Q7, Q22) have alternative solution methods in the mark scheme. Currently, we store them as separate entries:
- `"7"` - Main method
- `"7alt"` - Alternative method
- `"22"` - Main method (RHS)
- `"22alt"` - Alternative method (SAS)

## Recommendation: Store as Array Under Same Question Number

### Proposed Structure

```json
{
  "questions": {
    "7": [
      {
        "method": "main",
        "answer": "Shown",
        "marks": [...]
      },
      {
        "method": "alt",
        "answer": "Shown", 
        "marks": [...]
      }
    ]
  }
}
```

### Benefits

1. **Simpler Lookup**: `questions["7"]` returns all methods
2. **AI Flexibility**: AI can evaluate student work against all methods
3. **Natural Grouping**: All methods for same question together
4. **Backward Compatible**: Can add fallback for single-object format

### Implementation Changes Needed

1. **questionDetectionService.ts** (line ~709):
   ```typescript
   // Current:
   if (questions[flatKey]) {
     questionMarks = questions[flatKey];
   }
   
   // Proposed:
   const questionData = questions[flatKey];
   if (questionData) {
     // Handle both array and single object
     if (Array.isArray(questionData)) {
       // Return all methods - AI will choose best match
       questionMarks = questionData;
     } else {
       questionMarks = questionData;
     }
   }
   ```

2. **MarkingInstructionService.ts** (line ~294):
   - Update `normalizeMarkingScheme` to handle array of methods
   - AI prompt should include all methods and let AI choose

3. **Database Migration**:
   - Convert `"7alt"` → merge into `"7"` array
   - Convert `"22alt"` → merge into `"22"` array

### Alternative: Keep Separate but Add Lookup Logic

If we keep separate entries, we need to:

1. **Modify lookup to check for alternatives**:
   ```typescript
   let questionMarks = questions[flatKey];
   if (!questionMarks && questions[`${flatKey}alt`]) {
     questionMarks = questions[`${flatKey}alt`];
   }
   // Or return both if both exist
   ```

2. **Update AI prompt** to include both methods when available

### Recommendation

**Use array structure** - it's cleaner, more maintainable, and allows AI to evaluate all methods simultaneously.





