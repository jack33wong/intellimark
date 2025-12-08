/**
 * Question Processing Service
 * Generates text responses for questionOnly bucket questions
 */

import type { ModelType } from '../../types/index.js';
import type { StandardizedPage } from '../../types/markingRouter.js';

export interface QuestionResponse {
    questionNumber: string;
    questionText: string;
    response: string;
    formattedResponse: string;
    marks: number;
    usageTokens?: number;
}

export interface QuestionProcessingResult {
    questionResponses: QuestionResponse[];
    totalTokens: number;
}

export class QuestionProcessingService {
    /**
     * Generate text responses for questionOnly questions
     */
    static async processQuestions({
        questionOnlyClassificationResult,
        standardizedPages,
        markingSchemesMap,
        actualModel
    }: {
        questionOnlyClassificationResult: any;
        standardizedPages: StandardizedPage[];
        markingSchemesMap: Map<string, any>;
        actualModel: string;
    }): Promise<QuestionProcessingResult> {
        const { MarkingServiceLocator } = await import('./MarkingServiceLocator.js');
        const { convertMarkingSchemeToPlainText } = await import('./MarkingHelpers.js');

        console.log(`\n📝 [QUESTION PROCESSING] Processing ${questionOnlyClassificationResult.questions?.length || 0} question(s)...`);

        if (!questionOnlyClassificationResult.questions || questionOnlyClassificationResult.questions.length === 0) {
            console.log('   No questionOnly questions to process');
            return {
                questionResponses: [],
                totalTokens: 0
            };
        }

        let totalTokens = 0;

        // Generate responses for each question
        const tempResponses = await Promise.all(
            questionOnlyClassificationResult.questions.map(async (question: any, index: number) => {
                const pageIndex = question.sourceImageIndices?.[0] ?? question.sourceImageIndex ?? index;
                const page = standardizedPages[pageIndex];

                if (!page) {
                    console.warn(`[QUESTION PROCESSING] No page found for question ${question.questionNumber} at index ${pageIndex}`);
                    return null;
                }

                const questionText = question.text || '';
                const questionNumber = question.questionNumber || `Q${index + 1}`;

                // Lookup marking scheme
                let markingScheme = '';
                if (markingSchemesMap) {
                    let entry = markingSchemesMap.get(questionNumber);
                    if (!entry && questionNumber.startsWith('Q')) {
                        entry = markingSchemesMap.get(questionNumber.substring(1));
                    }
                    if (entry && entry.questionDetection) {
                        markingScheme = entry.questionDetection.markingScheme || '';
                    }
                }

                // Convert marking scheme to plain text if needed
                let markingSchemePlainText = '';
                if (markingScheme) {
                    if (typeof markingScheme === 'string') {
                        markingSchemePlainText = markingScheme;
                    } else {
                        markingSchemePlainText = convertMarkingSchemeToPlainText(markingScheme, questionNumber);
                    }
                }

                // Generate AI response
                const response = await MarkingServiceLocator.generateChatResponse(
                    page.imageData,
                    questionText,
                    actualModel as ModelType,
                    "questionOnly",
                    false,
                    undefined,
                    false,
                    undefined,
                    markingSchemePlainText
                );

                totalTokens += response.usageTokens || 0;

                return {
                    questionNumber: questionNumber,
                    questionText: questionText,
                    response: response.response,
                    formattedResponse: `<p class="question_header_text">Question ${questionNumber.replace(/^Q/, '')}</p>\n\n${response.response}`,
                    marks: question.marks || 0,
                    usageTokens: response.usageTokens
                };
            })
        );

        // Filter out null responses
        const validResponses = tempResponses.filter(r => r !== null) as QuestionResponse[];

        // Sort by question number
        const sortedResponses = validResponses.sort((a, b) => {
            const numA = parseInt(a.questionNumber.replace(/\D/g, '') || '0');
            const numB = parseInt(b.questionNumber.replace(/\D/g, '') || '0');
            return numA - numB;
        });

        console.log(`✅ [QUESTION PROCESSING] Generated ${sortedResponses.length} text response(s)`);
        console.log(`   Total tokens used: ${totalTokens}\n`);

        return {
            questionResponses: sortedResponses,
            totalTokens
        };
    }
}
