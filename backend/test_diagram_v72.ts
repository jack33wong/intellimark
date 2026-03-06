import { DiagramService } from '../frontend/src/services/DiagramService';

const mockDriftedContent = `
<script type="application/json" class="ai-diagram-data">
{
  "type": "coordinate_grid",
  "shapes": [
    {
      "type": "triangle",
      "vertices": [{"x": -6, "y": 1}, {"x": -4, "y": 5}, {"x": 0, "y": 1}],
      "label": "A"
    }
  ]
}
</script>

<script type="application/json" class="ai-diagram-data">
{
  "type": "function_graph",
  "details": "Empirical curve without math data"
}
</script>
`;

const result = DiagramService.process(mockDriftedContent);
console.log("=== RENDERED OUTPUT (v7.2) ===");
console.log(result);
