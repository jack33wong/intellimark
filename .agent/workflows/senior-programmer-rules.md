---
description: Mandatory engineering protocols for all Senior Developer tasks. diagnosis-first, upstream-only, honest-logging.
---

# Senior Programmer Protocol (The "Zero-Assumption" Bible)
This file defines the mandatory engineering standards for this project. 
All agents and developers MUST follow these rules specifically for "Fix" and "Debug" tasks.

## 1. The Diagnosis & Fix Protocol (Evidence Before Action)
**PROOF BEFORE CODE**:
- Before writing a single line of code to fix a bug, you MUST produce a **Diagnosis & Proof** report.
- **Proof Requirement**: You must have a reproduction script or specific log evidence that confirms the ROOT CAUSE.
- **Forbidden**: Modifying code based on "guesses", "hunches", or "looks like".
- **Enforcement**: "I have identified the problem" is NOT enough. You must say: "Here is the proof..."

## 2. The Upstream Mandate (Root Cause Only) 
**NO DIRTY PATCHES**:
- **Rule**: Fix the problem where it matches the reality (Upstream), not where it breaks the app (Downstream).
- **Example**: If Question Detection matches wrong, Fix Detection Logic (Normalization, Keywords). DO NOT add "if mismatch" checks in the Marking Service.
- **Definition of Dirty**: Any code that says "If system X failed, pretend it didn't and do Y" is a dirty patch. Fix system X instead.

## 3. Logging & Transparency (Honest Terms)
**PRECISE TERMINOLOGY**:
- **AI Claim**: What the AI *says* it found. Label logs: `[AI Claim: "..."]`.
- **OCR Reality**: What is actually in the text block. Label logs: `[OCR: "..."]`.
- **Student Work**: The raw ink/input.
- **Rule**: NEVER conflate these. Do not label AI reasoning/hallucinations as "Student Work".

**HONEST DEBUGGING**:
- **Unmatched is Unmatched**: If status is `UNMATCHED`, do NOT log an associated OCR text block. It is confusing and misleading. Show the **Reasoning** instead.
## 4. Git & Code Authority (No Assumptions)
**NO AUTO-COMMITS**:
- **Rule**: Automated `git commit` or `git push` is strictly FORBIDDEN.
- **Enforcement**: You must always ask the user to review changes and perform git operations manually or explicitly approve a git command.

**STRICT PLAN APPROVAL**:
- **Rule**: Never execute code changes until the `implementation_plan.md` has been explicitly approved by the user.
- **Goal**: Prevent regressions by ensuring the technical approach is validated before the codebase is modified.
