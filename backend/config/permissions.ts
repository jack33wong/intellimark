import dotenv from 'dotenv';

// Load environment variables from .env.local (Safe practice)
dotenv.config({ path: '.env.local' });

export const PERMISSIONS = {
    // Parsing comma-separated strings into arrays
    ANALYSIS_PLANS: process.env.PLAN_ANALYSIS ? process.env.PLAN_ANALYSIS.split(',') : ['pro', 'enterprise'],
    MODEL_SELECTION_PLANS: process.env.PLAN_MODEL_SELECTION ? process.env.PLAN_MODEL_SELECTION.split(',') : ['enterprise'],

    // Default fallback values used if env vars are missing
    DEFAULTS: {
        ANALYSIS: ['pro', 'enterprise'],
        MODEL_SELECTION: ['enterprise']
    }
};

export const hasPermission = (userPlan: string, allowedPlans: string[]): boolean => {
    return allowedPlans.includes(userPlan);
};

// Log loaded configuration for verification
console.log('✅ Permissions configuration loaded from .env.local:');
console.log(`   - Analysis Plans: ${PERMISSIONS.ANALYSIS_PLANS.join(', ')}`);
console.log(`   - Model Selection Plans: ${PERMISSIONS.MODEL_SELECTION_PLANS.join(', ')}`);
