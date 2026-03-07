---
description: design rules for model answer and ui requirement
---

# The Model Answer Bible (Design & UI)
**Version: 2.0 (JSON Architecture)**

This document codifies the mandatory engineering and design protocols for the AI Marking System's model answers.

## 1. Structural Architecture
*   **Main Question**: Wrap every major question prompt in a `<span class="model_question">`.
*   **Sub-Question (a, b, c)**: Wrap sub-labels and their specific text in their own `<span class="model_question">`.
    *   *Rule*: Question text must be preserved exactly as shown in the source paper.
*   **Answer Blocks**: Wrap the working out and final result in a `<div class="model_answer">`.
    *   *Rule*: Use `<br>` for line breaks in working steps. Avoid excessive empty space.
*   **Encapsulation**: Every piece of text must be inside one of these two tags. No naked text.

## 2. UI & Aesthetics (CSS)
*   **Typography**: All mathematical variables, formulas, and expressions must be wrapped in single dollar signs (`$`) for LaTeX rendering.
*   **Colors & Themes**:
    *   **Background**: Must be `transparent` to blend with the parent container.
    *   **Text (Light Mode)**: Primary color must be high-contrast black/charcoal.
    *   **Text (Dark Mode)**: Primary color must be pure white or very light gray.
*   **Mark Alignment**:
    *   Max marks (e.g., `[3 marks]`) and marking codes (e.g., `[M1]`, `[A1]`) must be **Right-Aligned** using the `.marking-code` CSS class.

## 3. Diagram Rendering Pipeline
**Pipeline Flow**: AI reads text hint $\rightarrow$ AI outputs Markdown JSON Block $\rightarrow$ Frontend parses JSON & draws Deterministic SVG/Vega-Lite.

### ✅ Supported Diagrams (MANDATORY JSON Extraction)
If a question falls into these categories, the AI MUST extract the parameters into JSON. It is forbidden from using the fallback.
*   **Polygons & 2D Geometry**: Must use exact coordinates/lengths from the paper hints.
    *   *Example (AQA Q5)*: Pentagon with given heights and widths.
*   **Triangles (Ignore "Not Drawn Accurately")**: Use Side-Angle-Side or explicit lengths.
    *   *Example (AQA Q25)*: Triangle with 7.2cm, 13.6cm, and 110° angle. The AI must calculate the 3rd point, ignoring the "not drawn accurately" trap.
*   **Coordinate Grids**: Support multiple layers for transformation questions. Must use `[x, y, "label"]` array format.
    *   *Example (AQA Q12, Q21)*: Reflections and enlargements of triangles on an $x/y$ grid.
*   **Algebraic Graphs (Vega-Lite Math Theme)**:
    *   *Example (AQA Q26)*: Sketch of $y=-5^x$.
    *   *Rule*: Set `"theme": "math"` in the JSON so the frontend knows to disable statistical chart borders/ticks and only show the central $(0,0)$ axis crosshairs.
*   **Probability Trees**:
    *   *Example (AQA Q13)*: Dice & Counter tree. AI extracts nodes and probabilities.
*   **Composite 2D**:
    *   *Example (AQA Q11)*: Running track (semicircle joined to a straight line).

### ❌ Unsupported Diagrams (The Fallback Rule)
If a question is structurally complex, 3D, or lacks specific mathematical data, the AI MUST use the fallback type. The UI will render a professional "📊 Diagram Reference" box containing the text description.
*   **Complex 3D Solids**:
    *   *Example (AQA Q23)*: Dog bowl made from a hollowed-out cone and hemisphere.
    *   *Example (AQA Q14)*: Visual representation of two solid cubes X and Y.
*   **Empirical / Descriptive Data Graphs**:
    *   *Example (AQA Q15)*: Megan's phone charging graph. Because the curve has no mathematical equation (e.g., "gradually decreases"), the AI cannot plot the data points.
*   **Highly Constrained Topological Geometry**:
    *   *Example (AQA Q17)*: Complex circle theorems (inscribed triangle, touching tangent, line through center). The AI cannot reliably position all intersection points perfectly.

## 4. Anti-Regression Protocol
*   **Escaping**: Escape `<` as `&lt;` and `>` as `&gt;` inside all standard HTML question/answer text blocks to prevent browser parsing errors.
*   **The Code Block Exception**: For model answers, never use Markdown code blocks (```) EXCEPT for diagram JSON.
    *   *Rule*: All diagrams must be wrapped exactly like this to bypass HTML parser stripping:
    ```json ai-diagram
    {
      "type": "coordinate_grid",
      "layers": [...]
    }
    ```
*   **Diagram Placement**: The diagram JSON block MUST be placed outside the `<div class="model_answer">` tags. Ideally, place it immediately after the `<span class="model_question">` closure so `ReactMarkdown` and `DiagramService` process it independently without DOM interference.
