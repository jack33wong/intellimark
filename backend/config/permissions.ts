import dotenv from 'dotenv';

// Load environment variables from .env.local (Safe practice)
dotenv.config({ path: '.env.local' });

export const PERMISSIONS = {
    // Parsing comma-separated strings into arrays
    ANALYSIS_PLANS: process.env.PLAN_ANALYSIS ? process.env.PLAN_ANALYSIS.split(',') : ['pro', 'ultra'],
    MODEL_SELECTION_PLANS: process.env.PLAN_MODEL_SELECTION ? process.env.PLAN_MODEL_SELECTION.split(',') : ['pro', 'ultra'],

    // Default fallback values used if env vars are missing
    DEFAULTS: {
        ANALYSIS: ['pro', 'ultra'],
        MODEL_SELECTION: ['pro', 'ultra']
    }
};

export const hasPermission = (userPlan: string, allowedPlans: string[]): boolean => {
    return allowedPlans.includes(userPlan);
};

