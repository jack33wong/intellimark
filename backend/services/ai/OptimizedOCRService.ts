/**
 * OptimizedOCRService.ts
 *
 * Enhanced version with refined pre-filtering, noise rejection, and precisely tuned grouping thresholds.
 * Includes critical fix for adaptive filtering using "First Significant Gap" heuristic.
 */

// --- Type Imports ---
export interface OcrBlock { text: string; boundingBox: { x: number; y: number; width: number; height: number; }; source: string; confidence?: number; mathpixLatex?: string; originalIndex?: number; step_id?: string; originalIndices?: number[]; }
export interface Dimensions { width: number; height: number; }
export interface OptimizedOCRResult { text: string; boundingBoxes: OcrBlock[]; confidence: number; dimensions: { width: number; height: number; }; usage?: { mathpixCalls: number; }; questionText: string; processingTime?: number; }

// --- Main Class ---
export class OptimizedOCRService {

  // Constants for adaptive thresholds - PRECISELY TUNED
  private static readonly LINE_JOIN_VERTICAL_FACTOR = 1.0; // Stricter vertical alignment within a line
  private static readonly LINE_JOIN_HORIZONTAL_FACTOR = 2.0; // Reduced horizontal gap tolerance
  private static readonly STEP_JOIN_VERTICAL_FACTOR = 1.5; // Stricter vertical separation between steps

  // Keywords and noise patterns to aggressively filter out
  private static readonly NOISE_FILTER_KEYWORDS = new Set([
    "do", "not", "write", "in", "this", "area", "zex", "ax", "p", "a", "l", "h", "z",
    "rou", "vound", "up", "marks", "total", "question",
    "for", "is"
  ]);

  // Template phrases to filter out
  private static readonly TEMPLATE_PHRASES = [
    "total for question", "do not write in this area", "do not write", "turn over", "page", "blank"
  ];

  static async process(rawBlocks: OcrBlock[], imageBuffer: Buffer, imageDimensions: Dimensions): Promise<OptimizedOCRResult> {

    // 0. Pre-filter obvious noise and template text
    const filteredRawBlocks = rawBlocks.filter(block => this._isMeaningfulBlock(block, imageDimensions));

    // Calculate average block height for adaptive thresholds
    const avgHeight = this._calculateAverageBlockHeight(filteredRawBlocks);

    // 1. Adaptive Filtering (FIXED: First Significant Gap Heuristic)
    const { studentWorkBlocks, questionBlocks } = this._adaptiveFilter(filteredRawBlocks, imageDimensions, avgHeight);
    
    const questionText = questionBlocks.map(b => b.text).join(' ');
    
    // 2. Mathpix Enhancement (Optimized)
    const { enhancedBlocks, mathpixCalls } = await this._enhanceWithMathpix(studentWorkBlocks, imageBuffer, imageDimensions, avgHeight);
    
    // 3. Grouping into Steps (Adaptive and Tuned)
    // Apply final filtering pass post-Mathpix enhancement
    const finalBlocksForGrouping = enhancedBlocks.filter(block => this._isMeaningfulBlock(block, imageDimensions));
    const finalSteps = this._groupIntoSteps(finalBlocksForGrouping, avgHeight);
    
    const confidence = this._calculateConfidence(finalSteps);
    const combinedText = finalSteps.map(step => step.text).join('\n');

    return {
      text: combinedText,
      boundingBoxes: finalSteps,
      confidence,
      dimensions: imageDimensions,
      usage: { mathpixCalls },
      questionText: questionText,
      processingTime: 0
    };
  }

  /**
   * Determines if a block is meaningful content or just noise/template text.
   */
  private static _isMeaningfulBlock(block: OcrBlock, imageDimensions: Dimensions): boolean {
    const text = block.text.toLowerCase().trim();
    if (text.length === 0) return false;

    // Filter out common template phrases
    if (this.TEMPLATE_PHRASES.some(phrase => text.includes(phrase))) {
        // Exception: If Mathpix enhanced it significantly, keep it.
        if (block.source === 'mathpix' && this._containsSignificantMath(text)) {
            return true;
        }
        return false;
    }

    // Filter out single/short noise words identified in the log
    if (this.NOISE_FILTER_KEYWORDS.has(text)) {
        return false;
    }

    // Filter out likely page numbers near the bottom edge (heuristic)
    const isNearBottom = block.boundingBox.y > imageDimensions.height * 0.95;
    const isPageNumberPattern = text.match(/^[\dpa\s]+$/) && text.length < 25;
    if (isNearBottom && isPageNumberPattern) {
        return false;
    }

    // Filter for isolated short numbers (like "6", "68") if they are not Mathpix enhanced
    if (text.match(/^\d{1,2}$/) && block.source !== 'mathpix') {
        return false;
    }
    
    return true;
  }

  // Helper to check if text contains significant math characters beyond basic numbers
  private static _containsSignificantMath(text: string): boolean {
    // Check for LaTeX structures or complex symbols
    return /[\+\-=×÷*/√²³π()\[\]{}]|\\(frac|sqrt|pi|times)/.test(text);
  }


  private static _calculateAverageBlockHeight(blocks: OcrBlock[]): number {
    if (blocks.length === 0) return 40; // Default fallback

    // Calculate average height using a robust method (median filtering)
    const heights = blocks.map(b => b.boundingBox.height);
    if (heights.length === 0) return 40;

    const sortedHeights = [...heights].sort((a, b) => a - b);
    const medianHeight = sortedHeights[Math.floor(sortedHeights.length / 2)];
    
    // Filter blocks that are significantly larger than the median
    const standardBlocks = blocks.filter(b => b.boundingBox.height < medianHeight * 2.5);
    
    if (standardBlocks.length === 0) return medianHeight;

    const totalHeight = standardBlocks.reduce((sum, block) => sum + block.boundingBox.height, 0);
    return totalHeight / standardBlocks.length;
  }

  /**
   * Adaptive Filtering: Dynamically separate question text from student work using "First Significant Gap" heuristic.
   */
  private static _adaptiveFilter(blocks: OcrBlock[], imageDimensions: Dimensions, avgHeight: number): { studentWorkBlocks: OcrBlock[], questionBlocks: OcrBlock[] } {
    if (blocks.length === 0) return { studentWorkBlocks: [], questionBlocks: [] };

    // Ensure blocks are sorted top-to-bottom
    const sortedBlocks = [...blocks].sort((a, b) => a.boundingBox.y - b.boundingBox.y);

    // Define a significant gap threshold (e.g., 5% of image height, or 4x the average block height)
    // Increased multiplier to 4x avgHeight to be more sensitive to the main gap.
    const significantGapThreshold = Math.max(imageDimensions.height * 0.05, avgHeight * 4); 

    let splitY = 0;
    const searchStart = imageDimensions.height * 0.1; // Start after potential header

    // Iterate through the blocks to find the FIRST significant gap
    for (let i = 0; i < sortedBlocks.length - 1; i++) {
        const currentBlockBottom = sortedBlocks[i].boundingBox.y + sortedBlocks[i].boundingBox.height;
        const nextBlockTop = sortedBlocks[i+1].boundingBox.y;
        
        if (currentBlockBottom > searchStart) {
            const gap = nextBlockTop - currentBlockBottom;
            if (gap > significantGapThreshold) {
                splitY = currentBlockBottom + gap / 2;
                console.log(`📊 [FILTERING] Found first significant gap (${gap.toFixed(0)}px > threshold ${significantGapThreshold.toFixed(0)}px). Splitting at Y=${splitY.toFixed(0)}.`);
                break; // CRITICAL FIX: Stop after finding the first significant gap
            }
        }
    }

    if (splitY === 0) {
        // Fallback: If no significant gap is found, use the previous median split logic.
        const firstBlockY = sortedBlocks[0].boundingBox.y;
        const lastBlockY = sortedBlocks[sortedBlocks.length - 1].boundingBox.y + sortedBlocks[sortedBlocks.length - 1].boundingBox.height;
        splitY = firstBlockY + (lastBlockY - firstBlockY) / 2;
        console.log(`📊 [FILTERING] No significant gap found. Falling back to median split at Y=${splitY.toFixed(0)}.`);
    }

    const studentWorkBlocks: OcrBlock[] = [];
    const questionBlocks: OcrBlock[] = [];
    
    for (const block of blocks) {
      if (block.boundingBox.y >= splitY) {
        studentWorkBlocks.push(block);
      } else {
        questionBlocks.push(block);
      }
    }

    console.log(`📊 [FILTERING] Separated into ${questionBlocks.length} question blocks and ${studentWorkBlocks.length} student work blocks.`);
    return { studentWorkBlocks, questionBlocks };
  }


  /**
   * Optimized Mathpix Enhancement (Preserved logic, uses updated thresholds)
   */
  private static async _enhanceWithMathpix(blocks: OcrBlock[], imageBuffer: Buffer, dimensions: Dimensions, avgHeight: number): Promise<{ enhancedBlocks: OcrBlock[], mathpixCalls: number }> {
    
    // Use the stricter criteria to select candidates
    const mathCandidates = blocks.map((block, index) => ({...block, originalIndex: index}))
                                 .filter(b => this._isStrongMathCandidate(b.text));
    
    if (mathCandidates.length === 0) return { enhancedBlocks: blocks, mathpixCalls: 0 };
    
    // Group candidates into lines (using the updated, stricter thresholds)
    mathCandidates.sort((a, b) => a.boundingBox.y - b.boundingBox.y || a.boundingBox.x - b.boundingBox.x);
    const mathLines: OcrBlock[][] = [];
    const verticalThreshold = avgHeight * this.LINE_JOIN_VERTICAL_FACTOR;

    if (mathCandidates.length > 0) {
        let currentLine: OcrBlock[] = [mathCandidates[0]];
        for (let i = 1; i < mathCandidates.length; i++) {
            const block = mathCandidates[i];
            const lastInLine = currentLine[currentLine.length - 1];
            const verticalMidpointDiff = Math.abs((lastInLine.boundingBox.y + lastInLine.boundingBox.height/2) - (block.boundingBox.y + block.boundingBox.height/2));

            if (verticalMidpointDiff < verticalThreshold) {
                currentLine.push(block);
            } else {
                mathLines.push(currentLine);
                currentLine = [block];
            }
        }
        mathLines.push(currentLine);
    }

    // Merge lines into regions (Minimizes API calls)
    const mergedMathRegions = mathLines.map(line => {
        const merged: OcrBlock = JSON.parse(JSON.stringify(line[0]));
        merged.originalIndices = line.map(l => l.originalIndex!);
        for (let i = 1; i < line.length; i++) {
            const block = line[i];
            const box = merged.boundingBox;
            
            const newX = Math.min(box.x, block.boundingBox.x);
            const newY = Math.min(box.y, block.boundingBox.y);
            const newRight = Math.max(box.x + box.width, block.boundingBox.x + block.boundingBox.width);
            const newBottom = Math.max(box.y + box.height, block.boundingBox.y + block.boundingBox.height);

            box.x = newX;
            box.y = newY;
            box.width = newRight - newX;
            box.height = newBottom - newY;
            merged.text += ' ' + block.text;
        }
        return merged;
    });
    
    console.log(`🔍 [MATHPIX] Found ${mathCandidates.length} math fragments, merged into ${mergedMathRegions.length} logical regions.`);
    
    const sharp = (await import('sharp')).default;
    let mathpixCalls = 0;
    const newMathpixBlocks: OcrBlock[] = [];
    
    // Process regions with Mathpix
    for (const region of mergedMathRegions) {
      try {
        const { x, y, width, height } = region.boundingBox;
        // Adaptive padding
        const padding = Math.max(20, Math.round(avgHeight * 0.5));

        // Calculate extraction coordinates safely
        const extractLeft = Math.max(0, Math.floor(x - padding));
        const extractTop = Math.max(0, Math.floor(y - padding));
        const extractWidth = Math.min(dimensions.width - extractLeft, Math.ceil(width + padding * 2));
        const extractHeight = Math.min(dimensions.height - extractTop, Math.ceil(height + padding * 2));

        if (extractWidth <= 0 || extractHeight <= 0) continue;

        const regionBuffer = await sharp(imageBuffer)
            .extract({ left: extractLeft, top: extractTop, width: extractWidth, height: extractHeight })
            .png().toBuffer();
            
        const mathpixResult = await this._callMathpixAPI(regionBuffer);
        mathpixCalls++;
        
        // Confidence threshold (0.75)
        if (mathpixResult && mathpixResult.latex_styled && (mathpixResult.confidence > 0.75 || mathpixResult.confidence_rate > 0.75)) {
          const confidence = mathpixResult.confidence_rate || mathpixResult.confidence;
          console.log(`✨ Enhanced region with Mathpix LaTeX: "${mathpixResult.latex_styled}" (Conf: ${confidence.toFixed(2)})`);
          newMathpixBlocks.push({ text: mathpixResult.latex_styled, boundingBox: region.boundingBox, source: 'mathpix', confidence: confidence, originalIndices: region.originalIndices });
        }
      } catch (error: any) {
        console.error(`❌ Mathpix processing failed for a merged region (continuing pipeline): ${error.message}`);
      }
    }

    // Integrate Mathpix results back into the main block set
    const originalIndicesToRemove = new Set(newMathpixBlocks.flatMap(b => b.originalIndices || []));
    let finalBlockSet = blocks.map((b, i) => ({...b, originalIndex: i})).filter(b => !originalIndicesToRemove.has(b.originalIndex));
    finalBlockSet.push(...newMathpixBlocks);

    return { enhancedBlocks: finalBlockSet, mathpixCalls };
  }

  /**
   * Stricter criteria for identifying Mathpix candidates. (Preserved)
   */
  private static _isStrongMathCandidate(text: string): boolean {
    if (text.length > 60) return false; 

    const mathChars = text.match(/[\d=+\-×÷*/√²³π.,()\[\]{}|<>≤≥]/g) || [];
    const mathRatio = mathChars.length / text.length;

    if (mathRatio < 0.5) return false;

    if (text.match(/^[a-zA-Z]{4,}$/)) return false;

    return true;
  }


  /**
   * REWRITTEN GROUPING LOGIC: Adaptive and stricter thresholds.
   */
  private static _groupIntoSteps(blocks: OcrBlock[], avgHeight: number): OcrBlock[] {
    // Sort primarily by vertical position, then horizontal
    blocks.sort((a, b) => a.boundingBox.y - b.boundingBox.y || a.boundingBox.x - b.boundingBox.x);

    // Define adaptive thresholds using the updated, stricter factors
    const verticalThreshold = Math.max(40, avgHeight * this.LINE_JOIN_VERTICAL_FACTOR);
    const horizontalThreshold = Math.max(60, avgHeight * this.LINE_JOIN_HORIZONTAL_FACTOR);

    // Pass 1: Group into horizontal lines
    const lines: OcrBlock[] = [];
    if (blocks.length > 0) {
        let currentLine: OcrBlock = { ...blocks[0], boundingBox: {...blocks[0].boundingBox} };
        for (let i = 1; i < blocks.length; i++) {
            const block = blocks[i];
            const verticalMidpointDiff = Math.abs((currentLine.boundingBox.y + currentLine.boundingBox.height / 2) - (block.boundingBox.y + block.boundingBox.height / 2));
            const horizontalGap = block.boundingBox.x - (currentLine.boundingBox.x + currentLine.boundingBox.width);
            
            // Join words into a line if they are vertically aligned AND close horizontally
            if (verticalMidpointDiff < verticalThreshold && horizontalGap < horizontalThreshold && horizontalGap > -20) { // Allow slight overlap
                currentLine.text += ' ' + block.text;
                
                // Merge bounding boxes
                const newRight = Math.max(currentLine.boundingBox.x + currentLine.boundingBox.width, block.boundingBox.x + block.boundingBox.width);
                const newBottom = Math.max(currentLine.boundingBox.y + currentLine.boundingBox.height, block.boundingBox.y + block.boundingBox.height);
                
                currentLine.boundingBox.x = Math.min(currentLine.boundingBox.x, block.boundingBox.x);
                currentLine.boundingBox.y = Math.min(currentLine.boundingBox.y, block.boundingBox.y);
                currentLine.boundingBox.width = newRight - currentLine.boundingBox.x;
                currentLine.boundingBox.height = newBottom - currentLine.boundingBox.y;

            } else {
                // If the gap is too large (horizontally or vertically), start a new line
                lines.push(currentLine);
                currentLine = { ...block, boundingBox: {...block.boundingBox} };
            }
        }
        lines.push(currentLine);
    }

    // Pass 2: Group lines into final steps
    const finalSteps: OcrBlock[] = [];
    const stepVerticalThreshold = Math.max(75, avgHeight * this.STEP_JOIN_VERTICAL_FACTOR); // Stricter vertical step separation

    if (lines.length > 0) {
        let currentStep: OcrBlock = { ...lines[0], boundingBox: {...lines[0].boundingBox} };
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            
            // Check for horizontal overlap (Requires at least 20% overlap relative to the smaller width)
            const overlap = Math.max(0, Math.min(currentStep.boundingBox.x + currentStep.boundingBox.width, line.boundingBox.x + line.boundingBox.width) - Math.max(currentStep.boundingBox.x, line.boundingBox.x));
            const isHorizontallyOverlapping = overlap > (Math.min(currentStep.boundingBox.width, line.boundingBox.width) * 0.2);

            const verticalGap = line.boundingBox.y - (currentStep.boundingBox.y + currentStep.boundingBox.height);

            // Group if overlapping horizontally AND vertically close
            if (isHorizontallyOverlapping && verticalGap < stepVerticalThreshold && verticalGap >= -15) {
                currentStep.text += '\n' + line.text;
                
                // Merge bounding boxes
                const newRight = Math.max(currentStep.boundingBox.x + currentStep.boundingBox.width, line.boundingBox.x + line.boundingBox.width);
                currentStep.boundingBox.x = Math.min(currentStep.boundingBox.x, line.boundingBox.x);
                // Y remains the top of the first line in the step
                currentStep.boundingBox.width = newRight - currentStep.boundingBox.x;
                currentStep.boundingBox.height = (line.boundingBox.y + line.boundingBox.height) - currentStep.boundingBox.y;
            } else {
                // If the gap is too large or no overlap, start a new step
                finalSteps.push(currentStep);
                currentStep = { ...line, boundingBox: {...line.boundingBox} };
            }
        }
        finalSteps.push(currentStep);
    }
    
    // Cleanup and assign step IDs
    const cleanedSteps = finalSteps.map((step, index) => {
      // Clean up text: remove newlines, normalize LaTeX text blocks, trim whitespace
      let cleanedText = step.text.replace(/\n/g, ' ').replace(/\\text\s*\{\s*([^}]+)\s*\}/g, '$1').replace(/\s+/g, ' ').trim();
      
      // Heuristic cleanup for unnecessary LaTeX array/aligned wrappers (common Mathpix artifact)
      if (cleanedText.includes("\\begin{array}") || cleanedText.includes("\\begin{aligned}")) {
        // Replace LaTeX newlines (\\) with spaces to allow the AI to process the combined text logically
        cleanedText = cleanedText.replace(/\\\\/g, ' ');
      }
      
      step.text = cleanedText.trim();
      step.step_id = `step_${index + 1}`;
      return step;
    }).filter(step => step.text.length > 0); // Remove any empty steps resulting from cleanup

    // Re-index step IDs after filtering
    cleanedSteps.forEach((step, index) => {
        step.step_id = `step_${index + 1}`;
    });
    
    console.log(`📊 [GROUPING] Grouped into ${cleanedSteps.length} final logical steps using AvgHeight=${avgHeight.toFixed(1)}. (V_Thresh=${verticalThreshold.toFixed(1)}, H_Thresh=${horizontalThreshold.toFixed(1)}, Step_V_Thresh=${stepVerticalThreshold.toFixed(1)})`);
    return cleanedSteps;
  }
  
  
  // (Preserving optimized implementations of closing methods: _callMathpixAPI, _calculateConfidence)

  private static async _callMathpixAPI(imageBuffer: Buffer): Promise<any> {
    try {
      const appId = process.env.MATHPIX_APP_ID;
      const appKey = process.env.MATHPIX_API_KEY;
      if (!appId || !appKey) {
        console.warn("⚠️ [MATHPIX] API credentials not configured. Skipping API call.");
        return null;
      }
      
      const imageBase64 = imageBuffer.toString('base64');
      const headers = { 'app_id': appId, 'app_key': appKey, 'Content-Type': 'application/json' };
      const body = { src: `data:image/png;base64,${imageBase64}`, formats: ['latex_styled'] };
      
      const axios = (await import('axios')).default;
      const response = await axios.post('https://api.mathpix.com/v3/text', body, { headers });
      return response.data;
    } catch (error: any) {
      // Handle API errors gracefully
      if (error.response) {
        console.error(`❌ Mathpix API error (HTTP ${error.response.status}): ${error.response.data?.error || error.message}`);
      } else {
        console.error(`❌ Mathpix API network error: ${error.message}`);
      }
      return null;
    }
  }

  private static _calculateConfidence(blocks: OcrBlock[]): number {
    if (!blocks || blocks.length === 0) return 0;
    const totalConfidence = blocks.reduce((sum, block) => sum + (block.confidence || 0.9), 0);
    const averageConfidence = totalConfidence / blocks.length;
    const blockCountBoost = Math.min(blocks.length / 20.0, 0.05); // Max 5% boost
    return Math.min(averageConfidence + blockCountBoost, 1.0);
  }
}