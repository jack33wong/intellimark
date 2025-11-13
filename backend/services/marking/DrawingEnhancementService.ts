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
   * Only enhances if normal classification already found [DRAWING] entries
   * 
   * @param allClassificationResults Array of classification results per page
   * @param standardizedPages Array of standardized page data with image data
   * @param model Model to use for drawing classification
   * @param classificationResult Main classification result to update with enhanced questions
   */
  static async enhanceDrawingsInClassification(
    allClassificationResults: Array<{ pageIndex: number; result: ClassificationResult }>,
    standardizedPages: StandardizedPage[],
    model: ModelType,
    classificationResult: ClassificationResult
  ): Promise<void> {
    // Detect pages with drawings and enhance them
    const pagesWithDrawings: Array<{
      pageIndex: number;
      imageData: string;
      questions: Array<{
        questionNumber?: string | null;
        text: string | null;
        studentWork?: string | null;
        subQuestions?: Array<{
          part: string;
          text: string;
          studentWork?: string | null;
        }>;
      }>;
    }> = [];

    allClassificationResults.forEach(({ pageIndex, result }, index) => {
      if (result.category === 'questionAnswer' && result.questions) {
        // Only enhance if normal classification already found [DRAWING] entries
        // Don't try to detect drawings from question text - trust the classification
        const hasDrawings = result.questions.some(q => {
          // Check if student work has [DRAWING] entries
          const hasDrawingsInWork = (q.studentWork && q.studentWork.includes('[DRAWING]')) ||
                                    (q.subQuestions && q.subQuestions.some(sq => sq.studentWork && sq.studentWork.includes('[DRAWING]')));
          
          return hasDrawingsInWork;
        });
        
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

          // Only enhance if normal classification already found [DRAWING] entries
          // Don't try to detect drawings from question text - trust the classification
          const hasDrawingsInStudentWork = q.studentWork && q.studentWork.includes('[DRAWING]');
          
          if (hasDrawingsInStudentWork) {
            try {
              const drawingResult = await DrawingClassificationService.classifyDrawings(
                imageData,
                q.text || '',
                q.questionNumber || null,
                null,
                model
              );

              if (drawingResult.drawings && drawingResult.drawings.length > 0) {
                // Replace [DRAWING] entries with enhanced versions
                enhancedStudentWork = this.mergeDrawingResults(q.studentWork || '', drawingResult.drawings);
              } else {
                // No enhanced drawings found - keep original
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

          // Enhance sub-question student work if it has drawings
          if (q.subQuestions && q.subQuestions.length > 0) {
            enhancedSubQuestions = await Promise.all(q.subQuestions.map(async (sq) => {
              if (sq.studentWork && sq.studentWork.includes('[DRAWING]')) {
                try {
                  const drawingResult = await DrawingClassificationService.classifyDrawings(
                    imageData,
                    sq.text || '',
                    q.questionNumber || null,
                    sq.part || null,
                    model
                  );

                  if (drawingResult.drawings && drawingResult.drawings.length > 0) {
                    const enhanced = this.mergeDrawingResults(sq.studentWork || '', drawingResult.drawings);
                    
                    return {
                      ...sq,
                      studentWork: enhanced
                    };
                  }
                } catch (error) {
                  console.warn(`[DRAWING CLASSIFICATION] Failed to enhance drawings for Q${q.questionNumber}${sq.part} on page ${pageIndex}:`, error);
                }
              }
              return sq;
            }));
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
            sourceImageIndex: pageIndex
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
          
          const mergedSubQuestions = new Map<string, any>();
          questionInstances.forEach(({ question }) => {
            if (question.subQuestions && Array.isArray(question.subQuestions)) {
              question.subQuestions.forEach((subQ: any) => {
                const part = subQ.part || '';
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
          
          const allPageIndices = questionInstances.map(({ pageIndex }) => pageIndex);
          const merged = {
            ...pageWithText.question,
            studentWork: combinedStudentWork || pageWithText.question.studentWork || null,
            subQuestions: Array.from(mergedSubQuestions.values()),
            sourceImage: standardizedPages[allPageIndices[0]].originalFileName,
            sourceImageIndex: allPageIndices[0],
            allSourceImageIndices: allPageIndices,
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

