---
description: Design Document: The Funnel Annotation Workflow (Strict Zone Protection) Version: 3.0 (Strict Classification Integrity) Status: FAIL-FAST / POSITIVE UNMATCH / NO DIRTY PATCHES
---

Design Document: The Funnel Annotation Workflow (Strict Zone Protection)
Version: 3.0 (Strict Classification Integrity) Status: FAIL-FAST / POSITIVE UNMATCH / NO DIRTY PATCHES

1. Executive Summary
This design eliminates the "Three-Body Problem" and forbids "Emergency Solutions." It establishes a linear pipeline where data integrity is paramount. A "Positive Unmatched" annotation (one that fails to link to OCR text but is visually correctly placed via handwriting data) is considered a valid and truthful system state. We prefer an honest UNMATCHED status over a false MATCHED status.

2. Core Philosophy
Single Source of Truth (Zones): ZoneUtils.ts is the absolute law for vertical boundaries.

Single Source of Truth (Position): The Classification Block (line_id) is the absolute law for the student's handwriting location (x, y). We do not invent coordinates.

Fail Fast: If required data (e.g., line_id for an Unmatched item) is missing, the system CRASHES (Throws Exception). It does not create a default box at (0,0) or (50,50).

Positive Unmatched: If the Iron Dome vetoes a text link, the status remains UNMATCHED. This is a feature, not a bug.

Strict Zone Protection: We apply vertical clamping (y) to enforce zone boundaries, but we strictly preserve the horizontal (x) position of the student's work.

3. Architecture Overview
Code snippet

graph TD
    A[AI Response JSON] --> B(Stage 1: The Judge / Executor)
    B --> C(Stage 2: The Enforcer / Enrichment)
    C --> D[Final Rendered Annotation]

    subgraph "Laws of Physics"
    Z[ZoneUtils.ts]
    H[Classification Data (line_id)]
    end

    B -.-> Z
    C -.-> Z
    C -.-> H
4. Detailed Component Specifications
Stage 1: The Judge (MarkingExecutorService.ts)
Role: Validates integrity. It does not move pixels. It only changes Status and strips Bad IDs.

The Logic Gates:

The Illegal State Trap:

Input: status: MATCHED AND linked_ocr_id: null.

Action: IMMEDIATE DEMOTION.

Output: status: UNMATCHED.

The Iron Dome (Zone Veto):

Input: linked_ocr_id exists.

Check: Does the physical Y-coordinate of linked_ocr_id fall inside ZoneUtils.getZone()?

Pass: Status remains MATCHED.

Fail:

Action: Veto the Link.

Status: Set to UNMATCHED (Do not swap to "Matched").

ID: Set linked_ocr_id = null.

Preserve: Keep line_id (Student Handwriting ID) for the next stage.

Contract Output to Stage 2:

Valid Match: { status: "MATCHED", linked_ocr_id: "valid_id" }

Positive Unmatch: { status: "UNMATCHED", linked_ocr_id: null, line_id: "handwriting_id" }

Stage 2: The Enforcer (AnnotationEnrichmentService.ts)
Role: Calculates pixels based on the Strict Directive from Stage 1. No guessing.

Path A: The Verified Match (DIRECT_LINK)
Condition: status === "MATCHED" AND linked_ocr_id exists.

Source: Physical Bounding Box of linked_ocr_id (Text).

Logic: Trust the text location 100%. No clamping.

Path B: Zone Protection (UNMATCHED / VETOED)
Condition: status === "UNMATCHED".

Source: Student Handwriting (line_id).

Validation (Fail Fast):

If line_id is missing? -> THROW ERROR.

If line_id lookup returns undefined? -> THROW ERROR.

Coordinate Logic (The "No Dirty Patch" Rule):

Get Raw Coordinates: Retrieve {x, y, width, height} from the Classification Block.

Preserve X: Final X = Raw X. (If student wrote on the right, we mark on the right. Do not shift to left margin).

Protect Y (Vertical Clamping):

Retrieve ZoneUtils.getZone().

Final Y = Math.max(Raw Y, Zone.Start_Y).

Final Y = Math.min(Final Y, Zone.End_Y - Height).

Outcome: The tick appears exactly where the student wrote horizontally, but is legally forced vertically into the correct box.

Path C: Visual Sovereignty (VISUAL)
Condition: status === "VISUAL".

Source: AI Visual Coordinates (Percentage).

Logic: Convert % to pixels, then apply Mandatory Zone Clamping.

5. Case Study: The "10bi" Problem (Corrected)
Scenario:

Zone 10bi: Y 467-595.

Student Work: Written at x: 300 (Middle Right), y: 450 (Technically in Zone 10a).

AI Error: Matches to null ID (or wrong text).

Execution Flow:

Executor:

Detects linked_ocr_id is invalid or null.

Sets status = "UNMATCHED".

Passes: { status: "UNMATCHED", line_id: "p0_line_5" }.

Enrichment:

Receives UNMATCHED.

Looks up p0_line_5. Finds block at { x: 300, y: 450 }.

X-Logic: Keep 300. (NO "Lower Left" default).

Y-Logic: Math.max(450, 467) = 467.

Render: Draws tick at { x: 300, y: 467 }.

Final Result:

Visual: Tick appears on the right (over the answer), snapped to the top edge of Zone 10bi.

Data: Status is UNMATCHED (Honest).

System: Integrity preserved.

6. Implementation Checklist
[ ] Fail Fast: AnnotationEnrichmentService throws Error immediately if line_id is missing for an unmatched item.

[ ] No Padding: Remove all pad: 5 or x + 20 logic. Use raw data.

[ ] Classification Integrity: Verify findInData(line_id) returns the exact x coordinate of the handwriting block, ensuring no default to x:0 or x: margin.

[ ] Strict Status: Ensure Executor never upgrades a Vetoed item back to MATCHED.


Coordinate Sources Explained
Here is the definitive source of truth for where the boxes come from:

1. Student Handwriting (Text)
Source: Classification (Physical Data)

How it works: The AI sends a reference ID (e.g., p0_line_5).
Mechanism: We look up this ID in the Classification Data (Segmentation Results) to find the exact physical bounding box where the student wrote.
Precision: High (Real-world coordinates).
2. Drawings / Graphs (Visual)
Source: AI Marking Response (AI Estimation)

How it works: The AI explicitly returns a coordinate set in its response (e.g., visual_position: [10, 20, 50, 40]).
Mechanism: We trust these percentage coordinates directly ([PATH B]). It does not usually link to a Classification block because semantic drawings (like graphs) are often not segmented as single "lines".
Precision: Variable (AI Hallucination/Estimation).
Summary Table
Content Type	Logic Path	Source of Coordinates	Unit
Matched Text	DIRECT_LINK	Classification Block (via line_id)	pixels (usually)
Unmatched Text	ZONE_PROTECTED	Classification Block (via line_id)	pixels (usually)
Drawings	VISUAL_COORDS	AI Response (via visual_position)	percentage
