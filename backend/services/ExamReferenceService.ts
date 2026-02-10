import { getFirestore } from '../config/firebase.js';

export class ExamReferenceService {
    private static db = getFirestore();

    // [HELPER] Generate simplified fallbacks for Summer/June/May equivalence AND slug parsing
    public static generateFallbacks(input: string): string[] {
        // Normalize input for base generation
        const lowerInput = input.toLowerCase();
        let variations = [input, lowerInput];

        // 1. Handle Slugs (replace - and _ with spaces or slashes)
        if (/[_\-]/.test(lowerInput)) {
            const spaceVariation = lowerInput.replace(/[_\-]/g, ' ');
            const slashVariation = lowerInput.replace(/[_\-]/g, '/');
            variations.push(spaceVariation, slashVariation);
        }

        // 2. Handle MonthYear concatenation (e.g. "nov2024" -> "nov 2024")
        const monthYearRegex = /([a-z]{3,})(\d{4})/i;
        const expandedVariations = [...variations];

        variations.forEach(v => {
            if (monthYearRegex.test(v)) {
                const separated = v.replace(monthYearRegex, '$1 $2'); // "nov 2024"
                expandedVariations.push(separated);
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
            // Check for short months
            for (const [short, full] of Object.entries(monthMap)) {
                if (v.includes(short) && !v.includes(full)) {
                    mappedVariations.push(v.replace(short, full));
                }
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
        // Deduplicate and lower-case checks
        return Array.from(new Set(all));
    }

    /**
     * Finds an exam paper by ID or by searching with simplified fallbacks
     */
    public static async findPaper(paperInput: string): Promise<any | null> {
        // 1. Try direct ID lookup first
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

        // Bingo Search: Direct match on any variation
        const paperDoc = papers.find((p: any) => {
            const meta = p.metadata;
            if (!meta || !meta.exam_code || !meta.exam_series) return false;

            const normalize = (t: string) => t.toLowerCase().replace(/[-,/]/g, ' ').replace(/\s+/g, ' ').trim();
            const pCode = normalize(meta.exam_board || '') + ' ' + normalize(meta.exam_code || '') + ' ' + normalize(meta.exam_series || '') + (meta.tier ? ' ' + normalize(meta.tier) : '');

            return searchVariations.some(v => {
                const nv = normalize(v);
                return pCode === nv || pCode.includes(nv) || nv.includes(pCode);
            });
        });

        if (!paperDoc) {
            console.log(`❌ [EXAM-REF] No paper found for request: "${paperInput}"`);
            const sampleIds = papers.slice(0, 5).map((p: any) => `${p.metadata?.exam_code} (${p.metadata?.exam_series})`);
            console.log(`ℹ️ [EXAM-REF] Sample DB Patterns: ${sampleIds.join(', ')}`);
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
    public static formatMetadataDisplay(meta: any): { series: string, tier: string } {
        let formattedSeries = meta.exam_series || '';
        if (formattedSeries && /^[A-Z]{3}\d{4}$/.test(formattedSeries)) {
            const monthMap: Record<string, string> = {
                'JAN': 'January', 'FEB': 'February', 'MAR': 'March', 'APR': 'April', 'MAY': 'May', 'JUN': 'June',
                'JUL': 'July', 'AUG': 'August', 'SEP': 'September', 'OCT': 'October', 'NOV': 'November', 'DEC': 'December'
            };
            const monthCode = formattedSeries.substring(0, 3).toUpperCase();
            const year = formattedSeries.substring(3);
            if (monthMap[monthCode]) formattedSeries = `${monthMap[monthCode]} ${year}`;
        }

        let formattedTier = meta.tier || '';
        if (meta.tier === 'H' || meta.tier === 'Higher') formattedTier = 'Higher Tier';
        else if (meta.tier === 'F' || meta.tier === 'Foundation') formattedTier = 'Foundation Tier';

        return { series: formattedSeries, tier: formattedTier };
    }
}
