# Bible: A-Level Zoning & Fusion Design

This document establishes the definitive logic for A-Level question grouping and anchoring, as mandated by the USER.

> [!IMPORTANT]
> **THE GOLDEN RULE: GCSE ISOLATION**
> A-Level "One Big Zone" logic must be architecturally isolated. It **MUST NOT** affect standard GCSE past paper behavior. Standard papers rely on Piecewise Fusion (Signal B). A-Level Big Zones are a *premium exception* triggered ONLY by A-Level signatures (Signal C).

## 1. The Problem
A-Level papers (e.g., Pure Math) often split single questions (like Q3 or Q8) into fragmented zones. This happens because:
1. **Long Question Stems**: Complex mathematical stems or instructions between sub-parts (3a, 3b) exceed the tight density threshold (Signal B), causing the fusion logic to reject the cluster.
2. **Missing Anchors**: Sub-questions (2a, 2b) fail to anchor because they are buried in noisy text or are on the same line as the parent, causing cursor synchronization failures.
3. **Improper Fusion**: Arbitrarily removing density checks (Signal B) leads to "dirty" logic that incorrectly groups non-A-Level questions.

## 2. The User's Solution (The Core Signals)

The fusion of sub-questions into "One Big Zone" must rely on three distinct signals. **Signal B is fine-tuned, not removed.**

### Signal A: Linguistic Match
- **Condition**: Landmarks share the same base number (e.g., `8a` and `8b`).
- **Action**: Necessary for fusion, but not sufficient on its own.

### Signal B: Tight Density (Intra-Page)
- **Condition**: The gap between two landmarks on the same page must be "Mostly Empty".
- **Threshold**: **150 - 200 characters** (Original Design).
- **Purpose**: Detects the white space typical of answer boxes in GCSE/Simple layouts.

### Signal C: The "A-Level Signal" (Empty Space/Page)
- **Mandate**: A-Level questions **always** have large empty spaces or empty pages for answers.
- **Detector (High-Confidence Signatures)**:
    - **Physical Signature**: A vertical physical gap of **> 600px** between sub-landmarks.
    - **Density Signature (AND)**: The gap MUST be nearly empty (**< 200 characters**).
    - **Alternative**: A literal blank page between two landmarks of the same base number that contains **< 8 blocks**.
- **The Trigger**: A question group only upgrades to "A-Level Mode" if it satisfies `(Large Gap AND Low Density)` OR `(Physically Empty Page)`.
- **Action**: 
    - **TRUE**: Group Fuses completely into "One Big Zone" (Iron Dome). 
    - **FALSE (Default)**: Group follows standard **Piecewise Fusion** (Signal B only). Sub-parts remain discrete unless physically tight.

## 3. Implementation Rules

### Rule 1: Group-Wide Triggering
Do not evaluate fusion in a localized vacuum. If the group (all sub-parts of Q3) shows *any* A-Level signal (Large Empty Space), force fusion for the whole group.

### Rule 2: Precision Anchoring
- **Buffer**: Use a 100px vertical buffer for same-page anchors to handle overlapping bounding boxes.
- **Thresholds**: Do not use arbitrary 800-char density thresholds. Stay within the original 150-200 char limit for Signal B.

### Rule 3: Iron Dome Protection (Multi-Label Mapping)
- **Design**: A single physical "One Big Zone" (e.g., named "8") must be discoverable by **any** of its sub-part names (e.g., "8a", "8b", "8c").
- **Logic**: During Stage 2 (Clustering), all discovered sub-landmarks are fused. The result in the `zones` map must be keyed by the **Base Number** (e.g., `zones["8"]`).
- **Protection**: The `ZoneUtils.findMatchingZone` logic must be updated to ensure that if the AI looks for "8b", it successfully resolves to the "8" zone. This "Iron Dome" ensures that any marking attempt for any sub-part is strictly contained and protected within the parent zone.

### Rule 4: Unified resultKey
### Rule 5: Specificity-First Sorting (The Tie-Breaker)
- **Problem**: Parent labels (e.g., "11") "claiming" multiple pages cause weight ties, leading the system to fall back to the incorrect upload order.
- **Logic**: When calculating page weights in the re-indexing sorter, specific sub-question labels (e.g., "11a", "11c") **MUST** take priority over generic parent numbers (e.g., "11"). 
- **Action**: Use a "Specificity Bonus" or weighted average to ensure "11a" pulls its page before "11c", regardless of parent-label overlap.

### Rule 6: Meta-Page Isolation (Signal C Guard)
- **Problem**: Meta pages (front covers) often have low OCR density, causing them to be misidentified as "empty answer pages" for A-Level upgrades.
- **Logic**: The Signal C (Empty Page) detector **MUST** ignore any page categorized as `metadata` or `frontPage`.
- **Action**: Only allow `questionAnswer` pages to act as valid "empty intervening pages" for the Big Zone trigger.

## 4. Post-Mortem & Lessons Learned

### Why we failed for 5+ hours (Root Cause Analysis)
1. **Dirty Patch Syndrome**: Instead of investigating the *specific* signal mandated by the USER (Large Empty Spaces), the Agent resorted to "dirty patches" like removing density checks (Signal B) or increasing thresholds to arbitrary numbers (800 chars).
2. **Ignoring Design Constraints**: The Agent attempted to solve localized failures (Q3 splitting) by breaking global design rules meant for GCSE papers (Tight Density).
3. **Failure to Diagnose First**: The Agent jumped to "Force Fusion" without realizing that A-Level fusion should be *triggered* by the presence of an empty page/space, not forced by ignoring text density.
4. **Sub-Question Anchoring Blindness**: We spent hours debugging "missing zones" without realizing the search cursor was too strict for overlapping line-items on a single page.

### Rule 8: Signal-Based Sorting Separation (GCSE vs A-Level)
- **Problem**: Generic labels (e.g. "11" or "2") have contradictory roles. In GCSE, they are parents (Lead). In A-Level, they are continuations (Follows).
- **Logic**: Use Structural Signals to detect paper type:
  - **The A-Level Signal**: `Signal 1 (High Density)` + `Signal 2 (Large Empty Space)` found on any page identifies the paper as "A-Level Type" (Answer Box Paper).
  - **A-Level Rules**: Assign weight `baseNum + 0.9` for generic-only pages. This ensures Answer boxes (2.01) lead Blank Continuation boxes (2.90).
  - **GCSE Rules**: Assign weight `baseNum - 0.1` for generic-only pages. This ensures Stem Covers (10.9) lead Answer Boxes (11.01).
- **Rationale**: Strictly signal-driven. No reliance on paper titles or metadata strings.

### Rule 9: Orphan Rescue (A-Level Ghost Pages)
- **Problem**: Blank answer pages in A-Level papers often have no identifying question labels, triggering a "Lone Ghost" fatal integrity crash.
- **Logic**: Strictly for A-Level Type papers (detected via Rules above), implement a weight-inheritance pass. 
- **Action**: Unlabeled empty pages inherit the `minQ` of the previous physical page + a tiny epsilon (`+0.0001`).
- **Rationale**: Prevents terminal crashes while maintaining physical page sequences.

## 4. Post-Mortem & Lessons Learned

### Why we broke established GCSE functionality (v44 Regression)

1. **The Metadata Blind Spot (The "Quarantine" Trap)**:
    - **Mistake**: We forced `minQ = Infinity` for all cover pages to solve an A-Level sorting tie.
    - **Consequence**: This stripped cover pages of their "Question Identity". When the Zone Detector looks for Question 11 anchors, it whitelists pages assigned to Q11. By making the cover page "Infinity", we whitelisted it OUT.
    - **Lesson**: Data Propagation is fragile. Never strip identity from a page just to fix its sort position. Use `isMeta` flags or physical offsets instead.

2. **Accidental Deletion of the Absorption Fix**:
    - **Mistake**: During the Bible refactor for "One Big Zone", we deleted the historical `ABSORPTION FIX` logic.
    - **Consequence**: Sub-questions (11c) stopped inheriting parent anchors (11). Combined with the better AI detection of parent labels, the sub-questions were no longer the "First Landmark" on the page, so they failed to auto-expand to the top.
    - **Lesson**: "If it isn't broken, don't refactor it." Small utility functions for GCSE stability must be preserved even when adding new A-Level logic.

3. **The "i === 0" Page-Expansion Trap**:
    - **Mistake**: We optimized the "Auto-Expand to Top" logic to only trigger for the very first question in the document (`i === 0`).
    - **Consequence**: This broke auto-expansion for all subsequent questions that start on a fresh page (like Q11 on Page 2).
    - **Lesson**: Always maintain **Page-Aware First Landmark** logic (`pagesWithFirstLandmark` Set) to ensure multi-page papers capture top-of-page diagrams.

## 5. The Minimum Stable Pillars (A-Level Support)

If the system must be rolled back, these are the **non-negotiable** architectural pillars required to support A-Level papers without breaking GCSE:

1. **Signal-Based Detection (Structural Truth)**:
   - Identify "A-Level Type" papers via `Signal 1 (Density)` and `Signal 2 (Gaps)` on any single page.
   - **Mandate**: Never rely on paper titles or metadata strings for sorting rules. Page layout is the only stable signal.

2. **Role-Based Weighted Sorting**:
   - Use the detected paper type to toggle generic label weights:
     - **A-Level**: Generic numbers (e.g. "2") = `base + 0.9` (Follower).
     - **GCSE**: Generic numbers (e.g. "11") = `base - 0.1` (Leader).
   - **Rationale**: This is the only way to satisfy the contradictory roles of generic labels across paper types.

3. **Landmark Absorption (The Preamble Anchor)**:
   - Sub-questions (11c) **MUST** inherit the starting Y-coordinate of parent labels (11) if they appear on the same physical page.
   - **Rationale**: Prevents question zones from being truncated by preamble diagrams or instructions.

4. **Universal Orphan Rescue**:
   - Blank continuation pages in A-Level papers must inherit the weight of the previous anchor (+0.0001).
   - **Rationale**: Prevents terminal integrity crashes while maintaining logical page sequencing.

---

## 6. The Hall of Regressions (Post-Mortem for v44)

These specific failures broke the system for hours. Documented here to prevent others from repeating these traps:

### 💀 Regression 1: The Metadata Quarantine (Identity Theft)
- **The Mistake**: We forced `minQ = Infinity` for all cover pages to solve an A-Level sorting tie.
- **The Consequence**: The Zone Detector (Stage 2) uses `minQ` to whitelist valid search pages. By making covers "Infinity", we whitelisted them **OUT**. Question 11 anchors on those pages became invisible, causing massive zone truncation.
- **Lesson**: **Identity is Sacred.** Never mutate a page's question-mapping (identity) just to fix its physical position (sorting). Use offsets or flags instead.

### 💀 Regression 2: The "i === 0" Trap (Global Blindness)
- **The Mistake**: We optimized "Auto-Expand to Top" logic to only trigger for the very first question in the document (`i === 0`).
- **The Consequence**: This broke auto-expansion for all subsequent questions starting on fresh pages (e.g. Q11 on Page 2).
- **Lesson**: Code for **Page-Aware** landmarks, not document-level counts. Every page top is a fresh expansion boundary.

### 💀 Regression 3: Data Pointer Blindness (The Ghost Check)
- **The Mistake**: Attempted to detect physical signals (Density/Gaps) by checking the `standardizedPages` object.
- **The Consequence**: `standardizedPages` contains image metadata (filename/width), NOT OCR blocks. The detector saw "0 density" and "0 gaps" on every page, defaulting the whole system to GCSE mode and swapping A-Level pages.
- **Lesson**: **Check your payload.** Structural signals require structural data (`allPagesOcrData`). Image filenames are not a substitute for OCR coordinates.

### 💀 Regression 4: The Consensus Guesswork (The Metadata Crutch)
- **The Mistake**: Falling back to matching "A-Level" in paper titles when signals felt "too complex".
- **The Consequence**: As soon as the AI returned a slightly different paper code (e.g. 9MA0/01) that didn't match our string list, the system flipped to GCSE mode and broke.
- **Lesson**: **Trust the Signals, Not the Strings.** Metadata is a crutch that fails at scale. The physical layout of the page (Density + Gaps) is the only ground truth.
