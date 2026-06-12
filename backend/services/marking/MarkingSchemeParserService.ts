import { ModelProvider } from '../../utils/ModelProvider.js';
import UsageTracker from '../../utils/UsageTracker.js';

export class MarkingSchemeParserService {

    private static getSystemPrompt(): string {
        return `Role: Data Extraction Specialist & Quality Assurance Verifier
Task: Extract the marking scheme data from the attached PDF into a strict, valid JSON format.

You will receive one or more images of a marking scheme. 
You must output a single JSON object matching the schema below exactly.

Output JSON Schema:
{
  "examDetails": {
    "board": "OCR",
    "subject": "Mathematics",
    "qualification": "GCSE (9-1)",
    "paperCode": "J560/06",
    "tier": "Higher tier",
    "exam_series": "June 2019"
  },
  "subQuestionMaxScores": {
    "1a": 2,
    "1b": 1,
    "2": 4,
    "3a": 1,
    "3b": 1
  },
  "questions": {
    "1a": {
      "answer": "String",
      "marks": [
        {
          "mark": "M1",
          "answer": "String",
          "comments": "String"
        },
        {
          "mark": "A1",
          "answer": "String",
          "comments": "String"
        }
      ]
    }
  },
  "generalMarkingGuidance": "String"
}

Do not include markdown blocks, just the raw JSON object. Ensure all numbers are integers.`;
    }

    /**
     * Parses an array of raw base64 images of a marking scheme into a custom scheme object.
     */
    static async parseImagesToObject(
        base64Images: string[],
        tracker?: UsageTracker
    ): Promise<any> {
        console.log(`🧠 [MarkingSchemeParser] Processing ${base64Images.length} marking scheme images...`);
        console.log(`🤖 [MarkingSchemeParser] Using Hardcoded Model: gemini-2.5-pro (Required for complex table extraction)`);

        if (base64Images.length === 0) {
            return null;
        }

        try {
            const prompt = this.getSystemPrompt();

            // We use callGeminiChat which supports an array of images.
            const response = await ModelProvider.callGeminiChat(
                prompt,
                "Extract the marking scheme data from these images into the requested JSON format.",
                base64Images,
                'gemini-2.5-pro', // Prefer Pro for complex table extraction across multiple pages
                tracker,
                'markingScheme'
            );

            let content = response.content.trim();

            if (content.startsWith('\`\`\`json')) {
                content = content.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
            } else if (content.startsWith('\`\`\`')) {
                content = content.replace(/\`\`\`/g, '').trim();
            }

            const parsedObj = JSON.parse(content);
            console.log(`✅ [MarkingSchemeParser] Successfully parsed custom scheme.`);

            return parsedObj;

        } catch (error) {
            console.error('❌ [MarkingSchemeParser] Failed to parse custom marking scheme:', error);
            // On failure, return null so the pipeline safely falls back to standard behavior
            return null;
        }
    }
}
