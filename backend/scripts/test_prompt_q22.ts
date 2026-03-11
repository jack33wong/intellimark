import { getPrompt } from '../config/prompts.js';
import { ModelProvider } from '../utils/ModelProvider.js';
import { initializeApp, cert } from 'firebase-admin/app';
import path from 'path';
import { config } from 'dotenv';
config({ path: path.resolve(__dirname, '../../.env') });
import serviceAccount from '../secrets/service-account.json';

const app = initializeApp({
    credential: cert(serviceAccount as any),
    projectId: process.env.FIREBASE_PROJECT_ID
});

async function run() {
    const qText = `This graph shows part of a straight line.
[Graph: Straight line passing through (0, 3) and (1.5, 0). x-axis from -2 to 4, y-axis from -6 to 8.]

a) Write down the y-intercept.
b) Show that the gradient of the line is -2.
c) Write down the equation of the line.
d) The line continues to the right. Will this line pass through the point (50, -103)? Show how you decide.`;

    const qScheme = `
[a] [MAX SCORE: 1]
- B1: 3

[b] [MAX SCORE: 1]
- M1: clear attempt to use gradient = rise/run, eg -3/1.5

[c] [MAX SCORE: 1]
- B1: y = -2x + 3

[d] [MAX SCORE: 2]
- M1: Substitution of x = 50 into their equation from (c)
- A1: 50 * -2 + 3 = -97, which is not -103 AND concludes "NO"
`;

    const sys = getPrompt('markingScheme.system');
    const user = getPrompt('markingScheme.user', qText, qScheme, "22", 5);

    try {
        const res = await ModelProvider.callText(sys, user, 'gemini-2.0-flash' as any);
        console.log("=== AI RESPONSE ===");
        console.log(res.content);
    } catch (e) {
        console.error(e);
    }
}
run();
