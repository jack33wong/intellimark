import { getPrompt } from '../../config/prompts.js';
import { ModelProvider } from '../../utils/ModelProvider.js';
import type UsageTracker from '../../utils/UsageTracker.js';

/**
 * DiagramBridgeService
 * Shared Two-Prompt Bridge that intercepts [Diagram: ...] or [Type: Diagram: ...]
 * hints in AI responses (Model Answer, Question Mode, Follow-up Chat) and converts
 * them into <script type="application/json" class="ai-diagram-data"> blocks for
 * frontend SVG rendering by DiagramService.
 */
export class DiagramBridgeService {
  static async processDiagramHints(
    content: string,
    model: string = 'auto',
    tracker?: UsageTracker,
    logPrefix: string = 'DIAGRAM-BRIDGE'
  ): Promise<string> {
    if (!content || typeof content !== 'string') return content;

    const isLoggingEnabled = process.env.LOG_SUGGESTED_MODEL_ANSWER === 'true';

    // 1. Unwrap any markdown code fences around <script class="ai-diagram-data"> if AI emitted it directly
    let processedContent = content.replace(
      /```(?:html|json|xml)?\s*(<script\s+type=["']application\/json["']\s+class=["']ai-diagram-data["']>[\s\S]*?<\/script>)\s*```/gi,
      '$1'
    );

    // 2. Match all [Diagram: ...] or [Type: Diagram: ...] hints
    const diagramRegex = /\[(?:Type:\s*Diagram|Diagram):\s*([\s\S]*?)\]/gi;
    const matches = Array.from(processedContent.matchAll(diagramRegex));

    if (matches.length === 0) {
      if (isLoggingEnabled) {
        console.log(`\n[DEBUG] [${logPrefix}] No diagram hints were found in the response.`);
      }
      return processedContent;
    }

    const diagramSystemPrompt = getPrompt('diagramExtractor.system');

    // 3. Process all diagram hints in parallel for minimal latency
    const replacements = await Promise.all(
      matches.map(async (match, idx) => {
        const fullMatchText = match[0];
        const hintDescription = (match[1] || '').trim();
        const diagramNum = idx + 1;

        if (!hintDescription) {
          return { fullMatchText, replacement: '' };
        }

        if (isLoggingEnabled) {
          console.log(`\n[DEBUG] [${logPrefix}] Found Diagram Hint #${diagramNum}: "${hintDescription}"`);
        }

        const diagramUserPrompt = getPrompt('diagramExtractor.user', hintDescription);

        try {
          const diagramAi = await ModelProvider.callText(
            diagramSystemPrompt,
            diagramUserPrompt,
            model as any,
            false,
            tracker,
            'modelAnswer'
          );

          const jsonOutput = diagramAi.content
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();

          if (isLoggingEnabled) {
            console.log(`[DEBUG] [${logPrefix}] Raw JSON Output #${diagramNum}:\n${jsonOutput}`);
          }

          // Verify JSON validity before injecting
          JSON.parse(jsonOutput);

          const scriptTag = `\n<script type="application/json" class="ai-diagram-data">\n${jsonOutput}\n</script>\n`;
          return { fullMatchText, replacement: scriptTag };
        } catch (err) {
          console.error(`[${logPrefix}] Error extracting diagram #${diagramNum} ("${hintDescription}"):`, err);
          // Graceful fallback JSON so DiagramService renders a clean fallback reference box instead of raw bracketed text
          const fallbackJson = JSON.stringify({
            type: 'fallback',
            description: hintDescription
          });
          const fallbackScriptTag = `\n<script type="application/json" class="ai-diagram-data">\n${fallbackJson}\n</script>\n`;
          return { fullMatchText, replacement: fallbackScriptTag };
        }
      })
    );

    // 4. Apply replacements sequentially
    for (const { fullMatchText, replacement } of replacements) {
      processedContent = processedContent.replace(fullMatchText, replacement);
    }

    return processedContent;
  }
}
