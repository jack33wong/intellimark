/**
 * Real Firebase Authentication Middleware
 * Verifies Firebase ID tokens for protected routes
 */

import type { Request, Response, NextFunction } from 'express';
import admin from 'firebase-admin';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize Firebase Admin if not already initialized
if (!admin.apps || admin.apps.length === 0) {
  try {
    const serviceAccountPath = join(__dirname, '..', 'intellimark-6649e-firebase-adminsdk-fbsvc-584c7c6d85.json');
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccountPath)
    });
    console.log('✅ Firebase Admin initialized successfully in middleware');
  } catch (error) {
    console.error('❌ Firebase Admin initialization failed in middleware:', error);
  }
}

// Types
interface AuthenticatedUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
}

interface CustomClaims {
  role?: string;
  admin?: boolean;
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

/**
 * Middleware to verify Firebase ID token
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const authenticateUser = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'No valid authorization header found' 
      });
    }

    const token = authHeader.split('Bearer ')[1];
    
    if (!token) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'No token provided' 
      });
    }

    // Verify Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(token);
    
    if (!decodedToken) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Invalid authentication token' 
      });
    }

    // Get user from Firebase
    const userRecord = await admin.auth().getUser(decodedToken.uid);
    
    req.user = {
      uid: userRecord.uid,
      email: userRecord.email || '',
      emailVerified: userRecord.emailVerified || false,
      name: userRecord.displayName || undefined,
      picture: userRecord.photoURL || undefined
    };

    console.log(`✅ User authenticated: ${req.user.email} (${req.user.uid})`);
    next();
    
  } catch (error: any) {
    console.error('❌ Real Firebase authentication error:', error);
    return res.status(401).json({ 
      error: 'Authentication Failed', 
      message: 'Invalid authentication token' 
    });
  }
};

/**
 * Optional authentication middleware (doesn't block if no token)
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split('Bearer ')[1];
      
      if (token) {
        // Verify Firebase ID token
        const decodedToken = await admin.auth().verifyIdToken(token);
        
        if (decodedToken) {
          // Get user from Firebase
          const userRecord = await admin.auth().getUser(decodedToken.uid);
          
          req.user = {
            uid: userRecord.uid,
            email: userRecord.email || '',
            emailVerified: userRecord.emailVerified || false,
            name: userRecord.displayName || undefined,
            picture: userRecord.photoURL || undefined
          };
        }
      }
    }
    
    next();
    
  } catch (error: any) {
    console.error('❌ Optional auth error:', error);
    // Don't block the request for optional auth errors
    next();
  }
};

/**
 * Admin-only middleware (temporary)
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const requireAdmin = async (req: Request, res: Response, next: NextFunction) => {
  try {
    // For development, allow all requests
    // In production, this would check Firebase custom claims
    console.log(`✅ Admin access granted (development mode)`);
    next();
  } catch (error) {
    console.error('❌ Admin check failed:', error);
    return res.status(403).json({ 
      error: 'Forbidden', 
      message: 'Admin access required' 
    });
  }
};
