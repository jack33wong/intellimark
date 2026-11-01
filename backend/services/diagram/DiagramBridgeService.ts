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

    // Helper to extract local question + model answer context around a specific match index
    const getLocalContext = (matchIndex: number, matchLen: number): string => {
      const before = processedContent.slice(Math.max(0, matchIndex - 500), matchIndex);
      const qStart = Math.max(before.lastIndexOf('model-question-number'), before.lastIndexOf('model-answer-block'));
      const localBefore = qStart >= 0 ? before.slice(qStart) : before;

      const after = processedContent.slice(matchIndex + matchLen, Math.min(processedContent.length, matchIndex + matchLen + 800));
      const qEnd = after.indexOf('model-question-number');
      const localAfter = qEnd >= 0 ? after.slice(0, qEnd) : after;

      return `${localBefore} ${localAfter}`
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1000);
    };

    // 3A. Fast Single-Call Batch Extraction when multiple diagram hints are present
    if (matches.length > 1) {
      const validItems = matches.map((match, idx) => ({
        idx,
        fullMatchText: match[0],
        hintDescription: (match[1] || '').trim(),
        localContext: getLocalContext(match.index || 0, match[0].length)
      })).filter(item => item.hintDescription.length > 0);

      if (validItems.length > 1) {
        const batchUserPrompt = `Extract a JSON array of ${validItems.length} diagram objects in the exact order listed below. Output ONLY a valid JSON array [ {...}, {...}, ... ].\n\n` +
          validItems.map((item, i) => `### HINT #${i + 1}:\nHint: ${item.hintDescription}\nSolved Question & Answer Context: ${item.localContext}`).join('\n\n');

        try {
          if (isLoggingEnabled) {
            console.log(`\n[DEBUG] [${logPrefix}] Batch-extracting ${validItems.length} diagram hints in 1 LLM call...`);
          }
          const batchAi = await ModelProvider.callText(
            diagramSystemPrompt,
            batchUserPrompt,
            model as any,
            false,
            tracker,
            'modelAnswer'
          );

          const rawArrayText = batchAi.content
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();

          const parsedArray = JSON.parse(rawArrayText);
          if (Array.isArray(parsedArray) && parsedArray.length === validItems.length) {
            for (let i = 0; i < validItems.length; i++) {
              const jsonStr = JSON.stringify(parsedArray[i]);
              const scriptTag = `\n<script type="application/json" class="ai-diagram-data">\n${jsonStr}\n</script>\n`;
              processedContent = processedContent.replace(validItems[i].fullMatchText, scriptTag);
            }
            return processedContent;
          }
        } catch (batchErr) {
          console.warn(`[${logPrefix}] Batch diagram extraction fallback to individual calls:`, batchErr);
        }
      }
    }

    // 3B. Individual Extraction (for single hint or fallback)
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

        const plainContext = getLocalContext(match.index || 0, fullMatchText.length);
        const diagramUserPrompt = getPrompt('diagramExtractor.user', hintDescription, plainContext);

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
