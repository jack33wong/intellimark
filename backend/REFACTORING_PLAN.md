# MarkingRouter.ts Refactoring Plan

## Current State
- **File**: `backend/routes/markingRouter.ts`
- **Lines**: 2494
- **Goal**: Reduce to ~1500-1700 lines (30-40% reduction)

## Refactoring Strategy
**Priority**: Reuse existing files → Create new files only when necessary

---

## Phase 1: Helper Functions → Existing Utilities (Low Risk)

### 1.1 Move to `TextNormalizationUtils.ts`
**Lines to move**: ~50 lines
- `extractQuestionNumberFromFilename()` (lines 184-190)
- Already has similar functions: `getBaseQuestionNumber`, `normalizeSubQuestionPart`

**Impact**: -50 lines from markingRouter.ts

---

### 1.2 Move to `MarkingHelpers.ts`
**Lines to move**: ~150 lines
- `extractQuestionsFromClassification()` (lines 73-118)
- `convertMarkingSchemeToPlainText()` (lines 125-179)
- `formatGroupedStudentWork()` (lines 199-219)

**Impact**: -150 lines from markingRouter.ts

---

## Phase 2: Marking Task Creation → MarkingExecutor.ts (Medium Risk)

### 2.1 Move `createMarkingTasksFromClassification` to `MarkingExecutor.ts`
**Lines to move**: ~175 lines (lines 221-395)
- Already has `MarkingTask` interface defined
- Add as static method: `MarkingExecutor.createMarkingTasksFromClassification()`

**Impact**: -175 lines from markingRouter.ts

**Dependencies**:
- Uses `formatGroupedStudentWork()` → Move to MarkingHelpers first
- Uses `getBaseQuestionNumber()` → Already in TextNormalizationUtils

---

## Phase 3: Score Calculation → MarkingHelpers.ts (Low Risk)

### 3.1 Move Score Calculation Logic
**Lines to move**: ~115 lines (lines 1573-1687)
- `calculateOverallScore()` - Calculate total score from question results
- `calculatePerPageScores()` - Calculate scores per page
- `groupScoresByBaseQuestion()` - Group by base question to avoid double-counting

**Impact**: -115 lines from markingRouter.ts

**Functions to create**:
```typescript
// In MarkingHelpers.ts
export function calculateOverallScore(allQuestionResults: QuestionResult[]): {
  overallScore: number;
  totalPossibleScore: number;
  overallScoreText: string;
}

export function calculatePerPageScores(
  allQuestionResults: QuestionResult[],
  classificationResult: any
): { [pageIndex: number]: { awarded: number; total: number; scoreText: string } }
```

---

## Phase 4: Page Sorting → MarkingHelpers.ts (Medium Risk)

### 4.1 Move Page Sorting Logic
**Lines to move**: ~210 lines (lines 1801-2012)
- `getQuestionSortValue()` - Convert question numbers to sortable values
- `buildPageToQuestionMapping()` - Map pages to question numbers
- `sortPagesByQuestionNumber()` - Sort pages for past papers

**Impact**: -210 lines from markingRouter.ts

**Functions to create**:
```typescript
// In MarkingHelpers.ts
export function getQuestionSortValue(questionNumber: string | null | undefined): number
export function buildPageToQuestionMapping(
  allQuestionResults: QuestionResult[],
  classificationResult: any,
  markingSchemesMap: Map<string, any>
): Map<number, number[]>
export function sortPagesWithOutput(
  standardizedPages: StandardizedPage[],
  annotatedOutput: string[],
  pageToQuestionNumbers: Map<number, number[]>,
  isPastPaper: boolean
): string[]
```

---

## Phase 5: Grade Calculation Orchestration → GradeBoundaryService.ts (Low Risk)

### 5.1 Enhance GradeBoundaryService
**Lines to move**: ~75 lines (lines 2146-2220)
- `extractExamDataFromMarkingSchemes()` - Extract exam data from marking schemes
- `inferSubjectFromExamCode()` - Infer subject from exam code
- `calculateGradeWithOrchestration()` - Orchestrate grade calculation

**Impact**: -75 lines from markingRouter.ts

**Functions to add**:
```typescript
// In GradeBoundaryService.ts
static extractExamDataFromMarkingSchemes(
  markingSchemesMap: Map<string, any>,
  questionDetection?: any
): ExamDataForGrade | null

static inferSubjectFromExamCode(examCode: string): string

static async calculateGradeWithOrchestration(
  markingSchemesMap: Map<string, any>,
  overallScore: number,
  totalPossibleScore: number,
  questionDetection?: any
): Promise<{ grade: string | null; boundaryType: 'Paper-Specific' | 'Overall-Total' | null }>
```

---

## Phase 6: Question Mode Handler → NEW FILE (High Impact)

### 6.1 Create `QuestionModeHandlerService.ts`
**Lines to move**: ~300 lines (lines 1055-1354)
- Question detection orchestration for question mode
- Exam paper grouping
- AI response generation
- Database persistence for question mode

**Why new file?**
- Large, self-contained logic (~300 lines)
- Different from marking mode
- Can be tested independently
- `MarkingPipeline.ts` was removed (was obsolete)

**Impact**: -300 lines from markingRouter.ts

**Service structure**:
```typescript
// backend/services/marking/QuestionModeHandlerService.ts
export class QuestionModeHandlerService {
  static async handleQuestionMode({
    classificationResult,
    standardizedPages,
    files,
    actualModel,
    userId,
    submissionId,
    req,
    res,
    startTime
  }): Promise<QuestionModeResult>
}
```

---

## Summary

| Phase | Component | Target File | Lines | Risk | Priority |
|-------|-----------|-------------|-------|------|----------|
| 1.1 | Text Helpers | `TextNormalizationUtils.ts` | -50 | Low | High |
| 1.2 | Marking Helpers | `MarkingHelpers.ts` | -150 | Low | High |
| 2 | Task Creation | `MarkingExecutor.ts` | -175 | Medium | High |
| 3 | Score Calculation | `MarkingHelpers.ts` | -115 | Low | Medium |
| 4 | Page Sorting | `MarkingHelpers.ts` | -210 | Medium | Medium |
| 5 | Grade Orchestration | `GradeBoundaryService.ts` | -75 | Low | Medium |
| 6 | Question Mode | **NEW**: `QuestionModeHandlerService.ts` | -300 | Medium | High |
| **TOTAL** | | | **-1075** | | |

---

## Execution Order

### Step 1: Helper Functions (Phases 1.1, 1.2)
- Move text utilities → `TextNormalizationUtils.ts`
- Move marking helpers → `MarkingHelpers.ts`
- **Impact**: -200 lines, Low risk

### Step 2: Task Creation (Phase 2)
- Move `createMarkingTasksFromClassification` → `MarkingExecutor.ts`
- **Impact**: -175 lines, Medium risk

### Step 3: Score & Sorting (Phases 3, 4)
- Move score calculation → `MarkingHelpers.ts`
- Move page sorting → `MarkingHelpers.ts`
- **Impact**: -325 lines, Medium risk

### Step 4: Grade Orchestration (Phase 5)
- Enhance `GradeBoundaryService.ts`
- **Impact**: -75 lines, Low risk

### Step 5: Question Mode (Phase 6)
- Create `QuestionModeHandlerService.ts`
- **Impact**: -300 lines, Medium risk

---

## Final File Sizes (Estimated)

| File | Current | After | Change |
|------|---------|-------|--------|
| `markingRouter.ts` | 2494 | ~1420 | -1074 (-43%) |
| `MarkingHelpers.ts` | 384 | ~1040 | +656 |
| `MarkingExecutor.ts` | 833 | ~1008 | +175 |
| `GradeBoundaryService.ts` | 432 | ~507 | +75 |
| `TextNormalizationUtils.ts` | ~260 | ~310 | +50 |
| **NEW**: `QuestionModeHandlerService.ts` | 0 | ~300 | +300 |

---

## Benefits

1. ✅ **No unnecessary new files** - Only 1 new file for large, self-contained logic
2. ✅ **Better organization** - Related logic grouped together
3. ✅ **Easier testing** - Services can be tested independently
4. ✅ **Improved maintainability** - Clear service boundaries
5. ✅ **Reusability** - Utilities can be used elsewhere

---

## Risk Assessment

- **Low Risk**: Helper functions, score calculation, grade orchestration
- **Medium Risk**: Task creation, page sorting, question mode handler
- **Mitigation**: Test each phase independently before moving to next

---

## Notes

- All existing functionality must be preserved
- No breaking changes to API contracts
- Maintain backward compatibility
- Update imports as needed

