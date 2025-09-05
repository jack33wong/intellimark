import * as express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { requireAdmin } from '../middleware/auth';
import { getFirestore } from '../config/firebase';
const router = express.Router();
router.use(requireAdmin);
const mockData = {
    fullExamPapers: [],
    questionBanks: [],
    markingSchemes: [],
    otherCollections: []
};
router.get('/json/collections/:collectionName', async (req, res) => {
    try {
        const { collectionName } = req.params;
        if (!collectionName) {
            return res.status(400).json({ error: 'Collection name is required' });
        }
        const db = getFirestore();
        if (db) {
            try {
                const snapshot = await db.collection(collectionName).get();
                const entries = [];
                snapshot.forEach(doc => {
                    const data = doc.data();
                    const entry = {
                        id: doc.id,
                        ...data,
                        uploadedAt: data.uploadedAt ?
                            (typeof data.uploadedAt === 'string' ? data.uploadedAt : data.uploadedAt.toDate().toISOString()) :
                            new Date().toISOString()
                    };
                    entries.push(entry);
                });
                res.json({
                    collectionName,
                    entries: entries
                });
            }
            catch (firestoreError) {
                console.error('Firestore fetch error:', firestoreError);
                const mockEntries = mockData[collectionName] || [];
                res.json({
                    collectionName,
                    entries: mockEntries
                });
            }
        }
        else {
            const mockEntries = mockData[collectionName] || [];
            res.json({
                collectionName,
                entries: mockEntries
            });
        }
    }
    catch (error) {
        console.error('Get collection error:', error);
        res.status(500).json({ error: `Failed to get collection: ${error.message}` });
    }
});
router.post('/json/collections/markingSchemes', async (req, res) => {
    try {
        const { markingSchemeData } = req.body;
        if (!markingSchemeData) {
            return res.status(400).json({ error: 'Marking scheme data is required' });
        }
        let parsedData;
        try {
            parsedData = typeof markingSchemeData === 'string' ? JSON.parse(markingSchemeData) : markingSchemeData;
        }
        catch (parseError) {
            return res.status(400).json({ error: 'Invalid JSON format in marking scheme data' });
        }
        const examDetails = parsedData.examDetails || {};
        const questions = parsedData.questions || {};
        const questionNumbers = Object.keys(questions).sort((a, b) => {
            const numA = parseInt(a);
            const numB = parseInt(b);
            if (!isNaN(numA) && !isNaN(numB)) {
                return numA - numB;
            }
            return a.localeCompare(b);
        });
        const totalQuestions = questionNumbers.length;
        const totalMarks = questionNumbers.reduce((total, qNum) => {
            const question = questions[qNum];
            if (question.marks && Array.isArray(question.marks)) {
                return total + question.marks.length;
            }
            return total;
        }, 0);
        const newEntry = {
            id: uuidv4(),
            markingSchemeData: parsedData,
            examDetails: {
                board: examDetails.board || 'Unknown',
                qualification: examDetails.qualification || 'Unknown',
                paperCode: examDetails.paperCode || 'Unknown',
                tier: examDetails.tier || 'Unknown',
                paper: examDetails.paper || 'Unknown',
                date: examDetails.date || 'Unknown'
            },
            totalQuestions,
            totalMarks,
            uploadedAt: new Date().toISOString(),
            createdAt: new Date().toISOString()
        };
        const db = getFirestore();
        if (db) {
            try {
                await db.collection('markingSchemes').doc(newEntry.id).set(newEntry);
                console.log(`Marking scheme saved to Firestore collection: markingSchemes`);
            }
            catch (firestoreError) {
                console.error('Firestore save error:', firestoreError);
            }
        }
        if (!mockData['markingSchemes']) {
            mockData['markingSchemes'] = [];
        }
        mockData['markingSchemes'].push(newEntry);
        res.status(201).json({
            message: 'Marking scheme uploaded successfully',
            collectionName: 'markingSchemes',
            entry: newEntry
        });
    }
    catch (error) {
        console.error('Marking scheme upload error:', error);
        res.status(500).json({ error: `Failed to upload marking scheme: ${error.message}` });
    }
});
router.post('/json/collections/:collectionName', async (req, res) => {
    try {
        const { collectionName } = req.params;
        const entryData = req.body;
        if (!collectionName) {
            return res.status(400).json({ error: 'Collection name is required' });
        }
        if (!entryData) {
            return res.status(400).json({ error: 'Entry data is required' });
        }
        const newEntry = {
            id: uuidv4(),
            ...entryData,
            uploadedAt: new Date().toISOString()
        };
        const db = getFirestore();
        if (db) {
            try {
                await db.collection(collectionName).doc(newEntry.id).set(newEntry);
                console.log(`Entry saved to Firestore collection: ${collectionName}`);
            }
            catch (firestoreError) {
                console.error('Firestore save error:', firestoreError);
            }
        }
        if (!mockData[collectionName]) {
            mockData[collectionName] = [];
        }
        mockData[collectionName].push(newEntry);
        res.status(201).json({
            message: 'Entry added successfully',
            collectionName,
            entry: newEntry
        });
    }
    catch (error) {
        console.error('Add entry error:', error);
        res.status(500).json({ error: `Failed to add entry: ${error.message}` });
    }
});
router.delete('/json/collections/:collectionName/:entryId', async (req, res) => {
    try {
        const { collectionName, entryId } = req.params;
        const db = getFirestore();
        if (db) {
            try {
                await db.collection(collectionName).doc(entryId).delete();
                console.log(`Entry ${entryId} deleted from Firestore collection: ${collectionName}`);
            }
            catch (firestoreError) {
                console.error('Firestore delete error:', firestoreError);
            }
        }
        if (mockData[collectionName]) {
            const index = mockData[collectionName].findIndex(entry => entry.id === entryId);
            if (index !== -1) {
                mockData[collectionName].splice(index, 1);
                console.log(`Entry ${entryId} deleted from mock data collection: ${collectionName}`);
            }
        }
        res.json({
            message: `Entry deleted successfully`,
            collectionName,
            entryId,
            deleted: true
        });
    }
    catch (error) {
        console.error('Delete entry error:', error);
        res.status(500).json({ error: `Failed to delete entry: ${error.message}` });
    }
});
router.delete('/json/collections/:collectionName/clear-all', async (req, res) => {
    try {
        const { collectionName } = req.params;
        const db = getFirestore();
        if (db) {
            try {
                const snapshot = await db.collection(collectionName).get();
                const deletePromises = [];
                snapshot.forEach((doc) => {
                    deletePromises.push(doc.ref.delete());
                });
                await Promise.all(deletePromises);
                console.log(`All entries deleted from Firestore collection: ${collectionName}`);
            }
            catch (firestoreError) {
                console.error('Firestore delete error:', firestoreError);
            }
        }
        const deletedCount = mockData[collectionName] ? mockData[collectionName].length : 0;
        if (mockData[collectionName]) {
            mockData[collectionName].length = 0;
        }
        res.json({
            message: `All entries deleted from collection: ${collectionName}`,
            collectionName,
            deletedCount
        });
    }
    catch (error) {
        console.error('Delete collection error:', error);
        res.status(500).json({ error: `Failed to delete collection: ${error.message}` });
    }
});
router.post('/json/upload', async (req, res) => {
    try {
        const { data } = req.body;
        if (!data) {
            return res.status(400).json({ error: 'JSON data is required' });
        }
        const newEntry = {
            id: uuidv4(),
            ...data,
            uploadedAt: new Date().toISOString()
        };
        const db = getFirestore();
        if (db) {
            try {
                await db.collection('fullExamPapers').doc(newEntry.id).set(newEntry);
                console.log(`Entry saved to Firestore collection: fullExamPapers`);
            }
            catch (firestoreError) {
                console.error('Firestore save error:', firestoreError);
            }
        }
        if (!mockData['fullExamPapers']) {
            mockData['fullExamPapers'] = [];
        }
        mockData['fullExamPapers'].push(newEntry);
        res.status(201).json({
            message: 'JSON uploaded successfully to fullExamPapers collection',
            entry: newEntry
        });
    }
    catch (error) {
        console.error('JSON upload error:', error);
        res.status(500).json({ error: `Failed to upload JSON: ${error.message}` });
    }
});
export default router;
