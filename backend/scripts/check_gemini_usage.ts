/**
 * Check Gemini API Usage from Google Cloud Monitoring
 * Fetches actual API request count from Google Cloud Console
 */

import { GoogleAuth } from 'google-auth-library';
import fetch from 'node-fetch';
import { join } from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function checkGeminiUsage(targetDate?: string) {
    try {
        // Try multiple possible paths for the service account file
        const possiblePaths = [
            process.env.GOOGLE_APPLICATION_CREDENTIALS,
            join(process.cwd(), 'backend', 'ai-marking-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json'),
            join(process.cwd(), 'ai-marking-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json'),
            join(__dirname, '..', 'ai-marking-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json'),
            join(__dirname, 'ai-marking-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json')
        ].filter(Boolean) as string[];

        // Find the first path that exists
        const keyFile = possiblePaths.find(path => existsSync(path));

        if (!keyFile) {
            console.error('❌ Service account file not found in any of these locations:');
            possiblePaths.forEach(p => console.error(`   - ${p}`));
            process.exit(1);
        }

        console.log(`\n🔍 Checking Gemini API Usage`);
        console.log(`📁 Using key file: ${keyFile}`);

        // Initialize Google Auth
        const auth = new GoogleAuth({
            keyFile,
            scopes: ['https://www.googleapis.com/auth/cloud-platform']
        });

        const client = await auth.getClient();
        const projectId = await auth.getProjectId();

        console.log(`📊 Project ID: ${projectId}`);

        // Calculate date range (yesterday if no date specified)
        const now = new Date();
        let startDate: Date;
        let endDate: Date;

        if (targetDate) {
            // Parse target date (format: YYYY-MM-DD)
            startDate = new Date(targetDate);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(targetDate);
            endDate.setHours(23, 59, 59, 999);
        } else {
            // Yesterday
            startDate = new Date(now);
            startDate.setDate(startDate.getDate() - 1);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date(now);
            endDate.setHours(0, 0, 0, 0);
        }

        console.log(`📅 Date Range: ${startDate.toISOString()} to ${endDate.toISOString()}`);

        // Get access token
        const accessToken = await client.getAccessToken();
        if (!accessToken.token) {
            throw new Error('Failed to get access token');
        }


        // Query Cloud Monitoring API using GET request with query parameters
        // Metric: generativelanguage.googleapis.com/request_count
        const metricType = 'generativelanguage.googleapis.com/request_count';
        const filter = `metric.type="${metricType}"`;

        const params = new URLSearchParams({
            'filter': filter,
            'interval.startTime': startDate.toISOString(),
            'interval.endTime': endDate.toISOString(),
            'aggregation.alignmentPeriod': '86400s',
            'aggregation.perSeriesAligner': 'ALIGN_SUM',
            'aggregation.crossSeriesReducer': 'REDUCE_SUM'
        });

        const url = `https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?${params.toString()}`;

        console.log(`\n🌐 Querying Monitoring API...`);
        console.log(`📊 Metric: ${metricType}`);

        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${accessToken.token}`
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Monitoring API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json() as any;

        // Parse results
        if (!data.timeSeries || data.timeSeries.length === 0) {
            console.log(`\n⚠️  No usage data found for this period.`);
            console.log(`   This could mean:`);
            console.log(`   - No API calls were made`);
            console.log(`   - Monitoring API needs time to aggregate data (wait a few hours)`);
            console.log(`   - The service account needs "Monitoring Viewer" role`);
            return;
        }

        // Sum up all request counts
        let totalRequests = 0;
        data.timeSeries.forEach((series: any) => {
            series.points?.forEach((point: any) => {
                const value = point.value?.int64Value || point.value?.doubleValue || 0;
                totalRequests += Number(value);
            });
        });

        console.log(`\n✅ Results:`);
        console.log(`   Total API Requests: ${totalRequests}`);
        console.log(`   Date: ${targetDate || 'Yesterday'}`);

        // Estimate cost (rough)
        // Gemini 2.0 Flash: $0.075 per 1M input tokens, $0.30 per 1M output tokens
        // Assume avg 1000 tokens per request (500 input + 500 output)
        const avgInputTokens = 500;
        const avgOutputTokens = 500;
        const inputCostPer1M = 0.075;
        const outputCostPer1M = 0.30;

        const estimatedInputCost = (totalRequests * avgInputTokens / 1_000_000) * inputCostPer1M;
        const estimatedOutputCost = (totalRequests * avgOutputTokens / 1_000_000) * outputCostPer1M;
        const estimatedTotalCost = estimatedInputCost + estimatedOutputCost;

        console.log(`\n💰 Rough Cost Estimate (Gemini 2.0 Flash):`);
        console.log(`   Assuming ~${avgInputTokens + avgOutputTokens} tokens/request (${avgInputTokens} input + ${avgOutputTokens} output)`);
        console.log(`   Estimated Cost: $${estimatedTotalCost.toFixed(4)}`);
        console.log(`   (This is a rough estimate. Actual cost depends on token usage)`);

    } catch (error) {
        console.error('\n❌ Error:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

// Parse command line arguments
const targetDate = process.argv[2]; // Optional: YYYY-MM-DD
checkGeminiUsage(targetDate);
