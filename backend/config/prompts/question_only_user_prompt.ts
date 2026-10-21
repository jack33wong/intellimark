export default `Expert Examiner Task: Generate a model answer for the following mathematics question.

### INPUT DATA
Question Data (may include lead-in context and sub-questions):
{{QUESTION_TEXT}}

Marking Scheme (Rules to follow):
{{MARKING_SCHEME}}

### FORMATTING RULES (STRICT ADHERENCE REQUIRED)
You MUST output valid HTML using the following structure for each part. Do NOT output plain Markdown.

1. **Lead-in Context**: If present, repeat it once at the top (plain text).
2. **Structure**: For each sub-question, you MUST use this HTML template:
   <span class="model_question">(part label) Question text...</span>
   <div class="model_answer">
   <p>Detailed step... <span class="mark-code">[M1]</span></p>
   <p>Final answer... <span class="mark-code">[A1]</span></p>
   </div>

3. **Mark Codes**: ALL mark codes (e.g., [M1], [A1]) must be wrapped in: <span class="mark-code">[Code]</span>.
4. **LaTeX**: Use LaTeX ($...$) for math.
5. **Scientific Notation**: Use scientific notation (e.g., $1.23 \times 10^{-7}$) for prob < 0.0001.
6. **DIAGRAMS & GRAPHS (CRITICAL)**:
   - If the input question contains a diagram hint like [Diagram: ...] or [Type: Diagram: ...], you MUST preserve that exact bracketed hint inside the <span class="model_question"> tag so the system can render the reference diagram.
   - If a sub-question asks to draw/plot a graph, sketch a curve, draw a shape on a coordinate grid, or complete a probability tree / bar chart, include a concrete [Diagram: ...] hint inside <div class="model_answer"> with exact mathematical parameters (e.g., [Diagram: Graph of y = 2*x^2 + 3*x - 9 for x from -3 to 3, y from -10 to 11] or [Diagram: Polygon on coordinate grid with vertices (-2,1), (-2,3), (1,1)]), followed by the written explanation and mark codes.

**Example Output:**
Lead-in text here.

<span class="model_question">(a) Find x.</span>
<div class="model_answer">
<p>$2x = 10$ <span class="mark-code">[M1]</span></p>
<p>$x = 5$ <span class="mark-code">[A1]</span></p>
</div>

### CRITICAL INSTRUCTIONS
- Do NOT use Markdown headers (###). Use the HTML tags provided.
- **NO CODE GENERATION**: You are a mathematician, not a programmer. Do NOT generate Python code.
- **NO EXPLANATORY TEXT**: Do not include text like "We need more information...". if needed, make standard assumptions.`
