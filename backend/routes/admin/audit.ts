import express from 'express';
import admin from 'firebase-admin';
import { getFirestore } from '../../config/firebase.js'; 
import { ModelProvider } from '../../utils/ModelProvider.js';

const router = express.Router();

const CHUNK_SIZE = 10; // Gemini Flash optimal batch size

// ============================================================================
// Endpoint 1: Run Audit
// POST /api/admin/audit/run
// ============================================================================
router.post('/run', async (req, res) => {
    try {
        const { targets } = req.body;
        const db = getFirestore();
        if (!db) {
            return res.status(500).json({ error: "Firestore not initialized" });
        }

        if (!targets || targets.length === 0) {
            return res.status(400).json({ error: "No targets provided" });
        }

        let totalSuspectsFound = 0;
        let processedCount = 0;

        // PROCESS EACH TARGET
        for (const target of targets) {
            const paperDoc = await db.collection('fullExamPapers').doc(target.paperId).get();
            if (!paperDoc.exists) continue;
            
            processedCount++;
            const rawPaperData = paperDoc.data() || {};
            const paperData = rawPaperData.data || rawPaperData;
            const rawQuestions = paperData.questions || [];
            const questions = Array.isArray(rawQuestions) ? rawQuestions : Object.values(rawQuestions);
            const paperSuspects: any[] = [];

            let schemeData = null;
            if (target.schemeId) {
                const schemeDoc = await db.collection('markingSchemes').doc(target.schemeId).get();
                const rawSchemeData = schemeDoc.exists ? schemeDoc.data() : null;
                schemeData = rawSchemeData?.markingSchemeData || rawSchemeData;
            }

            if (!schemeData) {
                paperSuspects.push({
                    questionId: 'ALL',
                    questionNumber: 'ALL',
                    reason: "Missing marking scheme document in database.",
                    status: "PENDING"
                });
            } else {
                const normId = (id: any) => {
                    if (!id) return '';
                    let nid = String(id).toLowerCase().trim();
                    nid = nid.replace(/^q(?:uestion)?\.?\s*(\d)/, '$1');
                    return nid.replace(/[^a-z0-9]/g, '');
                };

                // Flatten Paper Questions
                const flatPaperQuestions: any[] = [];
                const processPaperRecursive = (item: any, parentId = '', fallbackIndex = '') => {
                    if (!item) return;
                    let rawId = item.part || item.question_part || item.number || item.questionNumber || item.question_number || '';
                    const currentId = normId(rawId);
                    const fullId = parentId ? `${parentId}${currentId}` : (currentId || fallbackIndex);

                    const children = item.subQuestions || item.sub_questions || item.questions;
                    if (children && Array.isArray(children) && children.length > 0) {
                        children.forEach((c: any) => processPaperRecursive(c, fullId, ''));
                    } else {
                        flatPaperQuestions.push({
                            id: fullId,
                            text: item.text || item.questionText || item.question_text || item.content || JSON.stringify(item),
                            original: item
                        });
                    }
                };
                questions.forEach((q: any, idx: number) => processPaperRecursive(q, '', String(idx + 1)));

                // Flatten Scheme Questions
                const flatSchemeQuestions: any = {};
                const schemeQuestions = schemeData.questions || {};
                const processSchemeRecursive = (item: any, parentId = '', keyId = '') => {
                    if (!item) return;
                    let rawId = item.part || item.question_part || item.number || item.questionNumber || item.question_number || keyId || '';
                    const currentId = normId(rawId);
                    const fullId = parentId ? `${parentId}${currentId}` : currentId;

                    const children = item.subQuestions || item.sub_questions || item.questions;
                    let hasChildren = false;
                    if (Array.isArray(children)) {
                        children.forEach((c: any) => processSchemeRecursive(c, fullId, ''));
                        hasChildren = true;
                    } else if (children && typeof children === 'object' && !children.marks) {
                        Object.entries(children).forEach(([k, v]) => processSchemeRecursive(v, fullId, k));
                        hasChildren = true;
                    }

                    if (!hasChildren && fullId) {
                        flatSchemeQuestions[fullId] = item.marks || item;
                    }
                };
                if (Array.isArray(schemeQuestions)) {
                    schemeQuestions.forEach((sq: any, idx: number) => processSchemeRecursive(sq, '', String(idx + 1)));
                } else {
                    Object.entries(schemeQuestions).forEach(([k, v]) => processSchemeRecursive(v, '', k));
                }

                // PAIR THEM UP (Filter out missing data)
                const validPairs = flatPaperQuestions
                    .filter(pq => flatSchemeQuestions[pq.id])
                    .map(pq => ({
                        qId: pq.id,
                        qText: pq.text,
                        originalQ: pq.original,
                        matchedSchemes: flatSchemeQuestions[pq.id]
                    }));

                // 3. BATCH QUESTIONS FOR THE LLM
                for (let i = 0; i < validPairs.length; i += CHUNK_SIZE) {
                    const chunk = validPairs.slice(i, i + CHUNK_SIZE);
                    
                    // Format chunk safely
                    const promptData = chunk.map(vq => {
                        return `
[ID: ${vq.qId}]
RAW QUESTION: ${vq.qText}
RAW SCHEME: ${JSON.stringify(vq.matchedSchemes)}`;
                    }).join('\n\n');

                    const systemPrompt = `You are an expert mathematical contradiction detector. Compare the exam Question Text against its Official Marking Scheme. Do NOT solve the problem. Flag as "isValid": false ONLY if there is a strict mathematical contradiction between the constraints in the question and the answers/methods in the marking scheme.

CRITICAL EXCLUSIONS (DO NOT FLAG THESE):
1. MISSING ASSETS: If the question refers to a "Diagram", "Graph", "Table", or "Figure" that is not provided in this text-only prompt, assume the asset exists and is valid. DO NOT flag this.
2. PARTIAL CREDIT: Marking schemes frequently award marks for intermediate values. Do not flag intermediate values as "impossible final answers."
3. ALTERNATIVE METHODS: Do not flag unsimplified or messy student work provided in the "comments" as contradictions.
4. THE IDENTICAL RULE: If your \`suggestedFix\` is going to be exactly identical to the \`currentText\`, then the question is NOT broken. You MUST return "isValid": true.

CRITICAL INSTRUCTION: You must return ONLY a valid JSON array. You MUST double-escape all math backslashes (e.g., return "\\\\frac" instead of "\\frac") so that your response does not crash JSON.parse. Do not include markdown formatting, backticks, or conversational text.

Output Schema:
[
  { 
    "questionId": "string", 
    "isValid": boolean, 
    "reason": "string",
    "currentText": "string (The original broken question)",
    "schemeLogic": "string (The target constraints from the scheme)",
    "suggestedFix": "string (The fully corrected question text. Empty if isValid is true)"
  }
]`;
                    
                    const userPrompt = `Analyze this batch of raw database records:\n\n${promptData}`;

                    // Call Gemini Flash Lite
                    const llmResponse = await ModelProvider.callGeminiChat(
                        systemPrompt, userPrompt, null, 'gemini-3.1-flash-lite', (req as any).tracker, 'other'
                    );
                    let content = llmResponse.content.trim();
                    
                    if (content.startsWith('\`\`\`json')) {
                        content = content.replace(/\`\`\`json/g, '').replace(/\`\`\`/g, '').trim();
                    } else if (content.startsWith('\`\`\`')) {
                        content = content.replace(/\`\`\`/g, '').trim();
                    }

                    // Sanitize unescaped backslashes (e.g. \frac -> \\frac, \uparrow -> \\uparrow)
                    // This function replaces ANY backslash sequence with a double backslash, 
                    // UNLESS it is already a double backslash or an escaped quote.
                    content = content.replace(/\\./g, (match) => {
                        if (match === '\\"' || match === '\\\\') return match;
                        return '\\\\' + match[1];
                    });

                    try {
                        const parsedResults = JSON.parse(content);
                        // Map results back to suspects
                        for (const result of parsedResults) {
                            if (!result.isValid) {
                                const matchedQ = chunk.find((vq: any) => vq.qId === String(result.questionId))?.originalQ;
                                const fixText = String(result.suggestedFix || "").trim();
                                const currText = String(result.currentText || "").trim();

                                const isNoise = (fixText === currText) || 
                                                (fixText === "N/A") || 
                                                (fixText === "");
                                paperSuspects.push({
                                    questionId: result.questionId,
                                    questionNumber: matchedQ?.number || matchedQ?.questionNumber || result.questionId,
                                    reason: result.reason,
                                    currentText: result.currentText,
                                    schemeLogic: result.schemeLogic,
                                    suggestedFix: result.suggestedFix,
                                    status: isNoise ? "IGNORED" : "PENDING"
                                });
                            }
                        }
                    } catch (e) {
                        console.error('Failed to parse audit LLM response', e);
                    }
                }
            }

            // 4. UPDATE THE PAPER DOCUMENT
            const pendingSuspectsCount = paperSuspects.filter((s: any) => s.status === 'PENDING').length;
            const finalAuditStatus = pendingSuspectsCount > 0 ? 'SUSPECT' : 'CLEAN';
            totalSuspectsFound += pendingSuspectsCount;

            await paperDoc.ref.update({
                'audit.status': finalAuditStatus,
                'audit.lastAuditedAt': new Date().toISOString(),
                'audit.suspects': paperSuspects
            });
        }

        return res.status(200).json({ 
            message: 'Audit complete', 
            papersProcessed: processedCount,
            newSuspectsCount: totalSuspectsFound 
        });

    } catch (error) {
        console.error("Audit run failed:", error);
        return res.status(500).json({ error: "Audit process failed" });
    }
});

// ============================================================================
// Endpoint 2: Resolve Suspects
// POST /api/admin/audit/resolve
// ============================================================================
router.post('/resolve', async (req, res) => {
    try {
        const { paperId, questionId, action } = req.body; // action = "FIXED" | "IGNORED"
        
        const db = getFirestore();
        if (!db) {
            return res.status(500).json({ error: "Firestore not initialized" });
        }

        const paperRef = db.collection('fullExamPapers').doc(paperId);
        const doc = await paperRef.get();
        
        if (!doc.exists) return res.status(404).json({ error: "Paper not found" });
        
        const auditData = doc.data()?.audit || {};
        const suspects = auditData.suspects || [];
        
        // Update the specific suspect's status
        let pendingCount = 0;
        const updatedSuspects = suspects.map((s: any) => {
            if (s.questionId === questionId) {
                s.status = action;
            }
            if (s.status === 'PENDING') pendingCount++;
            return s;
        });

        // If all suspects are resolved, mark the whole paper as CLEAN
        const newStatus = pendingCount === 0 ? 'CLEAN' : 'SUSPECT';

        await paperRef.update({
            'audit.status': newStatus,
            'audit.suspects': updatedSuspects
        });

        return res.status(200).json({ success: true, newPaperStatus: newStatus });

    } catch (error) {
        console.error("Failed to resolve suspect:", error);
        return res.status(500).json({ error: "Resolution failed" });
    }
});

// ============================================================================
// Endpoint 3: Bulk Resolve Suspects (Updated with Recursive Tree Matching)
// POST /api/admin/audit/bulk-fix
// ============================================================================
router.post('/bulk-fix', async (req, res) => {
    try {
        const { fixes } = req.body; 
        if (!fixes || !Array.isArray(fixes)) {
            return res.status(400).json({ error: "Invalid payload" });
        }

        const db = getFirestore();
        if (!db) return res.status(500).json({ error: "Firestore not initialized" });

        const paperUpdates = new Map();
        
        // ID Normalization Helper (matching the engine logic exactly)
        const normId = (id: any) => {
            if (!id) return '';
            let nid = String(id).toLowerCase().trim();
            nid = nid.replace(/^q(?:uestion)?\.?\s*(\d)/, '$1');
            return nid.replace(/[^a-z0-9]/g, '');
        };

        for (const fix of fixes) {
            const paperRef = db.collection('fullExamPapers').doc(fix.paperId);
            
            if (!paperUpdates.has(fix.paperId)) {
                const doc = await paperRef.get();
                if (doc.exists) {
                    paperUpdates.set(fix.paperId, { ref: paperRef, data: doc.data() });
                }
            }

            const paperEntry = paperUpdates.get(fix.paperId);
            if (!paperEntry) continue;
            const paperData = paperEntry.data;

            // RECURSIVE UPDATE STRATEGY
            if (fix.suggestedFix) {
                const updateTreeRecursive = (item: any, parentId = '', fallbackIndex = '') => {
                    if (!item) return false;
                    let rawId = item.part || item.question_part || item.number || item.questionNumber || item.question_number || '';
                    const currentId = normId(rawId);
                    const fullId = parentId ? `${parentId}${currentId}` : (currentId || fallbackIndex);

                    // If it matches the exact target ID path, apply the fix
                    if (String(fullId) === String(fix.questionId)) {
                        item.text = fix.suggestedFix;
                        if (item.questionText) item.questionText = fix.suggestedFix;
                        if (item.question_text) item.question_text = fix.suggestedFix;
                        return true;
                    }

                    const children = item.subQuestions || item.sub_questions || item.questions;
                    if (children && Array.isArray(children)) {
                        for (let idx = 0; idx < children.length; idx++) {
                            const found = updateTreeRecursive(children[idx], fullId, String(idx + 1));
                            if (found) return true; // Short-circuit traversal once updated
                        }
                    }
                    return false;
                };

                // Execute deep tree traversal across top-level fields
                const rootQuestions = paperData.questions || paperData.data?.questions || [];
                const questionsArray = Array.isArray(rootQuestions) ? rootQuestions : Object.values(rootQuestions);
                
                questionsArray.forEach((q: any, idx: number) => {
                    updateTreeRecursive(q, '', String(idx + 1));
                });
            }

            // Clear the Suspect Flag status mapping
            if (paperData.audit && paperData.audit.suspects) {
                paperData.audit.suspects = paperData.audit.suspects.map((s: any) => {
                    if (String(s.questionId) === String(fix.questionId)) s.status = 'FIXED';
                    return s;
                });
                paperData.audit.status = paperData.audit.suspects.some((s: any) => s.status === 'PENDING') ? 'SUSPECT' : 'CLEAN';
            }
        }

        // Commit Updates in Chunks of 400
        const CHUNK_SIZE = 400;
        const updatesArray = Array.from(paperUpdates.values());
        
        for (let i = 0; i < updatesArray.length; i += CHUNK_SIZE) {
            const chunk = updatesArray.slice(i, i + CHUNK_SIZE);
            const batch = db.batch();
            for (const update of chunk) {
                const updatePayload: any = {
                    'audit.suspects': update.data.audit.suspects,
                    'audit.status': update.data.audit.status
                };
                if (update.data.questions) {
                    updatePayload['questions'] = update.data.questions;
                }
                if (update.data.data && update.data.data.questions) {
                    updatePayload['data.questions'] = update.data.data.questions;
                }
                batch.update(update.ref, updatePayload);
            }
            await batch.commit();
        }

        return res.status(200).json({ success: true, fixedCount: fixes.length });

    } catch (error) {
        console.error("Bulk fix failed:", error);
        return res.status(500).json({ error: "Bulk resolution failed" });
    }
});

// ============================================================================
// Endpoint 4: Clear Audit Data
// POST /api/admin/audit/clear
// ============================================================================
router.post('/clear', async (req, res) => {
    try {
        const { targets } = req.body;
        const db = getFirestore();
        if (!db) {
            return res.status(500).json({ error: "Firestore not initialized" });
        }

        if (!targets || !Array.isArray(targets) || targets.length === 0) {
            return res.status(400).json({ error: "No targets provided" });
        }

        const batch = db.batch();
        let count = 0;

        for (const target of targets) {
            const docRef = db.collection('fullExamPapers').doc(target.paperId);
            const doc = await docRef.get();
            
            const updates: any = {
                'audit': {
                    status: 'UNCHECKED',
                    lastRun: null,
                    suspects: []
                }
            };
            
            // Only attempt to delete legacy data.audit if the nested 'data' object actually exists
            // Otherwise, Firestore will crash the entire batch!
            if (doc.exists) {
                const docData = doc.data();
                if (docData && docData.data && docData.data.audit) {
                    updates['data.audit'] = admin.firestore.FieldValue.delete();
                }
            }
            
            batch.update(docRef, updates);
            
            count++;
            
            // Firestore batches max out at 500 operations
            if (count % 400 === 0) {
                await batch.commit();
            }
        }

        if (count % 400 !== 0) {
            await batch.commit();
        }

        res.json({ success: true, message: `Successfully cleared audit data for ${count} papers.` });
    } catch (error: any) {
        console.error("Audit Clear Error:", error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// Endpoint 5: Sweep Noise
// POST /api/admin/audit/sweep-noise
// ============================================================================
router.post('/sweep-noise', async (req, res) => {
    try {
        const db = getFirestore();
        if (!db) {
            return res.status(500).json({ error: "Firestore not initialized" });
        }

        const snapshot = await db.collection('fullExamPapers').where('audit.status', '==', 'SUSPECT').get();
        const batchArray: FirebaseFirestore.WriteBatch[] = [db.batch()];
        let operationCount = 0;
        let batchIndex = 0;

        snapshot.docs.forEach(doc => {
            const paperData = doc.data();
            if (!paperData.audit || !paperData.audit.suspects) return;
            
            let changed = false;

            // Change any PENDING suspect to IGNORED
            const updatedSuspects = paperData.audit.suspects.map((suspect: any) => {
                if (suspect.status === 'PENDING') {
                    suspect.status = 'IGNORED';
                    changed = true;
                }
                return suspect;
            });

            if (changed) {
                if (operationCount === 400) {
                    batchArray.push(db.batch());
                    batchIndex++;
                    operationCount = 0;
                }
                batchArray[batchIndex].update(doc.ref, {
                    'audit.suspects': updatedSuspects,
                    'audit.status': 'CLEAN' // The paper is now clean!
                });
                operationCount++;
            }
        });

        for (const b of batchArray) {
            await b.commit();
        }
        return res.status(200).json({ message: "All remaining noise swept to IGNORED cache." });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Sweep failed" });
    }
});

export default router;
