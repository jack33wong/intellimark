import dotenv from 'dotenv';

// Load environment variables from .env.local (Safe practice)
dotenv.config({ path: '.env.local' });

const parsePlans = (envVar?: string, defaults: string[] = ['pro', 'ultra', 'admin_test']): string[] => {
    const plans = envVar ? envVar.split(',').map(p => p.trim()) : defaults;
    if (!plans.includes('admin_test')) {
        plans.push('admin_test');
    }
    return plans;
};

export const PERMISSIONS = {
    // Parsing comma-separated strings into arrays (always including admin_test)
    ANALYSIS_PLANS: parsePlans(process.env.PLAN_ANALYSIS, ['pro', 'ultra', 'admin_test']),
    MODEL_SELECTION_PLANS: parsePlans(process.env.PLAN_MODEL_SELECTION, ['pro', 'ultra', 'admin_test']),

    // Default fallback values used if env vars are missing
    DEFAULTS: {
        ANALYSIS: ['pro', 'ultra', 'admin_test'],
        MODEL_SELECTION: ['pro', 'ultra', 'admin_test']
    }
};

export const hasPermission = (userPlan: string, allowedPlans: string[]): boolean => {
    if (userPlan === 'admin_test') return true;
    return allowedPlans.includes(userPlan);
};

