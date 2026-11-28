import { SVGOverlayService } from '../services/marking/svgOverlayService.js';

describe('SVGOverlayService Visual Checklist Stamp (space-gated)', () => {
  const makeInkMap = (density: number) => ({
    getInkDensity: () => density
  });

  const makeGraphAnnotations = () => ([
    {
      action: 'tick',
      text: 'B1',
      subQuestion: '6b',
      ocr_match_status: 'VISUAL',
      line_id: 'p0_visual_drawing_6_14',
      reasoning: 'Correct straight line drawn',
      bbox: [600, 1700, 600, 600]
    },
    {
      action: 'cross',
      text: 'B0',
      subQuestion: '6b',
      ocr_match_status: 'VISUAL',
      line_id: 'p0_visual_drawing_6_14',
      reasoning: 'V-vertex not sharp at (1.5, 0)',
      bbox: [600, 1700, 600, 600]
    },
    {
      action: 'cross',
      text: 'B0',
      subQuestion: '6b',
      ocr_match_status: 'MATCHED',
      line_id: 'p0_q6_line_12',
      reasoning: 'Wrong intersections; Ans: (2/3, 5/3), (4, 5)',
      bbox: [400, 1950, 220, 60]
    }
  ]);

  it('renders a compact checklist stamp for multi-criteria graph sub-questions when clear space exists', () => {
    const svg = (SVGOverlayService as any).createSVGOverlay(
      makeGraphAnnotations(),
      2000,
      2815,
      { width: 2000, height: 2815 },
      undefined,
      undefined,
      false,
      [],
      false,
      makeInkMap(0.01)
    );

    expect(svg).toContain('class="visual-checklist-stamp"');
    expect(svg).toContain('Q6b Check (1/3)');
    expect(svg).toContain('B1 Correct straight line');
    expect(svg).toContain('B0 V-vertex not sharp');
  });

  it('falls back to normal inline annotations when page ink density is too high (space limitation)', () => {
    const svg = (SVGOverlayService as any).createSVGOverlay(
      makeGraphAnnotations(),
      2000,
      2815,
      { width: 2000, height: 2815 },
      undefined,
      undefined,
      false,
      [],
      false,
      makeInkMap(0.35)
    );

    expect(svg).not.toContain('class="visual-checklist-stamp"');
    // Inline fallback still renders B1 and B0 symbols
    expect(svg).toContain('B1');
    expect(svg).toContain('B0');
  });

  it('sums merged mark tokens (e.g. "B1 B1 B1" + "B0") as 3/4 marks instead of 1/2 rows', () => {
    const mergedVisualAnnotations = [
      {
        action: 'tick',
        text: 'B1 B1 B1',
        subQuestion: '6a',
        ocr_match_status: 'VISUAL',
        line_id: 'p0_visual_drawing_6_2',
        reasoning: 'Correctly labeled crest C; Correctly labeled trough T; Correct wavelength W',
        bbox: [458, 1706, 300, 120]
      },
      {
        action: 'cross',
        text: 'B0',
        subQuestion: '6a',
        ocr_match_status: 'VISUAL',
        line_id: 'p0_visual_drawing_6_2',
        reasoning: 'A must be rest to crest',
        bbox: [458, 1706, 300, 120]
      }
    ];

    const svg = (SVGOverlayService as any).createSVGOverlay(
      mergedVisualAnnotations,
      2000,
      2815,
      { width: 2000, height: 2815 },
      undefined,
      undefined,
      false,
      [],
      false,
      makeInkMap(0.01)
    );

    expect(svg).toContain('class="visual-checklist-stamp"');
    expect(svg).toContain('Q6a Check (3/4)');
  });

  it('does not convert normal algebraic/non-visual sub-questions into checklist stamps', () => {
    const algebraAnnotations = [
      {
        action: 'tick',
        text: 'M1',
        subQuestion: '5a',
        ocr_match_status: 'MATCHED',
        line_id: 'p0_q5_line_3',
        reasoning: 'Correct simultaneous equations',
        bbox: [400, 700, 300, 60]
      },
      {
        action: 'tick',
        text: 'A1',
        subQuestion: '5a',
        ocr_match_status: 'MATCHED',
        line_id: 'p0_q5_line_6',
        reasoning: 'Correct d = 4',
        bbox: [400, 800, 200, 60]
      }
    ];

    const svg = (SVGOverlayService as any).createSVGOverlay(
      algebraAnnotations,
      2000,
      2815,
      { width: 2000, height: 2815 },
      undefined,
      undefined,
      false,
      [],
      false,
      makeInkMap(0.01)
    );

    expect(svg).not.toContain('class="visual-checklist-stamp"');
    expect(svg).toContain('M1');
    expect(svg).toContain('A1');
  });
});
