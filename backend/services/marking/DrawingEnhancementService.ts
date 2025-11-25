import type { ModelType } from '../../types/index.js';
import type { ClassificationResult } from './ClassificationService.js';
import { DrawingClassificationService, type DrawingClassificationResult } from './DrawingClassificationService.js';
import type { StandardizedPage } from '../../types/markingRouter.js';

/**
 * Service for enhancing drawing classification results
 * Orchestrates calls to DrawingClassificationService and merges enhanced results
 */
export class DrawingEnhancementService {
  /**
   * Enhance drawings in classification results
   * Only enhances if normal classification detected hasStudentDrawing indicators
   * NOW RUNS AFTER QUESTION DETECTION so marking scheme hints can be passed
   * 
   * @param allClassificationResults Array of classification results per page
   * @param standardizedPages Array of standardized page data with image data
   * @param model Model to use for drawing classification
   * @param classificationResult Main classification result to update with enhanced questions
   * @param markingSchemesMap Map of question keys to marking schemes (optional, for hints)
   */
  static async enhanceDrawingsInClassification(
    allClassificationResults: Array<{ pageIndex: number; result: ClassificationResult }>,
    standardizedPages: StandardizedPage[],
    model: ModelType,
    classificationResult: ClassificationResult,
    markingSchemesMap?: Map<string, any>
  ): Promise<void> {
    // Detect pages with drawings and enhance them
    const pagesWithDrawings: Array<{
      pageIndex: number;
      imageData: string;
      questions: Array<{
        questionNumber?: string | null;
        text: string | null;
        studentWork?: string | null;
        hasStudentDrawing?: boolean;
        subQuestions?: Array<{
          part: string;
          text: string;
          studentWork?: string | null;
          hasStudentDrawing?: boolean;
        }>;
      }>;
    }> = [];

    allClassificationResults.forEach(({ pageIndex, result }, index) => {
      if (result.category === 'questionAnswer' && result.questions) {
        // Only enhance if normal classification detected hasStudentDrawing indicators
        // Don't try to detect drawings from question text - trust the classification
        const questionsWithDrawings: string[] = [];
        const hasDrawings = result.questions.some(q => {
          // Check if question or sub-questions have hasStudentDrawing indicator
          const hasDrawingsInQuestion = q.hasStudentDrawing === true ||
            (q.subQuestions && q.subQuestions.some(sq => sq.hasStudentDrawing === true));

          if (hasDrawingsInQuestion) {
            questionsWithDrawings.push(`Q${q.questionNumber || '?'}`);
          }

          return hasDrawingsInQuestion;
        });

        // Debug: Log questions with drawing indicators after classification
        if (questionsWithDrawings.length > 0) {
          console.log(`[DEBUG DRAWING] Page ${pageIndex}: Questions with hasStudentDrawing indicator: ${questionsWithDrawings.join(', ')}`);
        }

        if (hasDrawings && standardizedPages[index]) {
          pagesWithDrawings.push({
            pageIndex,
            imageData: standardizedPages[index].imageData,
            questions: result.questions
          });
        }
      }
    });

    // Run specialized drawing classification for pages with drawings
    if (pagesWithDrawings.length > 0) {
      const drawingEnhancementPromises = pagesWithDrawings.map(async ({ pageIndex, imageData, questions }) => {
        const pageResult = allClassificationResults.find(r => r.pageIndex === pageIndex);
        if (!pageResult) return null;

        const enhancedQuestions = await Promise.all(questions.map(async (q) => {
          let enhancedStudentWork = q.studentWork;
          let enhancedSubQuestions = q.subQuestions;

          // Look up marking scheme for this question (if available)
          let markingScheme = null;
          if (markingSchemesMap && q.questionNumber) {
            // Try to find marking scheme by matching question number
            // The key format is: `${questionNumber}_${examBoard}_${paperCode}`
            // We need to try different combinations
            for (const [key, scheme] of markingSchemesMap.entries()) {
              const keyParts = key.split('_');
              const schemeQuestionNumber = keyParts[0];
              // Match if question numbers match (handle sub-questions)
              if (schemeQuestionNumber === q.questionNumber ||
                q.questionNumber?.startsWith(schemeQuestionNumber) ||
                schemeQuestionNumber.startsWith(q.questionNumber || '')) {
                markingScheme = scheme;
                break;
              }
            }
          }

          // Check if we have drawings in main question or sub-questions using hasStudentDrawing indicator
          const hasDrawingsInQuestion = q.hasStudentDrawing === true;
          const subQuestionsWithDrawings = q.subQuestions?.filter(sq => sq.hasStudentDrawing === true) || [];
          const hasAnyDrawings = hasDrawingsInQuestion || subQuestionsWithDrawings.length > 0;

          if (hasAnyDrawings) {
            try {
              // GROUPED PROCESSING: Make one API call per question (handles main + all sub-questions together)
              // Collect all sub-questions that have drawings
              const subQuestionsToProcess = subQuestionsWithDrawings.map(sq => ({
                part: sq.part,
                text: sq.text || ''
              }));

              // Use main question text, or combine with sub-question texts if no main question text
              const combinedQuestionText = q.text || subQuestionsToProcess.map(sq => `Part ${sq.part}: ${sq.text}`).join('\n\n');

              // Make ONE API call for the entire question (main + all sub-questions)
              const drawingResult = await DrawingClassificationService.classifyDrawings(
                imageData,
                combinedQuestionText,
                q.questionNumber || null,
                null, // No single sub-question part when processing grouped
                model,
                markingScheme, // Pass marking scheme for hints
                subQuestionsToProcess.length > 0 ? subQuestionsToProcess : null // Pass sub-questions for grouped processing
              );

              if (drawingResult.drawings && drawingResult.drawings.length > 0) {
                // Map drawings back to main question or sub-questions based on questionNumber/subQuestionPart
                const drawingsBySubQuestion = new Map<string, typeof drawingResult.drawings>();
                const mainQuestionDrawings: typeof drawingResult.drawings = [];

                drawingResult.drawings.forEach((drawing) => {
                  if (drawing.subQuestionPart) {
                    // Drawing belongs to a specific sub-question
                    const part = drawing.subQuestionPart;
                    if (!drawingsBySubQuestion.has(part)) {
                      drawingsBySubQuestion.set(part, []);
                    }
                    drawingsBySubQuestion.get(part)!.push(drawing);
                  } else {
                    // Drawing belongs to main question
                    mainQuestionDrawings.push(drawing);
                  }
                });


                // Always pass image to Marking AI for visual verification
                // (Drawing coordinates may be inaccurate, raw image provides best accuracy)
                console.log(`[DRAWING ENHANCEMENT] Q${q.questionNumber}: Passing image to Marking AI for visual verification`);
                (q as any).requiresImageForMarking = true;
                (q as any).imageDataForMarking = imageData;
                if (hasDrawingsInQuestion && mainQuestionDrawings.length > 0) {
                  // Create [DRAWING] entries from enhanced drawings
                  const drawingEntries = mainQuestionDrawings.map((enhanced) => {
                    let entry = `[DRAWING] ${enhanced.drawingType}: ${enhanced.description}`;
                    if (enhanced.position) {
                      entry += ` [POSITION: x=${enhanced.position.x.toFixed(1)}%, y=${enhanced.position.y.toFixed(1)}%]`;
                    }
                    if (enhanced.coordinates && enhanced.coordinates.length > 0) {
                      const coordsStr = enhanced.coordinates.map(c => `(${c.x}, ${c.y})`).join(', ');
                      entry += ` [COORDINATES: ${coordsStr}]`;
                    }
                    if (enhanced.frequencies && enhanced.frequencies.length > 0) {
                      const freqStr = enhanced.frequencies.map(f =>
                        `${f.range}: frequency=${f.frequency}${f.frequencyDensity ? `, frequencyDensity=${f.frequencyDensity}` : ''}`
                      ).join('; ');
                      entry += ` [FREQUENCIES: ${freqStr}]`;
                    }
                    return entry;
                  }).join('\n');

                  // If original studentWork contains [DRAWING], merge with enhanced versions
                  // Otherwise, append drawing entries to existing text (or use drawings alone if no text)
                  if (q.studentWork && q.studentWork.includes('[DRAWING]')) {
                    enhancedStudentWork = this.mergeDrawingResults(q.studentWork, mainQuestionDrawings);
                  } else {
                    // No [DRAWING] in original - append drawings to existing text (if any)
                    if (q.studentWork && q.studentWork.trim()) {
                      enhancedStudentWork = q.studentWork + '\n' + drawingEntries;
                    } else {
                      enhancedStudentWork = drawingEntries;
                    }
                  }
                }

                // Update sub-question student work
                if (q.subQuestions && q.subQuestions.length > 0) {
                  enhancedSubQuestions = q.subQuestions.map((sq) => {
                    if (sq.hasStudentDrawing === true) {
                      const subQDrawings = drawingsBySubQuestion.get(sq.part) || [];
                      if (subQDrawings.length > 0) {
                        // If studentWork doesn't exist yet, create it with [DRAWING] placeholder
                        const baseStudentWork = sq.studentWork || '[DRAWING]';
                        const enhanced = this.mergeDrawingResults(baseStudentWork, subQDrawings);
                        return {
                          ...sq,
                          studentWork: enhanced
                        };
                      }
                    }
                    return sq;
                  });
                }
              } else {
                // EDGE CASE: Drawing Classification returned 0 drawings, but Classification detected hasStudentDrawing=true
                // This happens when the AI can't distinguish student work from printed diagrams (e.g., Q21 graph transformations)
                // Instead of creating a fallback message, we'll flag this question to receive the actual image for marking
                console.log(`[DRAWING ENHANCEMENT] Q${q.questionNumber}: Drawing Classification returned 0 - will pass image to Marking AI for visual evaluation`);

                // Set flag to indicate this question needs image-based marking
                (q as any).requiresImageForMarking = true;
                // Store the image data for later use
                (q as any).imageDataForMarking = imageData;

                // Keep original student work as-is (don't add fallback message)
                enhancedStudentWork = q.studentWork || '';
              }
            } catch (error) {
              console.warn(`[DRAWING CLASSIFICATION] Failed to enhance drawings for Q${q.questionNumber} on page ${pageIndex}:`, error);
              // Keep original if enhancement fails
              enhancedStudentWork = q.studentWork || '';
            }
          } else {
            // No drawings in normal classification - keep original student work
            enhancedStudentWork = q.studentWork || '';
          }

          return {
            ...q,
            studentWork: enhancedStudentWork,
            subQuestions: enhancedSubQuestions,
            confidence: (q as any).confidence || 0.9
          };
        }));

        // Update the classification result with enhanced drawings
        pageResult.result.questions = enhancedQuestions;
        return pageIndex;
      });

      await Promise.all(drawingEnhancementPromises);

      // Rebuild allQuestions array with enhanced drawings
      // Clear and rebuild to include enhanced drawing data
      const enhancedQuestionsByNumber = new Map<string, Array<{ question: any; pageIndex: number }>>();
      const enhancedQuestionsWithoutNumber: Array<{ question: any; pageIndex: number }> = [];

      allClassificationResults.forEach(({ pageIndex, result }) => {
        if (result.questions && Array.isArray(result.questions)) {
          result.questions.forEach((question: any) => {
            const qNum = question.questionNumber;
            if (qNum && qNum !== 'null' && qNum !== 'undefined') {
              const qNumStr = String(qNum);
              if (!enhancedQuestionsByNumber.has(qNumStr)) {
                enhancedQuestionsByNumber.set(qNumStr, []);
              }
              enhancedQuestionsByNumber.get(qNumStr)!.push({ question, pageIndex });
            } else {
              enhancedQuestionsWithoutNumber.push({ question, pageIndex });
            }
          });
        }
      });

      // Rebuild allQuestions with enhanced data
      const enhancedAllQuestions: any[] = [];
      enhancedQuestionsByNumber.forEach((questionInstances, questionNumber) => {
        if (questionInstances.length === 1) {
          const { question, pageIndex } = questionInstances[0];
          enhancedAllQuestions.push({
            ...question,
            sourceImage: standardizedPages[pageIndex].originalFileName,
            sourceImageIndex: pageIndex,
            // Ensure sourceImageIndices is set for single-page questions too
            sourceImageIndices: question.sourceImageIndices && Array.isArray(question.sourceImageIndices) && question.sourceImageIndices.length > 0
              ? question.sourceImageIndices
              : [pageIndex]
          });
        } else {
          // Merge logic (same as before)
          const pageWithText = questionInstances.find(({ question }) =>
            question.text && question.text !== 'null' && question.text.trim().length > 0
          ) || questionInstances[0];

          const combinedStudentWork = questionInstances
            .map(({ question }) => question.studentWork)
            .filter(sw => sw && sw !== 'null' && sw.trim().length > 0)
            .join('\n');

          // Merge sub-questions if present (group by part, combine student work)
          // Also track which pages each sub-question came from
          const mergedSubQuestions = new Map<string, any>();
          const subQuestionPageIndices = new Set<number>(); // Track pages that have sub-questions

          questionInstances.forEach(({ question, pageIndex }) => {
            if (question.subQuestions && Array.isArray(question.subQuestions)) {
              question.subQuestions.forEach((subQ: any) => {
                const part = subQ.part || '';
                // Track that this page has sub-questions
                subQuestionPageIndices.add(pageIndex);

                if (!mergedSubQuestions.has(part)) {
                  mergedSubQuestions.set(part, {
                    part: subQ.part,
                    text: subQ.text && subQ.text !== 'null' ? subQ.text : null,
                    studentWork: null,
                    confidence: subQ.confidence || 0.9
                  });
                }
                if (subQ.studentWork && subQ.studentWork !== 'null' && subQ.studentWork.trim().length > 0) {
                  const existing = mergedSubQuestions.get(part)!;
                  if (existing.studentWork) {
                    existing.studentWork += '\n' + subQ.studentWork;
                  } else {
                    existing.studentWork = subQ.studentWork;
                  }
                }
                if (subQ.text && subQ.text !== 'null' && !mergedSubQuestions.get(part)!.text) {
                  mergedSubQuestions.get(part)!.text = subQ.text;
                }
              });
            }
          });

          // Collect all page indices for this merged question
          // Include both question instance pages AND pages that have sub-questions
          const questionInstancePageIndices = questionInstances.map(({ pageIndex }) => pageIndex);
          const allPageIndices = [...new Set([...questionInstancePageIndices, ...Array.from(subQuestionPageIndices)])].sort((a, b) => a - b);

          const merged = {
            ...pageWithText.question,
            studentWork: combinedStudentWork || pageWithText.question.studentWork || null,
            subQuestions: Array.from(mergedSubQuestions.values()),
            sourceImage: standardizedPages[allPageIndices[0]].originalFileName,
            sourceImageIndex: allPageIndices[0],
            // Store all page indices this question spans (for multi-page questions)
            // Use sourceImageIndices (not allSourceImageIndices) to match main merging logic
            sourceImageIndices: allPageIndices,
            confidence: Math.max(...questionInstances.map(({ question }) => question.confidence || 0.9))
          };

          enhancedAllQuestions.push(merged);
        }
      });

      enhancedQuestionsWithoutNumber.forEach(({ question, pageIndex }) => {
        enhancedAllQuestions.push({
          ...question,
          sourceImage: standardizedPages[pageIndex].originalFileName,
          sourceImageIndex: pageIndex
        });
      });

      // Update classificationResult with enhanced questions
      classificationResult.questions = enhancedAllQuestions;
    }
  }

  /**
   * Merge enhanced drawing results into original student work
   * Replaces [DRAWING] entries with high-accuracy versions from specialized classification
   */
  private static mergeDrawingResults(
    originalStudentWork: string,
    enhancedDrawings: Array<{
      drawingType: string;
      description: string;
      position?: { x: number; y: number };
      coordinates?: Array<{ x: number; y: number }>;
      frequencies?: Array<{ range: string; frequency: number; frequencyDensity?: number }>;
    }>
  ): string {
    if (!originalStudentWork || !originalStudentWork.includes('[DRAWING]')) {
      return originalStudentWork;
    }

    // Split by newlines to process each entry
    const entries = originalStudentWork.split(/\n|\\n/).map(e => e.trim()).filter(e => e.length > 0);
    const mergedEntries: string[] = [];

    // If we have enhanced drawings, replace ALL [DRAWING] entries with enhanced versions
    // Enhanced classification may group multiple drawings into one (e.g., all triangles together)
    if (enhancedDrawings.length > 0) {
      let hasAddedEnhancedDrawings = false;

      for (const entry of entries) {
        if (entry.includes('[DRAWING]')) {
          // Only add enhanced drawings once (first time we encounter a [DRAWING] entry)
          // This handles cases where enhanced classification groups multiple drawings into one
          if (!hasAddedEnhancedDrawings) {
            // Add all enhanced drawings
            enhancedDrawings.forEach((enhanced) => {
              // Check if this enhanced drawing groups multiple elements (e.g., "triangle B, triangle C, and marked")
              // If so, split it into separate entries based on coordinates
              const shouldSplit = enhanced.coordinates && enhanced.coordinates.length > 3 &&
                (enhanced.description.toLowerCase().includes('triangle') &&
                  enhanced.description.toLowerCase().includes('marked') ||
                  enhanced.description.toLowerCase().includes('triangle b') &&
                  enhanced.description.toLowerCase().includes('triangle c'));

              if (shouldSplit && enhanced.coordinates) {
                // Split grouped drawing into separate entries
                // Strategy: Triangles have 3 coordinates, single marks have 1 coordinate
                const coords = enhanced.coordinates;
                const triangles: Array<{ coords: Array<{ x: number; y: number }>; label: string }> = [];
                const marks: Array<{ coord: { x: number; y: number }; label: string }> = [];

                // Try to identify triangles (3 coordinates) and marks (1 coordinate)
                let i = 0;
                while (i < coords.length) {
                  if (i + 2 < coords.length) {
                    // Potential triangle (3 coordinates)
                    triangles.push({
                      coords: [coords[i], coords[i + 1], coords[i + 2]],
                      label: triangles.length === 0 ? 'Triangle B' : 'Triangle C'
                    });
                    i += 3;
                  } else {
                    // Single coordinate (mark)
                    marks.push({
                      coord: coords[i],
                      label: 'Center of rotation'
                    });
                    i += 1;
                  }
                }

                // Create separate [DRAWING] entries for each triangle
                triangles.forEach((triangle, idx) => {
                  let triangleEntry = `[DRAWING] ${enhanced.drawingType}: ${triangle.label} drawn at vertices ${triangle.coords.map(c => `(${c.x}, ${c.y})`).join(', ')}`;
                  if (enhanced.position) {
                    // Use same position for all (or could calculate individual positions if needed)
                    triangleEntry += ` [POSITION: x=${enhanced.position.x.toFixed(1)}%, y=${enhanced.position.y.toFixed(1)}%]`;
                  }
                  triangleEntry += ` [COORDINATES: ${triangle.coords.map(c => `(${c.x}, ${c.y})`).join(', ')}]`;
                  mergedEntries.push(triangleEntry);
                });

                // Create separate [DRAWING] entries for each mark
                marks.forEach((mark) => {
                  let markEntry = `[DRAWING] ${enhanced.drawingType}: ${mark.label} marked at (${mark.coord.x}, ${mark.coord.y})`;
                  if (enhanced.position) {
                    markEntry += ` [POSITION: x=${enhanced.position.x.toFixed(1)}%, y=${enhanced.position.y.toFixed(1)}%]`;
                  }
                  markEntry += ` [COORDINATES: (${mark.coord.x}, ${mark.coord.y})]`;
                  mergedEntries.push(markEntry);
                });
              } else {
                // Single drawing - add as-is
                let enhancedEntry = `[DRAWING] ${enhanced.drawingType}: ${enhanced.description}`;

                // Add position if available
                if (enhanced.position) {
                  enhancedEntry += ` [POSITION: x=${enhanced.position.x.toFixed(1)}%, y=${enhanced.position.y.toFixed(1)}%]`;
                }

                // Add coordinates for coordinate grids
                if (enhanced.coordinates && enhanced.coordinates.length > 0) {
                  const coordsStr = enhanced.coordinates.map(c => `(${c.x}, ${c.y})`).join(', ');
                  enhancedEntry += ` [COORDINATES: ${coordsStr}]`;
                }

                // Add frequencies for histograms
                if (enhanced.frequencies && enhanced.frequencies.length > 0) {
                  const freqStr = enhanced.frequencies.map(f =>
                    `${f.range}: frequency=${f.frequency}${f.frequencyDensity ? `, frequencyDensity=${f.frequencyDensity}` : ''}`
                  ).join('; ');
                  enhancedEntry += ` [FREQUENCIES: ${freqStr}]`;
                }

                mergedEntries.push(enhancedEntry);
              }
            });
            hasAddedEnhancedDrawings = true;
          }
          // Skip original [DRAWING] entries - they're replaced by enhanced versions
        } else {
          // Keep non-drawing entries as-is
          mergedEntries.push(entry);
        }
      }
    } else {
      // No enhanced drawings - keep original as-is
      return originalStudentWork;
    }

    return mergedEntries.join('\n');
  }
}

