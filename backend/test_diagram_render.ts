import { DiagramService } from '../frontend/src/services/DiagramService';

const mockContent = `
<span class="model_question">
15a) New JSON format.
<script type="application/json" class="ai-diagram-data">
{"type": "fallback", "description": "JSON Fallback"}
</script>
</span>
<div class="model_answer">Answer 1</div>

<span class="model_question">
15b) Legacy format (The safety net).
[Type: Graph B - Charge vs Time]
</span>
<div class="model_answer">Answer 2</div>
`;

const result = DiagramService.process(mockContent);
console.log("=== RENDERED OUTPUT ===");
console.log(result);
