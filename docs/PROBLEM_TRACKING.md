# Problem Tracking

This document tracks all reported problems and their status.

## Current Problems

### 1. Q12i/Q12ii/Q12iii: Marking scheme not found
**Status**: ✅ Fixed (Needs Testing)
**Location**: `backend/services/marking/questionDetectionService.ts`
**Tracking Log**: `[Q12 DEBUG]`
- **Issue**: No marking schemes detected for Q12i, Q12ii, Q12iii
- **Root Cause**: Question detection not matching flat keys (e.g., "12i", "12ii", "12iii") or nested sub-questions
- **Fix Applied**: 
  - Added flat key matching for object structure (e.g., `questions["12i"]`)
  - Enhanced hierarchical matching for nested sub-questions
  - Added Q12-specific debugging logs
- **Next Steps**: Test to verify marking schemes are now found

### 2. Q12i: Wrong blocks assigned
**Status**: ❌ Not Fixed
**Location**: `backend/services/marking/SegmentationService.ts`
**Tracking Log**: `[Q12 DEBUG]`, `[Q12 PROBLEM TRACKING]`
- **Issue**: Q12i gets Q12ii/Q12iii blocks instead of its own student work ("H")
- **Evidence**: 
  - Q12i OCR text shows: "(1)", "(ii) y=-x^3", "F", "(iii) y=-5/x", "J"
  - Classification says Q12i student work is "H" (not in blocks)
  - Only 2 annotations (for "F" and "J" — wrong answers)
- **Root Cause**: Segmentation assigns blocks incorrectly to wrong sub-questions
- **Next Steps**: Fix block assignment logic to match blocks to correct sub-questions using classification student work

### 3. Q12ii: Wrong block assigned
**Status**: ❌ Not Fixed
**Location**: `backend/services/marking/SegmentationService.ts`
**Tracking Log**: `[Q12 DEBUG]`, `[Q12 PROBLEM TRACKING]`
- **Issue**: Q12ii gets Q12i question text instead of its own student work ("F")
- **Evidence**: 
  - Q12ii OCR text shows: "(i) y=x^2-4" (Q12i question text)
  - Classification says Q12ii student work is "F" (not in blocks)
  - Got 1 annotation for "(i) y=x^2-4" (wrong)
- **Root Cause**: Segmentation assigns blocks incorrectly to wrong sub-questions
- **Next Steps**: Fix block assignment logic to match blocks to correct sub-questions using classification student work

### 4. Q12: Question text (nine diagrams) being annotated
**Status**: ✅ Fixed (Partially)
**Location**: `backend/services/marking/SegmentationService.ts`
**Tracking Log**: `[Q12 DEBUG]`
- **Issue**: Question text blocks describing 9 graphs (A-J) are being passed to AI and annotated
- **Root Cause**: Single-letter blocks (A, B, C...) don't match full question text (low similarity), so they pass the filter
- **Fix Applied**: Added filtering for single-letter blocks (A-J) that are part of diagram descriptions
- **Remaining Issue**: Some single-letter blocks still passed to AI (e.g., "F", "J" in Q12i)
- **Next Steps**: Improve block assignment to prevent wrong blocks from being assigned to wrong questions

### 5. Q10: Missing blocks (7 total, only 6 passed to AI)
**Status**: 🔍 In Progress (Enhanced Debugging Added)
**Location**: `backend/services/marking/MarkingExecutor.ts`, `backend/services/marking/SegmentationService.ts`
**Tracking Log**: `[Q10 PROBLEM TRACKING]`, `[Q10 DEBUG]`
- **Issue**: Classification shows 7 lines of student work, but only 6 blocks passed to AI
- **Missing Blocks**: 
  - `"2 x-3 y & =18..."` (Y=277.857) - Actually question text (equation 2), correctly filtered
  - `"10)(-4 y & =46..."` (Y=363.714) - Should match `"$10x - 4y = 46$"` but doesn't
- **Root Cause Identified from Logs**:
  - **Line 927-928**: Both blocks are NOT ASSIGNED because:
    1. They are **above question text boundary** (Y=153-2309, but blocks at Y=277 and Y=363)
    2. They **don't match classification student work** (similarity too low)
  - **⚠️ BOUNDARY ISSUE**: Question text boundary Y=153-2309 is **suspiciously large** ✅ **FIXED**
    - **Problem**: System was using `maxEndY` (maximum Y+height of ALL matching blocks) instead of actual question end Y
    - **Root Cause**: Page footers/metadata ("Turn over" at Y=2272, "a" at Y=2289) were incorrectly identified as question text, pushing endY to 2309
    - **Fix Applied**: 
      - Changed from `maxEndY = Math.max(...all blocks)` to `questionEndY = last block in cluster`
      - Added gap detection: blocks with gaps > 200px are considered isolated (page footers) and excluded
      - Now uses the actual question end Y (last block in the question text cluster)
    - **Expected Result**: Boundary should now be Y=153-400 (after equations), not Y=153-2309
    - **Impact**: Blocks at Y=277 and Y=363 should now be correctly identified as "below boundary" and assigned via Y-position
  - **OCR vs Classification Differences**:
    - OCR: `"10)(-4 y & =46"` (has `"10)("` instead of `"10x"`, `"&"` alignment, `"=46"` no space)
    - Classification: `"$10x - 4y = 46$"` (LaTeX format with spaces)
    - Normalization may not handle these OCR artifacts well
- **Enhanced Debugging Added**:
  - `[Q10 DEBUG]` logs at every stage:
    - Question text filtering: Shows which blocks are filtered as question text
    - Classification matching: Shows similarity scores, normalized text, and why matching fails
    - Block assignment: Shows Y-position assignment, classification matching results
    - Assignment results: Shows which blocks are assigned vs not assigned and why
- **Why Blocks Are Missing Despite Debugging**:
  - The logs show the exact failure point (line 927-928): blocks above boundary don't match classification
  - Root cause: **OCR artifacts** (`"10)("` instead of `"10x"`, `"&"` alignment) cause low similarity
  - Current threshold: 0.75 for full match, 0.50-0.60 for short blocks with substring match
  - The block `"10)(-4 y & =46"` likely has similarity < 0.75 and doesn't pass substring check
- **Next Steps**: 
  1. Run with new debugging to see exact similarity scores for missing block
  2. If similarity is close (0.60-0.75): Lower threshold or improve normalization to handle OCR artifacts
  3. If substring matching fails: Improve substring detection to handle OCR formatting differences
  4. If normalization issue: Enhance normalization to remove `"&"` alignment, handle `"10)("` → `"10x"` conversion

### 6. Q11: No marking annotation on student drawing
**Status**: ❌ Not Fixed
**Location**: `backend/services/marking/MarkingExecutor.ts`, `backend/config/prompts.ts`
**Tracking Log**: `[Q11 PROBLEM TRACKING]`
- **Issue**: Classification did not extract [DRAWING] for coordinate grid transformation
- **Current Status**: Classification shows `"studentWork": "Rotated 90 degrees clockwise about the point (-4, 1)"` (text, not [DRAWING])
- **Log Evidence**: 
  - `[Q11 PROBLEM TRACKING] Classification has [DRAWING]: NO`
  - `[Q11 PROBLEM TRACKING] Total blocks: 4, Annotations: 1, Drawing annotations: 0`
  - `[Q11 PROBLEM TRACKING] ⚠️ Classification did not extract [DRAWING] - may need prompt enhancement for coordinate grid transformations`
- **Root Cause**: Classification prompt may not recognize coordinate grid transformations as drawings
- **Impact**: Student's drawn triangles on the coordinate grid are not being marked
- **Next Steps**: Enhance classification prompt to detect coordinate grid transformations as [DRAWING]

### 7. Q13: AI complains no frequency data for histogram
**Status**: ✅ Fixed
**Location**: `backend/services/marking/MarkingExecutor.ts`, `backend/config/prompts.ts`
**Tracking Log**: `[Q13 PROBLEM TRACKING]`
- **Issue**: AI says "Cannot verify histogram bar heights without original frequency data from the question"
- **Root Cause**: Database question text (with frequency table) was not passed to AI prompt
- **Fix Applied**: 
  - Added `questionText` parameter to `MarkingInputs` interface
  - Pass question text from `fullExamPapers` to AI prompt
  - Added logging to track if question text is passed
- **Status**: Question text is now passed to AI (confirmed in logs)

### 8. Q14: 2 blocks without annotations
**Status**: 🔍 In Progress (Debugging Added)
**Location**: `backend/services/marking/MarkingExecutor.ts`
**Tracking Log**: `[Q14 PROBLEM TRACKING]`
- **Issue**: 2 blocks passed to AI but no annotations returned
- **Missing Blocks**: `q14_Pearson Edexcel_1MA1/1H_step_4`, `q14_Pearson Edexcel_1MA1/1H_step_5`
- **Root Cause**: AI doesn't return annotations (possibly duplicates or low-value content)
- **Note**: First block now has annotation (previously missing, now fixed)
- **Next Steps**: Investigate why AI doesn't annotate these 2 blocks

### 9. Q16: Question text annotated
**Status**: ❌ Not Fixed
**Location**: `backend/services/marking/SegmentationService.ts`
**Tracking Log**: None (needs to be added)
- **Issue**: Q16 annotations include Q17b question text and exam instructions
- **Evidence**: 
  - "(b) Simplify fully √80-√5" (Q17b question text)
  - "3√5" (Q17b student work)
  - "(2)" (mark allocation)
  - "Turn over" (exam instruction)
- **Root Cause**: Segmentation didn't filter Q17b question text from Q16 blocks
- **Next Steps**: Improve cross-question filtering to prevent question text from other questions being assigned

### 10. Q12i, Q12ii, Q12iii: Missing annotations (General)
**Status**: 🔍 In Progress (Partially Fixed)
**Location**: `backend/services/marking/MarkingExecutor.ts`, `backend/services/marking/questionDetectionService.ts`
**Tracking Log**: `[Q12 PROBLEM TRACKING]`
- **Issue**: Q12i, Q12ii, Q12iii have missing annotations or wrong annotations
- **Root Cause**: 
  - Marking scheme missing (now allows basic marking)
  - Wrong blocks assigned (see issues #2 and #3)
  - Question text passed to AI (partially fixed with single-letter filtering)
- **Fix Applied**: Allow marking without schemes (basic marking)
- **Remaining Issues**: Block assignment problems (issues #2 and #3)
- **Next Steps**: Fix block assignment logic

### 11. Q13a, Q22a: Wrong annotation position (top left corner)
**Status**: ✅ Fixed
**Location**: `backend/services/marking/MarkingExecutor.ts`
**Fix**: Improved center position calculation using estimated page height
- Changed from hardcoded `[800, 1200, 600, 400]` to dynamic calculation
- Uses `pageHeight / 2 - 200` for center position
- Estimates page height from existing blocks

## Fixed Issues

### ✅ Q13: AI complains no frequency data for histogram
- **Fixed**: Question text now passed to AI prompt
- **Date**: Recent

### ✅ Q13a, Q22a: Wrong annotation position
- **Fixed**: Dynamic position calculation based on page height
- **Date**: Recent

### ✅ Q12: Single-letter diagram blocks filtered
- **Fixed**: Added filtering for single-letter blocks (A-J) as question text
- **Date**: Recent

## Tracking Log Format

All tracking logs use the format: `[Q{number} PROBLEM TRACKING]` or `[Q{number} DEBUG]`

- ✅ = Problem fixed
- ❌ = Problem still exists
- 🔍 = Debugging in progress

## How to Check Status

After each run, search for `[PROBLEM TRACKING]` or `[DEBUG]` in the logs to see the status of each problem.

## Priority Order

1. **High Priority**: Q12i/Q12ii/Q12iii block assignment (issues #2, #3) - Blocks assigned to wrong questions
2. **High Priority**: Q12i/Q12ii/Q12iii marking scheme lookup (issue #1) - Fixed, needs testing
3. **Medium Priority**: Q11 drawing extraction (issue #6) - Classification not extracting drawings
4. **Medium Priority**: Q10 missing blocks (issue #5) - 2 blocks filtered out
5. **Medium Priority**: Q16 question text filtering (issue #9) - Cross-question text not filtered
6. **Low Priority**: Q14 missing annotations (issue #8) - Likely duplicates

This document tracks all reported problems and their status.

## Current Problems

### 1. Q12i/Q12ii/Q12iii: Marking scheme not found
**Status**: ✅ Fixed (Needs Testing)
**Location**: `backend/services/marking/questionDetectionService.ts`
**Tracking Log**: `[Q12 DEBUG]`
- **Issue**: No marking schemes detected for Q12i, Q12ii, Q12iii
- **Root Cause**: Question detection not matching flat keys (e.g., "12i", "12ii", "12iii") or nested sub-questions
- **Fix Applied**: 
  - Added flat key matching for object structure (e.g., `questions["12i"]`)
  - Enhanced hierarchical matching for nested sub-questions
  - Added Q12-specific debugging logs
- **Next Steps**: Test to verify marking schemes are now found

### 2. Q12i: Wrong blocks assigned
**Status**: ❌ Not Fixed
**Location**: `backend/services/marking/SegmentationService.ts`
**Tracking Log**: `[Q12 DEBUG]`, `[Q12 PROBLEM TRACKING]`
- **Issue**: Q12i gets Q12ii/Q12iii blocks instead of its own student work ("H")
- **Evidence**: 
  - Q12i OCR text shows: "(1)", "(ii) y=-x^3", "F", "(iii) y=-5/x", "J"
  - Classification says Q12i student work is "H" (not in blocks)
  - Only 2 annotations (for "F" and "J" — wrong answers)
- **Root Cause**: Segmentation assigns blocks incorrectly to wrong sub-questions
- **Next Steps**: Fix block assignment logic to match blocks to correct sub-questions using classification student work

### 3. Q12ii: Wrong block assigned
**Status**: ❌ Not Fixed
**Location**: `backend/services/marking/SegmentationService.ts`
**Tracking Log**: `[Q12 DEBUG]`, `[Q12 PROBLEM TRACKING]`
- **Issue**: Q12ii gets Q12i question text instead of its own student work ("F")
- **Evidence**: 
  - Q12ii OCR text shows: "(i) y=x^2-4" (Q12i question text)
  - Classification says Q12ii student work is "F" (not in blocks)
  - Got 1 annotation for "(i) y=x^2-4" (wrong)
- **Root Cause**: Segmentation assigns blocks incorrectly to wrong sub-questions
- **Next Steps**: Fix block assignment logic to match blocks to correct sub-questions using classification student work

### 4. Q12: Question text (nine diagrams) being annotated
**Status**: ✅ Fixed (Partially)
**Location**: `backend/services/marking/SegmentationService.ts`
**Tracking Log**: `[Q12 DEBUG]`
- **Issue**: Question text blocks describing 9 graphs (A-J) are being passed to AI and annotated
- **Root Cause**: Single-letter blocks (A, B, C...) don't match full question text (low similarity), so they pass the filter
- **Fix Applied**: Added filtering for single-letter blocks (A-J) that are part of diagram descriptions
- **Remaining Issue**: Some single-letter blocks still passed to AI (e.g., "F", "J" in Q12i)
- **Next Steps**: Improve block assignment to prevent wrong blocks from being assigned to wrong questions

### 5. Q10: Missing blocks (7 total, only 6 passed to AI)
**Status**: 🔍 In Progress (Enhanced Debugging Added)
**Location**: `backend/services/marking/MarkingExecutor.ts`, `backend/services/marking/SegmentationService.ts`
**Tracking Log**: `[Q10 PROBLEM TRACKING]`, `[Q10 DEBUG]`
- **Issue**: Classification shows 7 lines of student work, but only 6 blocks passed to AI
- **Missing Blocks**: 
  - `"2 x-3 y & =18..."` (Y=277.857) - Actually question text (equation 2), correctly filtered
  - `"10)(-4 y & =46..."` (Y=363.714) - Should match `"$10x - 4y = 46$"` but doesn't
- **Root Cause Identified from Logs**:
  - **Line 927-928**: Both blocks are NOT ASSIGNED because:
    1. They are **above question text boundary** (Y=153-2309, but blocks at Y=277 and Y=363)
    2. They **don't match classification student work** (similarity too low)
  - **⚠️ BOUNDARY ISSUE**: Question text boundary Y=153-2309 is **suspiciously large** ✅ **FIXED**
    - **Problem**: System was using `maxEndY` (maximum Y+height of ALL matching blocks) instead of actual question end Y
    - **Root Cause**: Page footers/metadata ("Turn over" at Y=2272, "a" at Y=2289) were incorrectly identified as question text, pushing endY to 2309
    - **Fix Applied**: 
      - Changed from `maxEndY = Math.max(...all blocks)` to `questionEndY = last block in cluster`
      - Added gap detection: blocks with gaps > 200px are considered isolated (page footers) and excluded
      - Now uses the actual question end Y (last block in the question text cluster)
    - **Expected Result**: Boundary should now be Y=153-400 (after equations), not Y=153-2309
    - **Impact**: Blocks at Y=277 and Y=363 should now be correctly identified as "below boundary" and assigned via Y-position
  - **OCR vs Classification Differences**:
    - OCR: `"10)(-4 y & =46"` (has `"10)("` instead of `"10x"`, `"&"` alignment, `"=46"` no space)
    - Classification: `"$10x - 4y = 46$"` (LaTeX format with spaces)
    - Normalization may not handle these OCR artifacts well
- **Enhanced Debugging Added**:
  - `[Q10 DEBUG]` logs at every stage:
    - Question text filtering: Shows which blocks are filtered as question text
    - Classification matching: Shows similarity scores, normalized text, and why matching fails
    - Block assignment: Shows Y-position assignment, classification matching results
    - Assignment results: Shows which blocks are assigned vs not assigned and why
- **Why Blocks Are Missing Despite Debugging**:
  - The logs show the exact failure point (line 927-928): blocks above boundary don't match classification
  - Root cause: **OCR artifacts** (`"10)("` instead of `"10x"`, `"&"` alignment) cause low similarity
  - Current threshold: 0.75 for full match, 0.50-0.60 for short blocks with substring match
  - The block `"10)(-4 y & =46"` likely has similarity < 0.75 and doesn't pass substring check
- **Next Steps**: 
  1. Run with new debugging to see exact similarity scores for missing block
  2. If similarity is close (0.60-0.75): Lower threshold or improve normalization to handle OCR artifacts
  3. If substring matching fails: Improve substring detection to handle OCR formatting differences
  4. If normalization issue: Enhance normalization to remove `"&"` alignment, handle `"10)("` → `"10x"` conversion

### 6. Q11: No marking annotation on student drawing
**Status**: ❌ Not Fixed
**Location**: `backend/services/marking/MarkingExecutor.ts`, `backend/config/prompts.ts`
**Tracking Log**: `[Q11 PROBLEM TRACKING]`
- **Issue**: Classification did not extract [DRAWING] for coordinate grid transformation
- **Current Status**: Classification shows `"studentWork": "Rotated 90 degrees clockwise about the point (-4, 1)"` (text, not [DRAWING])
- **Log Evidence**: 
  - `[Q11 PROBLEM TRACKING] Classification has [DRAWING]: NO`
  - `[Q11 PROBLEM TRACKING] Total blocks: 4, Annotations: 1, Drawing annotations: 0`
  - `[Q11 PROBLEM TRACKING] ⚠️ Classification did not extract [DRAWING] - may need prompt enhancement for coordinate grid transformations`
- **Root Cause**: Classification prompt may not recognize coordinate grid transformations as drawings
- **Impact**: Student's drawn triangles on the coordinate grid are not being marked
- **Next Steps**: Enhance classification prompt to detect coordinate grid transformations as [DRAWING]

### 7. Q13: AI complains no frequency data for histogram
**Status**: ✅ Fixed
**Location**: `backend/services/marking/MarkingExecutor.ts`, `backend/config/prompts.ts`
**Tracking Log**: `[Q13 PROBLEM TRACKING]`
- **Issue**: AI says "Cannot verify histogram bar heights without original frequency data from the question"
- **Root Cause**: Database question text (with frequency table) was not passed to AI prompt
- **Fix Applied**: 
  - Added `questionText` parameter to `MarkingInputs` interface
  - Pass question text from `fullExamPapers` to AI prompt
  - Added logging to track if question text is passed
- **Status**: Question text is now passed to AI (confirmed in logs)

### 8. Q14: 2 blocks without annotations
**Status**: 🔍 In Progress (Debugging Added)
**Location**: `backend/services/marking/MarkingExecutor.ts`
**Tracking Log**: `[Q14 PROBLEM TRACKING]`
- **Issue**: 2 blocks passed to AI but no annotations returned
- **Missing Blocks**: `q14_Pearson Edexcel_1MA1/1H_step_4`, `q14_Pearson Edexcel_1MA1/1H_step_5`
- **Root Cause**: AI doesn't return annotations (possibly duplicates or low-value content)
- **Note**: First block now has annotation (previously missing, now fixed)
- **Next Steps**: Investigate why AI doesn't annotate these 2 blocks

### 9. Q16: Question text annotated
**Status**: ❌ Not Fixed
**Location**: `backend/services/marking/SegmentationService.ts`
**Tracking Log**: None (needs to be added)
- **Issue**: Q16 annotations include Q17b question text and exam instructions
- **Evidence**: 
  - "(b) Simplify fully √80-√5" (Q17b question text)
  - "3√5" (Q17b student work)
  - "(2)" (mark allocation)
  - "Turn over" (exam instruction)
- **Root Cause**: Segmentation didn't filter Q17b question text from Q16 blocks
- **Next Steps**: Improve cross-question filtering to prevent question text from other questions being assigned

### 10. Q12i, Q12ii, Q12iii: Missing annotations (General)
**Status**: 🔍 In Progress (Partially Fixed)
**Location**: `backend/services/marking/MarkingExecutor.ts`, `backend/services/marking/questionDetectionService.ts`
**Tracking Log**: `[Q12 PROBLEM TRACKING]`
- **Issue**: Q12i, Q12ii, Q12iii have missing annotations or wrong annotations
- **Root Cause**: 
  - Marking scheme missing (now allows basic marking)
  - Wrong blocks assigned (see issues #2 and #3)
  - Question text passed to AI (partially fixed with single-letter filtering)
- **Fix Applied**: Allow marking without schemes (basic marking)
- **Remaining Issues**: Block assignment problems (issues #2 and #3)
- **Next Steps**: Fix block assignment logic

### 11. Q13a, Q22a: Wrong annotation position (top left corner)
**Status**: ✅ Fixed
**Location**: `backend/services/marking/MarkingExecutor.ts`
**Fix**: Improved center position calculation using estimated page height
- Changed from hardcoded `[800, 1200, 600, 400]` to dynamic calculation
- Uses `pageHeight / 2 - 200` for center position
- Estimates page height from existing blocks

## Fixed Issues

### ✅ Q13: AI complains no frequency data for histogram
- **Fixed**: Question text now passed to AI prompt
- **Date**: Recent

### ✅ Q13a, Q22a: Wrong annotation position
- **Fixed**: Dynamic position calculation based on page height
- **Date**: Recent

### ✅ Q12: Single-letter diagram blocks filtered
- **Fixed**: Added filtering for single-letter blocks (A-J) as question text
- **Date**: Recent

## Tracking Log Format

All tracking logs use the format: `[Q{number} PROBLEM TRACKING]` or `[Q{number} DEBUG]`

- ✅ = Problem fixed
- ❌ = Problem still exists
- 🔍 = Debugging in progress

## How to Check Status

After each run, search for `[PROBLEM TRACKING]` or `[DEBUG]` in the logs to see the status of each problem.

## Priority Order

1. **High Priority**: Q12i/Q12ii/Q12iii block assignment (issues #2, #3) - Blocks assigned to wrong questions
2. **High Priority**: Q12i/Q12ii/Q12iii marking scheme lookup (issue #1) - Fixed, needs testing
3. **Medium Priority**: Q11 drawing extraction (issue #6) - Classification not extracting drawings
4. **Medium Priority**: Q10 missing blocks (issue #5) - 2 blocks filtered out
5. **Medium Priority**: Q16 question text filtering (issue #9) - Cross-question text not filtered
6. **Low Priority**: Q14 missing annotations (issue #8) - Likely duplicates
