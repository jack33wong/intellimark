import { Request, Response, NextFunction } from 'express';
import { SubscriptionService } from '../services/subscriptionService.js';
import { isAdminUser } from '../config/firebase.js';

// Extend Express Request to include plan info
declare global {
    namespace Express {
        interface Request {
            userPlan?: 'free' | 'pro' | 'ultra' | 'admin_test';
        }
    }
}

/**
 * Middleware to fetch and attach user's subscription plan to the request
 * Must be used AFTER authenticateUser middleware
 */
export const attachUserPlan = async (req: Request, res: Response, next: NextFunction) => {
    try {
        if (!req.user || !req.user.uid) {
            // Not authenticated, fallback to free
            req.userPlan = 'free';
            return next();
        }

        const isAdmin = req.user.email ? isAdminUser(req.user.email) : false;
        const subscription = await SubscriptionService.getUserSubscription(req.user.uid);

        if (subscription && subscription.status === 'active') {
            req.userPlan = subscription.planId as 'free' | 'pro' | 'ultra' | 'admin_test';
        } else if (isAdmin) {
            req.userPlan = 'admin_test';
        } else {
            // Check if user has admin_test plan in userCredits
            const { getUserCredits } = await import('../services/creditService.js');
            const credits = await getUserCredits(req.user.uid);
            if (credits && credits.planId === 'admin_test') {
                req.userPlan = 'admin_test';
            } else {
                req.userPlan = 'free';
            }
        }

        console.log(`👤 [PLAN CHECK] User ${req.user.uid} is on plan: ${req.userPlan}`);
        next();
    } catch (error) {
        console.error('❌ Error attaching user plan:', error);
        // Fallback to free on error to be safe
        req.userPlan = 'free';
        next();
    }
};

/**
 * Middleware to restrict access to specific plans
 * @param allowedPlans Array of allowed plan IDs
 */
export const requirePlan = (allowedPlans: string[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        // Admin test plan has full access to all features
        if (req.userPlan === 'admin_test') {
            return next();
        }

        if (!req.userPlan || !allowedPlans.includes(req.userPlan)) {
            return res.status(403).json({
                error: 'Forbidden',
                message: `This feature requires one of the following plans: ${allowedPlans.join(', ')}. Current plan: ${req.userPlan}`
            });
        }
        next();
    };
};
