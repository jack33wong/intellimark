import { getFirestore } from '../config/firebase.js';
export class QuestionDetectionService {
    constructor() {
        this.db = getFirestore();
    }
    static getInstance() {
        if (!QuestionDetectionService.instance) {
            QuestionDetectionService.instance = new QuestionDetectionService();
        }
        return QuestionDetectionService.instance;
    }
    async detectQuestion(extractedQuestionText) {
        try {
            if (!extractedQuestionText || extractedQuestionText.trim().length === 0) {
                return {
                    found: false,
                    message: 'No question text provided'
                };
            }
            const examPapers = await this.getAllExamPapers();
            if (examPapers.length === 0) {
                return {
                    found: false,
                    message: 'No exam papers found in database'
                };
            }
            let bestMatch = null;
            let bestScore = 0;
            for (const examPaper of examPapers) {
                const match = await this.matchQuestionWithExamPaper(extractedQuestionText, examPaper);
                if (match && match.confidence && match.confidence > bestScore) {
                    bestMatch = match;
                    bestScore = match.confidence;
                }
            }
            if (bestMatch && bestScore > 0.1) {
                const markingScheme = await this.findCorrespondingMarkingScheme(bestMatch);
                if (markingScheme) {
                    bestMatch.markingScheme = markingScheme;
                }
                return {
                    found: true,
                    match: bestMatch,
                    message: `Matched with ${bestMatch.board} ${bestMatch.qualification} - ${bestMatch.paperCode} (${bestMatch.year})`
                };
            }
            console.log('❌ No suitable exam paper match found');
            return {
                found: false,
                message: 'No matching exam paper found'
            };
        }
        catch (error) {
            console.error('❌ Error in question detection:', error);
            return {
                found: false,
                message: `Detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }
    async getAllExamPapers() {
        try {
            if (!this.db) {
                console.log('⚠️ Firestore not available, using empty array');
                return [];
            }
            const snapshot = await this.db.collection('fullExamPapers').get();
            const examPapers = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                examPapers.push({
                    id: doc.id,
                    ...data
                });
            });
            return examPapers;
        }
        catch (error) {
            console.error('❌ Error fetching exam papers:', error);
            return [];
        }
    }
    async matchQuestionWithExamPaper(questionText, examPaper) {
        try {
            const questions = examPaper.questions || {};
            let bestQuestionMatch = null;
            let bestScore = 0;
            if (Array.isArray(questions)) {
                for (const question of questions) {
                    const questionNumber = question.question_number || question.number;
                    const questionContent = question.question_text || question.text || question.question || '';
                    if (questionContent && questionNumber) {
                        const similarity = this.calculateSimilarity(questionText, questionContent);
                        if (similarity > bestScore) {
                            bestScore = similarity;
                            bestQuestionMatch = questionNumber;
                        }
                    }
                }
            }
            else {
                for (const [questionNumber, questionData] of Object.entries(questions)) {
                    const questionContent = questionData.text || questionData.question || '';
                    if (questionContent) {
                        const similarity = this.calculateSimilarity(questionText, questionContent);
                        if (similarity > bestScore) {
                            bestScore = similarity;
                            bestQuestionMatch = questionNumber;
                        }
                    }
                }
            }
            if (bestQuestionMatch && bestScore > 0.3) {
                const metadata = examPaper.metadata || {};
                const board = metadata.exam_board || examPaper.board || 'Unknown';
                const qualification = metadata.subject || examPaper.qualification || 'Unknown';
                const paperCode = metadata.exam_code || examPaper.paperCode || 'Unknown';
                const year = metadata.year || examPaper.year || 'Unknown';
                return {
                    board: board,
                    qualification: qualification,
                    paperCode: paperCode,
                    year: year,
                    questionNumber: bestQuestionMatch,
                    confidence: bestScore
                };
            }
            return null;
        }
        catch (error) {
            console.error('❌ Error matching question with exam paper:', error);
            return null;
        }
    }
    async findCorrespondingMarkingScheme(examPaperMatch) {
        try {
            if (!this.db) {
                return null;
            }
            const snapshot = await this.db.collection('markingSchemes').get();
            const markingSchemes = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                markingSchemes.push({
                    id: doc.id,
                    ...data
                });
            });
            for (const markingScheme of markingSchemes) {
                const match = this.matchMarkingSchemeWithExamPaper(examPaperMatch, markingScheme);
                if (match) {
                    return match;
                }
            }
            return null;
        }
        catch (error) {
            console.error('❌ Error finding marking scheme:', error);
            return null;
        }
    }
    matchMarkingSchemeWithExamPaper(examPaperMatch, markingScheme) {
        try {
            const examDetails = markingScheme.examDetails || markingScheme.markingSchemeData?.examDetails || {};
            const boardMatch = this.calculateSimilarity(examPaperMatch.board, examDetails.board || '');
            const qualificationMatch = this.calculateSimilarity(examPaperMatch.qualification, examDetails.qualification || '');
            const paperCodeMatch = this.calculateSimilarity(examPaperMatch.paperCode, examDetails.paperCode || '');
            const yearMatch = this.calculateSimilarity(examPaperMatch.year, examDetails.date || examDetails.year || '');
            const overallScore = (boardMatch + qualificationMatch + paperCodeMatch + yearMatch) / 4;
            if (overallScore > 0.7) {
                let questionMarks = null;
                if (examPaperMatch.questionNumber && markingScheme.markingSchemeData?.questions) {
                    const questions = markingScheme.markingSchemeData.questions;
                    questionMarks = questions[examPaperMatch.questionNumber] || null;
                }
                return {
                    id: markingScheme.id,
                    examDetails: {
                        board: examDetails.board || 'Unknown',
                        qualification: examDetails.qualification || 'Unknown',
                        paperCode: examDetails.paperCode || 'Unknown',
                        tier: examDetails.tier || 'Unknown',
                        paper: examDetails.paper || 'Unknown',
                        date: examDetails.date || 'Unknown'
                    },
                    questionMarks: questionMarks,
                    totalQuestions: markingScheme.totalQuestions || 0,
                    totalMarks: markingScheme.totalMarks || 0,
                    confidence: overallScore
                };
            }
            return null;
        }
        catch (error) {
            console.error('❌ Error matching marking scheme:', error);
            return null;
        }
    }
    calculateSimilarity(str1, str2) {
        if (!str1 || !str2)
            return 0;
        const normalize = (str) => str.toLowerCase()
            .replace(/[^\w\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        const norm1 = normalize(str1);
        const norm2 = normalize(str2);
        if (norm1 === norm2)
            return 1.0;
        const words1 = norm1.split(' ');
        const words2 = norm2.split(' ');
        let commonWords = 0;
        const totalWords = Math.max(words1.length, words2.length);
        for (const word1 of words1) {
            for (const word2 of words2) {
                if (word1 === word2) {
                    commonWords++;
                    break;
                }
            }
        }
        const wordSimilarity = commonWords / totalWords;
        const partialMatch = norm1.includes(norm2) || norm2.includes(norm1);
        const partialScore = partialMatch ? 0.5 : 0;
        return Math.max(wordSimilarity, partialScore);
    }
}
export const questionDetectionService = QuestionDetectionService.getInstance();
