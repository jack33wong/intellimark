/**
 * Normalization Service
 * Centralizes normalization logic for exam boards and series
 */

export class NormalizationService {
    /**
     * Normalize exam board name for comparison
     */
    static normalizeExamBoard(board: string): string {
        if (!board) return '';
        const normalized = board.toLowerCase().trim();
        // Map common variations
        if (normalized.includes('edexcel')) return 'Pearson Edexcel';
        if (normalized.includes('aqa')) return 'AQA';
        if (normalized.includes('ocr')) return 'OCR';
        if (normalized.includes('wjec')) return 'WJEC';
        if (normalized.includes('eduqas')) return 'Eduqas';
        return board; // Return original if no match
    }

    /**
     * Normalize exam series mapping (e.g., "May 2024" to "June 2024" for Edexcel)
     */
    static normalizeExamSeries(series: string, board: string): string {
        if (!series) return '';
        const normalizedSeries = series.trim();
        const normalizedBoard = board ? this.normalizeExamBoard(board) : '';

        // Pearson Edexcel: map "May [Year]", "June [Year]" to "Summer [Year]"
        if (normalizedBoard === 'Pearson Edexcel' || !normalizedBoard) {
            if (/^(May|June|Summer)\s+\d{4}$/i.test(normalizedSeries)) {
                return normalizedSeries.replace(/^(May|June|Summer)/i, 'Summer');
            }
        }

        return normalizedSeries;
    }
}
