---
description: A disciplined workflow for high-stakes or complex tasks: Understand -> Root Cause -> Plan -> Review -> Approve -> Execute.
---

# Disciplined Execution Workflow

Use this workflow when the user asks for a careful, structured approach or when dealing with complex bugs/refactors.

## 1. Understand & Root Cause Analysis
- **Stop and Read:** Carefully read the user's request and the current code state.
- **Analyze:** Identify the *exact* mechanism causing the issue. Do not guess.
- **Formulate:** clearly articulate the "Root Cause" in your scratchpad or thinking process.

## 2. Planning
- **Create Artifact:** Create or update `implementation_plan.md`.
- **Content Requirements:**
    - **Goal:** What are we fixing?
    - **Root Cause:** Why is it broken?
    - **Proposed Solution:** Technical details of the fix (files, functions, logic).
    - **Verification:** How will we prove it works?

## 3. User Review
- **Notify User:** Use the `notify_user` tool.
- **Action:** Request specific review of the `implementation_plan.md`.
- **Constraint:** **DO NOT PROCEED** until the user explicitly approves the plan.

## 4. Execution
- **Wait for Approval:** Only start this step after user says "Approved" or "Proceed".
- **Implement:** Apply code changes as per the plan.
- **Verify:** Run verification steps.
