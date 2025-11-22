# Marking Results Table Enhancement Preview

## Overview
Enhanced Marking Results table with hierarchical grouping, collapsible sections, and grade trend visualization.

---

## Visual Layout (Side-by-Side Columns)

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Marking Results                                                                                                │
├───────────────────────────────────────────────────────────────────────────┬───────────────────────────────────┤
│ Marking Results Table (Left Column)                                       │ Grade Trend Chart (Right Column)  │
├───────────────────────────────────────────────────────────────────────────┼───────────────────────────────────┤
│                                                                             │                                   │
│ ┌───────────────────────────────────────────────────────────────────────┐ │ ┌─────────────────────────────┐ │
│ │ 🟡 Paper Code Set: [1H 2H 3H] (Higher) - Exam Series: June 2024 [▼] │ │ │ Grade Trend                │ │
│ ├───────────────────────────────────────────────────────────────────────┤ │ │                             │ │
│ │                                                                       │ │ │  Grade                      │ │
│ │ ┌─────────────────────────────────────────────────────────────────┐ │ │ │   9 ┤                        │ │
│ │ │ 🟢 Exam Code: 1MA1/1H                                   [▶]      │ │ │   8 ┤     ●───●              │ │
│ │ └─────────────────────────────────────────────────────────────────┘ │ │ │   7 ┤  ●───●   ●───●         │ │
│ │                                                                       │ │ │   6 ┤                        │ │
│ │ ┌─────────────────────────────────────────────────────────────────┐ │ │ │   5 ┤                        │ │
│ │ │ 🟢 Exam Code: 1MA1/2H                                   [▶]      │ │ │     └───────────────────────  │ │
│ │ └─────────────────────────────────────────────────────────────────┘ │ │ │      June  Nov  June  Nov    │ │
│ │                                                                       │ │ │      2024  2024  2025  2025 │ │
│ │ ┌─────────────────────────────────────────────────────────────────┐ │ │ │                             │ │
│ │ │ 🔴 Exam Code: 1MA1/3H                                   [▶]      │ │ │ │ Legend:                      │ │
│ │ └─────────────────────────────────────────────────────────────────┘ │ │ │ ─── 1H (Paper Code)          │ │
│ │                                                                       │ │ │ ─── 2H (Paper Code)          │ │
│ └───────────────────────────────────────────────────────────────────────┘ │ │ ─── 3H (Paper Code)          │ │
│                                                                             │ │ ─── Total Set (Combined)     │ │
│ ┌───────────────────────────────────────────────────────────────────────┐ │ └─────────────────────────────┘ │
│ │ 🟢 Paper Code Set: [1H 2H 3H] (Higher) - Exam Series: Nov 2024 [▼] │ │                                   │
│ ├───────────────────────────────────────────────────────────────────────┤ │                                   │
│ │ ┌─────────────────────────────────────────────────────────────────┐ │ │                                   │
│ │ │ 🟢 Exam Code: 1MA1/1H                                   [▼]      │ │ │                                   │
│ │ ├─────────────────────────────────────────────────────────────────┤ │ │                                   │
│ │ │ ┌─────────────────────────────────────────────────────────────┐ │ │ │                                   │
│ │ │ │ Score      │ Grade │ Model Used │ Date        │ Actions    │ │ │ │                                   │
│ │ │ ├─────────────────────────────────────────────────────────────┤ │ │ │                                   │
│ │ │ │ 45/50 (90%)│ 9     │ gemini-... │ Dec 15 2024 │  ⋮        │ │ │ │                                   │
│ │ │ │ 42/50 (84%)│ 8     │ gemini-... │ Dec 10 2024 │  ⋮        │ │ │ │                                   │
│ │ │ └─────────────────────────────────────────────────────────────┘ │ │ │                                   │
│ │ └─────────────────────────────────────────────────────────────────┘ │ │                                   │
│ │                                                                       │ │                                   │
│ │ ┌─────────────────────────────────────────────────────────────────┐ │ │                                   │
│ │ │ 🟢 Exam Code: 1MA1/2H                                   [▶]      │ │ │                                   │
│ │ └─────────────────────────────────────────────────────────────────┘ │ │                                   │
│ │                                                                       │ │                                   │
│ │ ┌─────────────────────────────────────────────────────────────────┐ │ │                                   │
│ │ │ 🔴 Exam Code: 1MA1/3H                                   [▶]      │ │ │                                   │
│ │ └─────────────────────────────────────────────────────────────────┘ │ │                                   │
│ │                                                                       │ │                                   │
│ └───────────────────────────────────────────────────────────────────────┘ │                                   │
│                                                                             │                                   │
│ ┌───────────────────────────────────────────────────────────────────────┐ │                                   │
│ │ 🔴 Paper Code Set: [1F 2F 3F] (Foundation) - Exam Series: June 2024│ │                                   │
│ └───────────────────────────────────────────────────────────────────────┘ │                                   │
│                                                                             │                                   │
└───────────────────────────────────────────────────────────────────────────┴───────────────────────────────────┘
```

---

## Component Structure

### 1. Hierarchical Grouping

**Level 1: Paper Code Set + Exam Series (Default Collapsed)**
- Group: `[Paper Code Set] - [Exam Series]`
- Example: `[1H 2H 3H] (Higher) - June 2024`
- Collapsed by default
- Click to expand/collapse
- **Visual Indicator:**
  - 🟢 Green circle: All exam codes in the set have marking results
  - 🟡 Yellow circle: At least one exam code has results, but not all (partial set)
  - 🔴 Red circle: No marking results found for any exam code

**Level 2: Exam Code (Nested, Default Collapsed)**
- Group: `Exam Code: [code]`
- Example: `Exam Code: 1MA1/1H`
- Only visible when parent is expanded
- Click to expand/collapse individual exam code records
- **Visual Indicator:**
  - 🟢 Green circle: Has marking results for this exam code
  - 🔴 Red circle: No marking results found for this exam code

**Level 3: Individual Records**
- Table rows showing (simplified - exam code and exam series removed as they're in group headers):
  - Score (awarded/total, percentage)
  - Grade
  - Model Used
  - Date
  - Actions (dropdown)

---

## Data Structure

### Grouping Logic

```typescript
interface GroupedMarkingResult {
  paperCodeSet: string[];        // ["1H", "2H", "3H"]
  examSeries: string;            // "June 2024"
  examCodeGroups: {
    examCode: string;            // "1MA1/1H"
    records: MarkingResult[];    // All records for this exam code
  }[];
}

// Grouping hierarchy:
// 1. Group by paper code set (extracted from examCode)
// 2. Group by exam series
// 3. Group by exam code within each paper code set + exam series
```

### Example Data Structure

```typescript
[
  {
    paperCodeSet: ["1H", "2H", "3H"],
    examSeries: "June 2024",
    examCodeGroups: [
      {
        examCode: "1MA1/1H",
        records: [
          { sessionId: "s1", examCode: "1MA1/1H", examSeries: "June 2024", grade: "9", ... },
          { sessionId: "s2", examCode: "1MA1/1H", examSeries: "June 2024", grade: "8", ... }
        ]
      },
      {
        examCode: "1MA1/2H",
        records: [...]
      },
      {
        examCode: "1MA1/3H",
        records: [...]
      }
    ]
  },
  {
    paperCodeSet: ["1H", "2H", "3H"],
    examSeries: "November 2024",
    examCodeGroups: [...]
  }
]
```

---

## Grade Trend Chart

### Chart Specifications

**X-Axis:** Exam Series (chronological order)
- June 2024, November 2024, June 2025, etc.

**Y-Axis:** Grade (numeric: 1-9 for GCSE, A*-E for A-Level)
- Convert letter grades to numbers for plotting

**Lines:**
1. **Individual Paper Codes:** One line per paper code in the set
   - Example: 1H, 2H, 3H (3 separate lines)
   - Color-coded for distinction

2. **Total Paper Code Set:** Combined/average grade across all papers
   - Calculated as average of all paper codes in the set
   - Shown as a thicker/dashed line

**Data Points:**
- Each point represents the grade for that paper code in that exam series
- If multiple attempts exist for same paper code + exam series, use average or latest

**Chart Library:** 
- Use a lightweight charting library (e.g., Recharts, Chart.js, or Victory)
- Responsive and matches app theme

---

## Interaction Flow

### 1. Initial State (Collapsed)
```
🟡 [▶] [1H 2H 3H] (Higher) - June 2024 (partial: 2 of 3 have results)
🟢 [▶] [1H 2H 3H] (Higher) - November 2024 (complete: all have results)
🔴 [▶] [1F 2F 3F] (Foundation) - June 2024 (no results)
```

### 2. Click Paper Code Set + Exam Series → Expand
```
🟡 [▼] [1H 2H 3H] (Higher) - June 2024
    🟢 [▶] Exam Code: 1MA1/1H
    🟢 [▶] Exam Code: 1MA1/2H
    🔴 [▶] Exam Code: 1MA1/3H (no results)
```

### 3. Click Exam Code → Expand Individual Records
```
🟡 [▼] [1H 2H 3H] (Higher) - June 2024
    🟢 [▼] Exam Code: 1MA1/1H
        ┌─────────────────────────────────────────┐
        │ Score      │ Grade │ Model Used │ ...   │
        ├─────────────────────────────────────────┤
        │ 45/50 (90%)│ 9     │ gemini-... │ ...   │
        │ 42/50 (84%)│ 8     │ gemini-... │ ...   │
        └─────────────────────────────────────────┘
    🟢 [▶] Exam Code: 1MA1/2H
    🔴 [▶] Exam Code: 1MA1/3H (no results)
```

---

## Layout Structure

### Two-Column Layout (Side-by-Side)

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Marking Results                            │
├──────────────────────────────────┬──────────────────────────────────┤
│                                  │                                  │
│  Marking Results Table           │  Grade Trend Chart              │
│  (Left Column - 60%)             │  (Right Column - 40%)            │
│                                  │                                  │
│  - Hierarchical groups           │  - Line chart                    │
│  - Collapsible sections          │  - Grade vs Exam Series          │
│  - Individual records            │  - Multiple lines per paper code │
│    (Simplified: Score, Grade,    │  - Total set line                │
│     Model, Date, Actions)         │  - Legend                        │
│                                  │                                  │
└──────────────────────────────────┴──────────────────────────────────┘
```

### Column Specifications
- **Left Column (Table):** 60% width
  - Contains hierarchical marking results table
  - Scrollable if content exceeds height
  - Simplified table columns (no exam code/exam series in rows)

- **Right Column (Chart):** 40% width
  - Fixed position next to table
  - Grade trend line chart
  - Responsive height matching table height
  - Legend showing paper code lines and total set line

### Responsive Behavior
- **Desktop (>1024px):** Side-by-side columns (60% table, 40% chart)
- **Tablet (768px-1024px):** Side-by-side with adjusted widths (55% table, 45% chart)
- **Mobile (<768px):** Stacked (table on top, chart below, both 100% width)

---

## Implementation Notes

### 1. Grouping Algorithm
```typescript
function groupMarkingResults(results: MarkingResult[]): GroupedMarkingResult[] {
  // Step 1: Extract paper codes from examCode (e.g., "1MA1/1H" -> "1H")
  // Step 2: Group by paper code set (determine which papers belong together)
  // Step 3: Group by exam series within each paper code set
  // Step 4: Group by exam code within each paper code set + exam series
  // Step 5: Sort chronologically by exam series
}
```

### 2. Paper Code Set Detection
- Extract paper codes from examCode: `"1MA1/1H"` → `"1H"`
- Group papers that appear together in same exam series
- Use tier information to determine sets (Higher: 1H, 2H, 3H vs Foundation: 1F, 2F, 3F)

### 3. Chart Data Preparation
```typescript
interface ChartDataPoint {
  examSeries: string;      // "June 2024"
  paperCode: string;        // "1H", "2H", "3H", or "Total"
  grade: number;            // Numeric grade (1-9 or converted from A*-E)
  date: Date;               // For sorting
}

// Calculate average grade for "Total" line
function calculateTotalGrade(paperCodeGrades: number[]): number {
  return paperCodeGrades.reduce((sum, g) => sum + g, 0) / paperCodeGrades.length;
}
```

### 4. State Management
```typescript
const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
// Key format: `${paperCodeSet.join('_')}_${examSeries}`
// Example: "1H_2H_3H_June 2024"

const [expandedExamCodes, setExpandedExamCodes] = useState<Set<string>>(new Set());
// Key format: `${paperCodeSet.join('_')}_${examSeries}_${examCode}`
// Example: "1H_2H_3H_June 2024_1MA1/1H"
```

### 5. Visual Indicator Logic
```typescript
// Determine indicator color for Paper Code Set + Exam Series group
function getGroupIndicator(group: GroupedMarkingResult): 'green' | 'yellow' | 'red' {
  const examCodeGroups = group.examCodeGroups;
  const groupsWithResults = examCodeGroups.filter(eg => eg.records.length > 0);
  const totalGroups = examCodeGroups.length;
  
  if (groupsWithResults.length === 0) {
    return 'red'; // No results
  } else if (groupsWithResults.length === totalGroups) {
    return 'green'; // All exam codes have results
  } else {
    return 'yellow'; // Partial: some have results, some don't
  }
}

// Determine indicator color for Exam Code group
function getExamCodeIndicator(examCodeGroup: ExamCodeGroup): 'green' | 'red' {
  // Check if this exam code has any records
  return examCodeGroup.records.length > 0 ? 'green' : 'red';
}
```

**Indicator Rules:**
- **Paper Code Set + Exam Series:**
  - 🟢 Green: All exam codes in the set have results
  - 🟡 Yellow: At least one exam code has results, but not all (partial set)
  - 🔴 Red: No exam codes have results
- **Exam Code:**
  - 🟢 Green: Has at least one record
  - 🔴 Red: No records

---

## Visual Design

### Collapsed Group Header
- Background: `var(--background-tertiary)`
- Border: `1px solid var(--border-main)`
- Padding: `16px 20px`
- Hover effect: Slight background change
- Icon: Chevron right (▶) when collapsed, down (▼) when expanded
- **Status Indicator:**
  - Green circle (🟢): `#22c55e` - All exam codes in set have marking results
  - Yellow circle (🟡): `#fbbf24` - Partial set (at least one but not all exam codes have results)
  - Red circle (🔴): `#ef4444` - No marking results found for any exam code
  - Position: Left side of header text, `8px` margin from text
  - Size: `12px` diameter circle

### Expanded Group Content
- Nested indentation: `20px` per level
- Subtle background difference for nested groups
- Smooth expand/collapse animation

### Chart Container
- Background: `var(--background-tertiary)`
- Border: `1px solid var(--border-main)`
- Border-radius: `8px`
- Padding: `20px`
- Width: `40%` (desktop), `45%` (tablet), `100%` (mobile)
- Height: Matches table height (dynamic) or minimum `400px`
- Position: Fixed to right column, scrolls with table if needed

### Simplified Table Columns

When individual records are expanded, the table shows only essential information:
- **Score:** `awardedMarks/totalMarks (percentage%)`
  - Example: `45/50 (90%)`
- **Grade:** Grade badge (e.g., "9", "8", "A*")
- **Model Used:** AI model name (truncated if long)
  - Example: `gemini-2.5-flash`
- **Date:** Formatted date and time
  - Example: `Dec 15, 2024 2:30 PM`
- **Actions:** Dropdown menu (Locate in Marking, Delete)

**Removed Columns (shown in group headers instead):**
- ❌ Exam Code (already shown in exam code group header)
- ❌ Exam Series (already shown in paper code set + exam series group header)

**Benefits of Simplified Table:**
- Cleaner, less cluttered view
- Focus on key metrics (score, grade)
- Context already provided by hierarchical headers
- More space for important information

---

## User Experience

### Benefits
1. **Better Organization:** Hierarchical grouping makes it easier to find specific results
2. **Space Efficient:** Collapsed by default saves screen space
3. **Trend Visualization:** Chart shows performance progression over time
4. **Quick Comparison:** See how different paper codes perform across exam series
5. **Visual Status Indicators:** Instantly see which groups have data (green) vs empty (red)

### Visual Indicators
- **🟢 Green Circle:** Indicates all exam codes have marking results
  - Paper Code Set + Exam Series: All exam codes in the set have results
  - Exam Code: Has at least one marking result record
- **🟡 Yellow Circle:** Indicates partial set (at least one but not all)
  - Paper Code Set + Exam Series: At least one exam code has results, but not all exam codes in the set
  - Exam Code: Not applicable (exam code is either green or red)
- **🔴 Red Circle:** Indicates no marking results found
  - Paper Code Set + Exam Series: No results for any exam code in this set/series
  - Exam Code: No records for this specific exam code

### Interactions
- Click group header → Toggle expand/collapse
- Click exam code → Toggle individual exam code records
- Hover over chart point → Show tooltip with details
- Click chart point → Highlight corresponding table row (optional)
- Visual indicators provide instant feedback on data availability

---

## Example Scenarios

### Scenario 1: Multiple Exam Series
```
🟡 [▶] [1H 2H 3H] - June 2024 (partial: 1H, 2H have results, 3H doesn't)
🟢 [▶] [1H 2H 3H] - November 2024 (complete: all have results)
🔴 [▶] [1H 2H 3H] - June 2025 (no results yet)
```

### Scenario 2: Multiple Paper Code Sets
```
🟢 [▶] [1H 2H 3H] (Higher) - June 2024 (all have results)
🟡 [▶] [1F 2F 3F] (Foundation) - June 2024 (partial: only 1F has results)
```

### Scenario 3: Mixed Exam Codes
```
🟡 [▼] [1H 2H 3H] - June 2024 (partial set)
    🟢 [▼] Exam Code: 1MA1/1H (2 records)
    🟢 [▶] Exam Code: 1MA1/2H (1 record)
    🔴 [▶] Exam Code: 1MA1/3H (0 records)
```

---

## Technical Considerations

### Performance
- Virtual scrolling for large datasets
- Lazy rendering of chart (only when visible)
- Memoization of grouping calculations

### Accessibility
- Keyboard navigation for expand/collapse
- ARIA labels for screen readers
- Focus management

### Data Consistency
- Handle missing grades gracefully
- Show "N/A" for missing data points in chart
- Handle edge cases (single paper code, single exam series, etc.)

---

## Next Steps

1. Implement grouping algorithm
2. Create collapsible group components
3. Integrate charting library
4. Add responsive layout
5. Implement state management for expand/collapse
6. Add animations and transitions
7. Test with various data scenarios

