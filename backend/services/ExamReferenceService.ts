import { getFirestore } from '../config/firebase.js';

export class ExamReferenceService {
    private static db = getFirestore();

    // [HELPER] Generate simplified fallbacks for Summer/June/May equivalence AND slug parsing
    public static generateFallbacks(input: string): string[] {
        // Normalize input for base generation
        const lowerInput = input.toLowerCase().replace(/\bmathematics\b/g, 'maths');
        let variations = [input, lowerInput];

        // 1. Handle Slugs (replace - and _ with spaces or slashes)
        if (/[_\-]/.test(lowerInput)) {
            const spaceVariation = lowerInput.replace(/[_\-]/g, ' ');
            const slashVariation = lowerInput.replace(/[_\-]/g, '/');
            variations.push(spaceVariation, slashVariation);
        }

        // 2. Aggressively Handle MonthYear concatenation (e.g. "nov2024" -> "nov 2024", "november2020" -> "november 2020")
        const monthYearRegex = /([a-z]{3,})(\d{4})/i;
        const expandedVariations = [...variations];

        variations.forEach(v => {
            // Split chunks by space or slash and check each chunk
            const chunks = v.split(/[\s/]+/);
            let hasConcat = false;
            const newChunks = chunks.map(c => {
                if (monthYearRegex.test(c)) {
                    hasConcat = true;
                    return c.replace(monthYearRegex, '$1 $2');
                }
                return c;
            });

            if (hasConcat) {
                expandedVariations.push(newChunks.join(' '));
                expandedVariations.push(newChunks.join('/'));
            }
        });
        variations = expandedVariations;

        // 3. Map Short Months to Full Months (e.g. "nov" -> "november")
        const monthMap: Record<string, string> = {
            'jan': 'january', 'feb': 'february', 'mar': 'march', 'apr': 'april', 'may': 'may', 'jun': 'june',
            'jul': 'july', 'aug': 'august', 'sep': 'september', 'oct': 'october', 'nov': 'november', 'dec': 'december'
        };

        const mappedVariations: string[] = [];
        variations.forEach(v => {
            // Split to ensure we accurately replace full words only
            const words = v.split(/[\s/]+/);
            let hasShortMonth = false;
            const newWords = words.map(w => {
                if (monthMap[w]) {
                    hasShortMonth = true;
                    return monthMap[w];
                }
                return w;
            });

            if (hasShortMonth) {
                mappedVariations.push(newWords.join(' '));
            }
        });
        variations.push(...mappedVariations);

        // 4. Handle Summer/June/May equivalence (Existing Logic)
        const yearMatch = input.match(/\d{4}/);
        const yearStr = yearMatch ? yearMatch[0] : '';
        const suffix = yearStr ? ` ${yearStr}` : '';

        const summerMonths = ['Summer', 'June', 'May'];
        const summerRegex = /\b(june|may|summer)\b/i;

        const summerVariations: string[] = [];
        variations.forEach(v => {
            if (summerRegex.test(v)) {
                for (const m of summerMonths) {
                    const sv = v.replace(summerRegex, m);
                    if (!variations.includes(sv)) summerVariations.push(sv);

                    // Year handling
                    if (yearStr) {
                        const svWithYear = sv.includes(yearStr) ? sv : `${sv}${suffix}`;
                        if (!variations.includes(svWithYear)) summerVariations.push(svWithYear);
                    }
                }
            }
        });

        // Final Merge
        const all = [...variations, ...summerVariations];
        return Array.from(new Set(all));
    }

    /**
     * Finds an exam paper by ID or by searching with simplified fallbacks
     */
    public static async findPaper(paperInput: string): Promise<any | null> {
        // 1. Try direct ID lookup first (Catches Main Page links)
        try {
            const directDoc = await this.db.collection('fullExamPapers').doc(paperInput).get();
            if (directDoc.exists) {
                return { id: directDoc.id, ...directDoc.data() };
            }
        } catch (err) {
            console.log(`[EXAM-REF] Input "${paperInput}" is not a valid doc ID, proceeding to search.`);
        }

        console.log(`ℹ️ [EXAM-REF] Looking for paper via search: ${paperInput}`);
        const paperSnapshot = await this.db.collection('fullExamPapers').get();
        const papers = paperSnapshot.docs.map(d => ({ id: d.id, ...d.data() }));

        const normalizedInput = paperInput.toLowerCase().trim();
        const searchVariations = this.generateFallbacks(normalizedInput);
        console.log(`ℹ️ [EXAM-REF] Searching papers with variations: ${JSON.stringify(searchVariations)}`);

        // Common "fluff" words that users type but aren't strictly in the database metadata
        const stopWords = new Set(['gcse', 'igcse', 'alevel', 'a-level', 'tier', 'paper', 'exam', 'the', 'for']);
        const normalize = (t: string) => t.toLowerCase().replace(/\bmathematics\b/g, 'maths').replace(/[-,/]/g, ' ').replace(/\s+/g, ' ').trim();

        let bestPaper: any = null;
        let bestScore = 0;

        papers.forEach((p: any) => {
            const meta = p.metadata;
            if (!meta || !meta.exam_code || !meta.exam_series) return;

            const pCode = normalize(meta.exam_board || '') + ' ' + normalize(meta.exam_code || '') + ' ' + normalize(meta.exam_series || '') + (meta.tier ? ' ' + normalize(meta.tier) : '');
            const pTokens = pCode.split(/\s+/);

            // Clean exam code for exact substring matching (e.g., "8300/1f" -> "83001f")
            const exactCode = (meta.exam_code || '').toLowerCase().replace(/[\s\-\/]/g, '');
            const exactYearMatch = (meta.exam_series || '').match(/\d{4}/);
            const exactYear = exactYearMatch ? exactYearMatch[0] : null;

            let paperBestScore = 0;

            searchVariations.forEach(v => {
                const nv = normalize(v);
                const rawInputTokens = nv.split(/\s+/).filter(t => t.length > 0 && /[a-z0-9]/i.test(t));
                if (rawInputTokens.length === 0) return;

                // Remove fluff words before scoring
                const inputTokens = rawInputTokens.filter(t => !stopWords.has(t));

                let matchScore = 0;
                let matchedTokens = 0;

                // 1. Calculate Token Overlap
                inputTokens.forEach(it => {
                    const matched = pTokens.some(pt => {
                        if (pt === it) return true;
                        if (/^\d+$/.test(pt) && /^\d+$/.test(it)) return parseInt(pt) === parseInt(it);
                        // Allow partial overlap only for longer strings to avoid false positives
                        return (pt.length > 3 && it.length > 3) && (pt.includes(it) || it.includes(pt));
                    });

                    if (matched) {
                        matchedTokens++;
                        matchScore += 1;
                    }
                });

                // 2. Heavy Bonus for Exact Exam Code Match (Crucial for disambiguation)
                const rawInputNoSpaces = v.toLowerCase().replace(/[\s\-\/]/g, '');
                if (exactCode && exactCode.length > 2 && rawInputNoSpaces.includes(exactCode)) {
                    matchScore += 10;
                }

                // 3. Heavy Bonus for Exact Year Match
                if (exactYear && rawInputNoSpaces.includes(exactYear)) {
                    matchScore += 5;
                }

                // 4. Heavy Penalty for Year Contradiction (Prevents grabbing 2024 when asking for 2025)
                const inputYearMatch = v.match(/\d{4}/);
                if (inputYearMatch && exactYear && inputYearMatch[0] !== exactYear) {
                    matchScore -= 20;
                }

                // Only consider it a valid candidate if it matched the exam code OR matched at least 2 strong tokens
                if (matchScore > 0 && (matchScore >= 10 || matchedTokens >= 2)) {
                    paperBestScore = Math.max(paperBestScore, matchScore);
                }
            });

            if (paperBestScore > bestScore) {
                bestScore = paperBestScore;
                bestPaper = p;
            }
        });

        const paperDoc = bestPaper;
        if (!paperDoc) {
            console.log(`❌ [EXAM-REF] No paper found for request: "${paperInput}"`);
            const sampleIds = papers.slice(0, 5).map((p: any) => `${p.metadata?.exam_code} (${p.metadata?.exam_series})`);
            console.log(`ℹ️ [EXAM-REF] Sample DB Patterns: ${sampleIds.join(', ')}`);
        } else {
            console.log(`✅ [EXAM-REF] Best match: ${paperDoc.metadata?.exam_code} (${paperDoc.metadata?.exam_series}) with score ${bestScore}`);
        }

        return paperDoc || null;
    }

    /**
     * Finds a marking scheme matching the paper metadata using simplified fallbacks
     */
    public static async findMarkingScheme(paperMetadata: any): Promise<{ id: string, data: any } | null> {
        if (!paperMetadata) return null;

        const paperCode = paperMetadata.exam_code || paperMetadata.code;
        const paperSeries = paperMetadata.exam_series;

        const schemeSearchVariations = this.generateFallbacks(paperSeries);
        console.log(`ℹ️ [EXAM-REF] Looking for scheme via Metadata: ${paperCode} / ${paperSeries} (Variations: ${JSON.stringify(schemeSearchVariations)})`);

        // Limit to 10 for Firestore 'in' query safety
        const queryVariations = schemeSearchVariations.slice(0, 10);

        let metaSnapshot = await this.db.collection('markingSchemes')
        .where('examDetails.paperCode', '==', paperCode)
        .where('examDetails.exam_series', 'in', queryVariations)
        .limit(1)
        .get();

        if (metaSnapshot.empty && paperCode?.includes('/')) {
            const altCode = paperCode.replace('/', '-');
            console.log(`ℹ️ [EXAM-REF] Retrying scheme search with alt code: ${altCode}`);
            metaSnapshot = await this.db.collection('markingSchemes')
            .where('examDetails.paperCode', '==', altCode)
            .where('examDetails.exam_series', 'in', queryVariations)
            .limit(1)
            .get();
        }

        if (!metaSnapshot.empty) {
            const doc = metaSnapshot.docs[0];
            const data = doc.data();
            console.log(`✅ [EXAM-REF] Found scheme via Metadata Match: ${doc.id} (${data?.examDetails?.exam_series})`);
            return { id: doc.id, data };
        }

        return null;
    }

    /**
     * Formats metadata for display (e.g. "JUN2023" -> "June 2023")
     */
    public static formatMetadataDisplay(meta: any): { series: string, tier: string, tierCode: string, qualification: string, isAlevel: boolean, isGcse: boolean } {
        let formattedSeries = meta.exam_series || meta.session || meta.series || '';
        if (formattedSeries && /^[A-Z]{3}\d{4}$/.test(formattedSeries)) {
            const monthMap: Record<string, string> = {
                'JAN': 'January', 'FEB': 'February', 'MAR': 'March', 'APR': 'April', 'MAY': 'May', 'JUN': 'June',
                'JUL': 'July', 'AUG': 'August', 'SEP': 'September', 'OCT': 'October', 'NOV': 'November', 'DEC': 'December'
            };
            const monthCode = formattedSeries.substring(0, 3).toUpperCase();
            const year = formattedSeries.substring(3);
            if (monthMap[monthCode]) formattedSeries = `${monthMap[monthCode]} ${year}`;
        }

        const rawQual = (meta.qualification || meta.subject || '').toLowerCase();
        const code = (meta.exam_code || meta.code || '').toLowerCase();

        // Robust Qualification Detection: Check explicit metadata and common A-Level code patterns
        const isAlevel = rawQual.includes('a level') || rawQual.includes('alevel') ||
            code.startsWith('7357') || code.startsWith('7356') || code.startsWith('7367') || // AQA
            code.startsWith('9ma0') || code.startsWith('8ma0') || code.startsWith('9fm0') || code.startsWith('8fm0') || // Edexcel
            code.startsWith('h240') || code.startsWith('h230') || code.startsWith('h640') || code.startsWith('h630'); // OCR

        let formattedTier = '';
        let tierCode = 'All';

        if (!isAlevel) {
            let rawTier = (meta.tier || '').toLowerCase();

            // Fallback: Extract Tier from code suffix (e.g. 8300/1F -> Foundation)
            if (!rawTier || (rawTier !== 'h' && rawTier !== 'f' && rawTier !== 'higher' && rawTier !== 'foundation')) {
                const codeMatch = code.match(/([fh])($|\s|\/)/);
                if (codeMatch) rawTier = codeMatch[1];
            }

            if (rawTier.includes('h') || rawTier.includes('higher')) {
                formattedTier = 'Higher Tier';
                tierCode = 'H';
            } else if (rawTier.includes('f') || rawTier.includes('foundation')) {
                formattedTier = 'Foundation Tier';
                tierCode = 'F';
            }
        }

        const isGcse = !isAlevel && (rawQual.includes('gcse') || !!formattedTier || !rawQual || rawQual === 'mathematics' || rawQual === 'maths');

        return {
            series: formattedSeries,
            tier: formattedTier,
            tierCode: tierCode,
            qualification: isAlevel ? 'A-Level' : 'GCSE',
            isAlevel,
            isGcse
        };
    }
}