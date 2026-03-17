import * as express from 'express';
import type { Request, Response } from 'express';
import { getFirestore } from '../config/firebase.js';
import { ExamReferenceService } from '../services/ExamReferenceService.js';
import { NormalizationService } from '../services/marking/NormalizationService.js';

const router = express.Router();
const db = getFirestore();

/**
 * GET /api/exams/public-list
 * Public endpoint to fetch and group exam data for landing pages.
 */
router.get('/public-list', async (req: Request, res: Response) => {
    try {
        const snapshot = await db.collection('fullExamPapers').get();
        const papers = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data()
        }));

        const groupedData: any = {};

        papers.forEach((paper: any) => {
            const meta = paper.metadata || paper.exam || {};
            let rawBoard = (meta.board || meta.exam_board || 'Unknown').trim();
            const board = NormalizationService.normalizeExamBoard(rawBoard);
            let { series, qualification, isAlevel, tier: formattedTier, tierCode } = ExamReferenceService.formatMetadataDisplay(meta);
            series = NormalizationService.normalizeExamSeries(series, board);
            
            if (!groupedData[board]) {
                groupedData[board] = { gcse: {}, alevel: { pure: {}, stats_mech: {} } };
            }

            const rawQual = (meta.qualification || meta.subject || '').toLowerCase();
            const code = (meta.exam_code || meta.code || '').toLowerCase();
            const name = meta.paper || meta.name || '';

            if (isAlevel) {
                // Group A-Level by Pure vs Stats/Mech
                const isStatsMech = code.includes('31') || code.includes('32') || 
                                   name.toLowerCase().includes('stats') || 
                                   name.toLowerCase().includes('mechanics') ||
                                   code.endsWith('3') || // Common for paper 3
                                   code.includes('/3');

                const category = isStatsMech ? 'stats_mech' : 'pure';
                
                if (!groupedData[board].alevel[category][series]) {
                    groupedData[board].alevel[category][series] = [];
                }

                // Extract Calculator info if present
                const paperName = meta.paper || meta.paper_title || meta.name || '';
                const typeMatch = paperName.match(/(Non-Calculator|Calculator|Non-Calc|Calc)/i);
                let paperType = typeMatch ? typeMatch[0] : '';
                if (paperType.toLowerCase().includes('non')) paperType = 'Non-Calc';
                else if (paperType.toLowerCase().includes('calc')) paperType = 'Calculator';

                groupedData[board].alevel[category][series].push({
                    id: paper.id,
                    code: meta.code || meta.exam_code,
                    name: meta.paper || 'Paper',
                    series: series,
                    tier: formattedTier,
                    tierCode: tierCode,
                    category: category === 'pure' ? 'Pure' : 'Applied',
                    type: paperType
                });
            } else {
                // GCSE grouping
                if (!groupedData[board].gcse[series]) {
                    groupedData[board].gcse[series] = [];
                }

                // Extract Calculator info if present
                const paperName = meta.paper || meta.paper_title || meta.name || '';
                const typeMatch = paperName.match(/(Non-Calculator|Calculator|Non-Calc|Calc)/i);
                let paperType = typeMatch ? typeMatch[0] : '';
                // Normalize to 'Non-Calc' or 'Calculator' if found, otherwise empty
                if (paperType.toLowerCase().includes('non')) paperType = 'Non-Calc';
                else if (paperType.toLowerCase().includes('calc')) paperType = 'Calculator';
                
                groupedData[board].gcse[series].push({
                    id: paper.id,
                    code: meta.code || meta.exam_code,
                    name: meta.paper || 'Paper',
                    series: series,
                    tier: formattedTier,
                    tierCode: tierCode,
                    type: paperType
                });
            }
        });

        // Convert grouped objects to sorted arrays
        const result: any = {};
        for (const board in groupedData) {
            result[board] = {
                gcse: Object.entries(groupedData[board].gcse)
                    .map(([series, papers]: [string, any]) => ({ 
                        series, 
                        papers: papers.sort((a: any, b: any) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true, sensitivity: 'base' }))
                    }))
                    .sort((a, b) => sortSeries(b.series, a.series)),
                alevel: {
                    pure: Object.entries(groupedData[board].alevel.pure)
                        .map(([series, papers]: [string, any]) => ({ 
                            series, 
                            papers: papers.sort((a: any, b: any) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true, sensitivity: 'base' }))
                        }))
                        .sort((a, b) => sortSeries(b.series, a.series)),
                    stats_mech: Object.entries(groupedData[board].alevel.stats_mech)
                        .map(([series, papers]: [string, any]) => ({ 
                            series, 
                            papers: papers.sort((a: any, b: any) => (a.code || '').localeCompare(b.code || '', undefined, { numeric: true, sensitivity: 'base' }))
                        }))
                        .sort((a, b) => sortSeries(b.series, a.series))
                }
            };
        }

        res.json({ success: true, data: result });
    } catch (error: any) {
        console.error('Error fetching public exam list:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

function sortSeries(a: string, b: string): number {
    const parseDate = (s: string) => {
        const parts = s.split(' ');
        if (parts.length < 2) return new Date(0);
        const months: any = { 'January': 0, 'Summer': 5, 'June': 5, 'November': 10 };
        return new Date(parseInt(parts[1]), months[parts[0]] || 0);
    };
    return parseDate(a).getTime() - parseDate(b).getTime();
}

export default router;
