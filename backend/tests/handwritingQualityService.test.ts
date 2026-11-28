import {
  buildHandwritingOcrLinks,
  HandwritingQualityService
} from '../services/marking/HandwritingQualityService.js';

describe('HandwritingQualityService — false-positive filtering', () => {
  it('skips [circled] MCQ printed options so printed text misreads are never flagged as handwriting issues', () => {
    const rawAnnotations = [
      {
        line_id: 'p0_q4_line_1',
        linked_ocr_id: 'p0_ocr_13',
        ocr_match_status: 'MATCHED',
        action: 'cross',
        subQuestion: '4',
        pageIndex: 0
      }
    ];
    const ocrTextForPrompt = '[ID: p0_q4_line_1] [circled] C. 3.0 \\times 10^6\\text{ cm/s}';
    const rawOcrBlocks = [
      { id: 'p0_ocr_13', text: 'C.30 x 10 cm / s', confidence: 0.72 }
    ];

    const links = buildHandwritingOcrLinks(rawAnnotations, ocrTextForPrompt, rawOcrBlocks);
    expect(links).toHaveLength(0);
  });

  it('ignores spacing/hyphen differences ("X - rays" vs "x-rays"), unit block splits ("340" vs "340 /s"), and printed blocks', () => {
    const result = HandwritingQualityService.analyze([
      {
        questionNumber: '8',
        score: { awardedMarks: 2, totalMarks: 6 },
        handwritingOcrLinks: [
          {
            lineId: 'p0_q8_line_2',
            classificationText: '340 \\text{ /s}',
            linkedOcrId: 'p0_ocr_9',
            ocrText: '340',
            ocrMatchStatus: 'MATCHED',
            confidenceRate: 0.94,
            isWrongStep: true,
            subQuestion: '8bi'
          }
        ]
      },
      {
        questionNumber: '10',
        score: { awardedMarks: 5, totalMarks: 7 },
        handwritingOcrLinks: [
          {
            lineId: 'p1_q10_line_5',
            classificationText: 'x-rays',
            linkedOcrId: 'p1_ocr_3',
            ocrText: 'X - rays',
            ocrMatchStatus: 'MATCHED',
            confidenceRate: 0.96,
            isWrongStep: false,
            subQuestion: '10bi'
          },
          {
            lineId: 'p1_q10_line_6',
            classificationText: 'visible light',
            linkedOcrId: 'p1_ocr_5',
            ocrText: 'visibie light',
            ocrMatchStatus: 'MATCHED',
            confidenceRate: 0.95,
            isPrinted: true,
            isWrongStep: true,
            subQuestion: '10bii'
          }
        ]
      }
    ]);

    expect(result).not.toBeNull();
    expect(result!.summary.rating).toBe('clear');
    expect(result!.summary.issues).toHaveLength(0);
  });

  it('still flags genuine handwritten digit/symbol misreads (e.g. "807" vs "800")', () => {
    const result = HandwritingQualityService.analyze([
      {
        questionNumber: '8',
        score: { awardedMarks: 1, totalMarks: 3 },
        handwritingOcrLinks: [
          {
            lineId: 'p0_q8_line_6',
            classificationText: '340 / 800 = 0.425',
            linkedOcrId: 'p0_ocr_22',
            ocrText: '340 / 807 = 0.425',
            ocrMatchStatus: 'MATCHED',
            confidenceRate: 0.74,
            isWrongStep: true,
            subQuestion: '8bii'
          }
        ]
      }
    ]);

    expect(result).not.toBeNull();
    expect(result!.summary.rating).not.toBe('clear');
    expect(result!.summary.issues.length).toBeGreaterThan(0);
    expect(result!.summary.issues[0].q).toBe('8');
  });
});
