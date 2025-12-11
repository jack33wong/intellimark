import express from 'express';
import { getUserCredits } from './services/creditService.js';

const app = express();

// Manually test the credits route
app.get('/api/credits/:userId', async (req, res) => {
    console.log('Route hit! userId:', req.params.userId);
    try {
        const { userId } = req.params;
        console.log('Calling getUserCredits...');

        const credits = await getUserCredits(userId);
        console.log('Credits result:', credits);

        if (!credits) {
            console.log('No credits found, returning 404');
            return res.status(404).json({
                error: 'Credits not initialized',
                message: 'Subscribe to a plan to get credits'
            });
        }

        res.json(credits);
    } catch (error) {
        console.error('ERROR in route:', error);
        res.status(500).json({ error: 'Failed to fetch credits', details: error.message });
    }
});

app.listen(5004, async () => {
    console.log('Test server on 5004');

    setTimeout(async () => {
        const response = await fetch('http://localhost:5004/api/credits/test123');
        console.log('Status:', response.status);
        console.log('Body:', await response.text());
        process.exit(0);
    }, 200);
});
