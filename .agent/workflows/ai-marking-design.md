---
description: System design rules for the AI Marking System to ensure consistency and prevent accidental over-simplification.
---

AI Marking System Design Bible (v2.4)
Philosophy: The AI is a Semantic Navigator, not a Spellchecker.

1. Source of Truth (The "Rescue" Hierarchy)
We use a Primary + Fallback system to determine if a student is correct.

TIER 1 (PRIMARY): STUDENT WORK (STRUCTURED)

Rule: This Classification Transcript is the default source for grading logic. If it matches the Scheme, Award the Mark.

TIER 2 (FALLBACK): RAW OCR BLOCKS (THE "RESCUE" LAYER)

Trigger: Use this ONLY if the Classification Transcript is WRONG or MISSING but the student actually wrote the correct answer.

Rule: If Classification misses a correct answer but the RAW OCR BLOCKS clearly show it, award the mark. We give the student the benefit of the doubt if the OCR captured the ink correctly.

2. Data Ingestion Protocol (The "Unfiltered" Constraint)
THE UNRELIABLE TYPE CONSTRAINT:

We CANNOT trust OCR type indicators (e.g., "handwriting" vs "printed").

Consequence: The Prompt will receive ALL OCR blocks that fall within the relevant spatial context (Vertical Zone) of the question.

THE AI'S BURDEN:

Since the system cannot filter printed text, YOU (The AI) are the filter.

You must use Semantic Judgment to distinguish between "Question Instructions" (Ignore) and "Student Answers" (Match).

3. The Match Protocols (CORE LOGIC)
A. The Semantic Mandate (Value > String)
OBJECTIVE: Link Student Work to the OCR Block that represents the SAME VALUE.

THE SEMANTIC RULE: You must act as a Mathematician.

EQUIVALENCE: 19/60 (Student) IS a match for \frac{19}{60} (OCR).

TOLERANCE: Ignore formatting noise like LaTeX wrappers (\(, \)), \text{}, or whitespace.

CONSTRAINT: Do not require strict string equality for complex math. Use Value Equivalence.

B. The Content Fidelity Law (The Gatekeeper)
OBJECTIVE: Prevent "Desperate Matching" (lying about location).

THE INTEGER RULE:

For pure integers (e.g., "36"), the OCR block MUST contain that EXACT integer.

PROHIBITION: Matching "36" to "3" is a CRITICAL FAILURE.

THE UNMATCHED SUCCESS STATE:

DEFINITION: ocr_match_status: "UNMATCHED" is a SUCCESS, not a failure.

TRIGGER: If valid Student Work exists but the specific numbers are missing from the OCR list (e.g., Mathpix missed the handwriting), you MUST return UNMATCHED.

LAW: It is better to have a "floating tick" (Ghost Mode) than a tick anchored to the wrong number.

C. The Radioactive Anchor Rule
DEFINITION: Question Labels (e.g., (a), (b)(i), (ii), Q1) and Instructions (e.g., "Calculate...", "Write down...") are RADIOACTIVE.

LAW:

NEVER anchor a mark to a label just because it is "nearby" or "safe."

EXCEPTION: You may only anchor to a label if the student wrote their answer directly inside/over that specific block text.

LOGIC ERROR: Anchoring a result like "77/100" to a label like "(b)(i)" is a hallucination. Return UNMATCHED instead.

D. Visual Sovereignty (Drawings)
APPLICABILITY: Sketches, diagrams, graphs.

LAW: FORCE VISUAL MODE:

For any drawing task, you MUST use ocr_match_status: "VISUAL".

COORDINATE PASSTHROUGH (NEW CRITICAL RULE):

If status is VISUAL, the Backend MUST treat the visual_position as absolute truth.

PROHIBITION: Do NOT attempt to "snap," "align," or "nearest-neighbor" these coordinates to any text block.

REASON: Drawings often exist in whitespace (grids) where no text exists. Snapping will destroy the position.

4. The Alignment Mandate (System Matching Prohibition)
LAW: NO INTERNAL MATCHING: Backend heuristics (string similarity, spatial overlap, or "merging" logic) are FORBIDDEN.

AI-CENTRIC RECONCILIATION: The AI is solely responsible for semantically reconciling the two sources (Structured vs. OCR). It chooses the anchor based on semantic truth.

5. Universal Golden Rules
ATOMICITY: One mark code per annotation (e.g., "B1", not "M1 A1").

ONE-SHOT: A list like "36 or 19" is single-use. Award ONE mark only.

CONTEXT ISOLATION: Respect page boundaries.

ZERO-FEEDBACK: Pure JSON. No chat.

MARGIN BLINDNESS: Ignore printed mark counts (e.g., [3]).

GUILLOTINE: Strict adherence to [MAX SCORE].

6. Marking Scheme Retrieval Strategy (The Simple Path)
DESIGN PRINCIPLE: Direct Lookup > Complex Reconstruction.

LAW: No "Label Reconstruction":
- The backend MUST NOT try to manually re-slice or re-assemble marking schemes based on text matching logic for sub-question labels.

THE PIPELINE:
1. INPUT: Detection Text (e.g., "10b(ii)").
2. MATCH: Search DB for Full Exam Paper + Question.
3. RETRIEVE: Pull the pre-structured marking scheme directly from the matched Question record.
4. ORDER: Use the natural order of the retrieved scheme.
5. DELEGATE: Pass the scheme to the AI Prompt as-is.

PROHIBITION: Do not add extra layers of logic to "verify" if the retrieved scheme matches the detected text label-by-label. Trust the DB Match.