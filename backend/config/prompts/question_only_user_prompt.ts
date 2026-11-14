import type { SubjectProfile } from '../subjectProfiles.js';

const MATHS_QUESTION_ONLY_USER_PROMPT = `Expert Examiner Task: Generate a model answer for the following mathematics question.

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
   <p>Detailed step... <span class="marking-code">[M1]</span></p>
   <p>Final answer... <span class="marking-code">[A1]</span></p>
   </div>

3. **Mark Codes**: ALL mark codes (e.g., [M1], [A1]) must be wrapped in: <span class="marking-code">[Code]</span> at the end of <p> before </p>.
4. **LaTeX**: Use LaTeX ($...$) for math.
5. **Scientific Notation**: Use scientific notation (e.g., $1.23 \times 10^{-7}$) for prob < 0.0001.
6. **DIAGRAMS & GRAPHS (CRITICAL)**:
   - If the input question contains a diagram hint like [Diagram: ...] or [Type: Diagram: ...], you MUST preserve that exact bracketed hint inside the <span class="model_question"> tag so the system can render the reference diagram.
   - If a sub-question asks to draw/plot a graph, sketch a curve, draw a shape on a coordinate grid, or complete a probability tree / bar chart, include a concrete [Diagram: ...] hint inside <div class="model_answer"> with exact mathematical parameters (e.g., [Diagram: Graph of y = 2*x^2 + 3*x - 9 for x from -3 to 3, y from -10 to 11] or [Diagram: Polygon on coordinate grid with vertices (-2,1), (-2,3), (1,1)]), followed by the written explanation and mark codes.

**Example Output:**
Lead-in text here.

<span class="model_question">(a) Find x.</span>
<div class="model_answer">
<p>$2x = 10$ <span class="marking-code">[M1]</span></p>
<p>$x = 5$ <span class="marking-code">[A1]</span></p>
</div>

### CRITICAL INSTRUCTIONS
- Do NOT use Markdown headers (###). Use the HTML tags provided.
- **NO CODE GENERATION**: You are a mathematician, not a programmer. Do NOT generate Python code.
- **NO EXPLANATORY TEXT**: Do not include text like "We need more information...". if needed, make standard assumptions.`;

export function buildQuestionOnlyUserPrompt(
  message: string,
  markingScheme: string,
  subjectProfile?: SubjectProfile
): string {
  if (!subjectProfile || subjectProfile.key === 'MATHS') {
    return MATHS_QUESTION_ONLY_USER_PROMPT
      .replace('{{QUESTION_TEXT}}', message)
      .replace('{{MARKING_SCHEME}}', markingScheme);
  }

  if (subjectProfile.paradigm === 'LEVEL_OF_RESPONSE') {
    const subjectTitle = subjectProfile.key === 'ENGLISH_LITERATURE'
      ? 'GCSE English Literature'
      : 'GCSE English Language';

    return `Expert Principal Examiner Task: Generate a realistic, full-mark (Grade 9 / Top Level 4) annotated exemplar response for the following ${subjectTitle} question.

### INPUT DATA
Question Data (may include lead-in context and sub-questions):
${message}

Marking Criteria / Level-of-Response Rubric:
${markingScheme}

### PEDAGOGICAL & ACCURACY RULES (CRITICAL)
1. **No Maths Mark Codes**: NEVER use Maths mark codes such as [M1], [A1], [B1], [M0], [A0], or [B0]. Use GCSE English Assessment Objective badges wrapped in <span class="marking-code">[AO... L4: brief skill]</span> (e.g. <span class="marking-code">[AO5 L4: Compelling opening &amp; register]</span>, <span class="marking-code">[AO6 L4: Ambitious punctuation]</span>, <span class="marking-code">[AO2 L4: Connotation zoom-in]</span>). Place **at most ONE** badge per paragraph, strictly at the very end of <p> (right before </p>), NEVER mid-paragraph and NEVER multiple badges in the same <p>.
2. **Authentic GCSE Grade 9 Voice**: Write natural, controlled, perceptive GCSE student prose. Avoid hollow AI clichés ("kaleidoscope", "symphony of shadows", "tapestry") and obscure rhetorical jargon ("peroration", "bathos", "apodosis").
3. **Exam-Realistic Word Counts**:
   - **4-mark Retrieval / Multiple-Choice (Q1)**: 4 concise bullet points or statements with brief textual proof.
   - **8-mark Analysis / Synthesis (Q2, Q3)**: 2 focused paragraphs (160–220 words total).
   - **12-to-20-mark Comparison / Evaluation (Q4)**: 3 to 4 developed paragraphs (300–420 words total).
   - **30-to-40-mark Extended / Creative / Transactional Writing (Q5 or Literature Essay)**: 5 to 6 crafted paragraphs (450–580 words total).
4. **Reading / Extract Guardrail**:
   - If the question is a Writing task (e.g. article, speech, letter, description, story) OR a Literature essay on a known set text OR the reading extract/quotes are provided: write the complete Grade 9 exemplar immediately.
   - If the question is an unseen Reading extract analysis question AND no extract/quotes are provided: do NOT fabricate quotes; provide a Level 4 Annotated Exemplar Blueprint with "[Insert 2-4 word quote]" placeholders and a brief note explaining that the separate Reading Insert was not uploaded.

### FORMATTING RULES (STRICT ADHERENCE REQUIRED)
You MUST output valid RAW HTML using the following structure. Do NOT output Markdown headers (###) or markdown bold (**text**).
1. **Lead-in Context**: If present, repeat it once at the top (plain text).
2. **Structure**:
   <span class="model_question">Question prompt...</span>
   <div class="model_answer">
   <p>Crafted paragraph... <span class="marking-code">[AO5 L4: Tone &amp; register]</span></p>
   </div>
3. **Escape HTML Entities**: Write "<" as "&lt;" and ">" as "&gt;" inside prose text.`;
  }

  return `Expert Examiner Task: Generate a clear, full-mark model answer for the following ${subjectProfile.displayName} question.

### INPUT DATA
Question Data (may include lead-in context and sub-questions):
${message}

Marking Criteria / Scheme:
${markingScheme}

### FORMATTING RULES (STRICT ADHERENCE REQUIRED)
You MUST output valid HTML using the following structure for each part. Do NOT output plain Markdown.
1. **Lead-in Context**: If present, repeat it once at the top (plain text).
2. **Structure**:
   <span class="model_question">(part label) Question text...</span>
   <div class="model_answer">
   <p>Clear, accurate answer point... <span class="marking-code">[1]</span></p>
   </div>
3. **Mark Codes**: Wrap mark allocations in <span class="marking-code">[...]</span> at the end of <p> before </p>.
4. **No Markdown**: Do NOT use Markdown headers (###) or markdown bold (**text**).`;
}

export default MATHS_QUESTION_ONLY_USER_PROMPT;
