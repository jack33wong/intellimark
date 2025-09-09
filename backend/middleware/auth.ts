/**
 * Real Firebase Authentication Middleware
 * Verifies Firebase ID tokens for protected routes
 */

import type { Request, Response, NextFunction } from 'express';
import { getFirebaseAuth, getUserRole, isFirebaseAvailable } from '../config/firebase';

// Types
interface AuthenticatedUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
  role?: string;
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

    // Check if Firebase is available
    if (!isFirebaseAvailable()) {
      console.warn('⚠️ Firebase not available, using mock authentication for development');
      
      // Mock authentication for development
      req.user = {
        uid: 'mock-user-id',
        email: 'mock@example.com',
        emailVerified: true,
        name: 'Mock User',
        picture: undefined,
        role: 'admin' // Default to admin in mock mode
      };
      
      next();
      return;
    }

    // Verify Firebase ID token
    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth) {
      throw new Error('Firebase Auth not available');
    }

    const decodedToken = await firebaseAuth.verifyIdToken(token);
    
    if (!decodedToken) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Invalid authentication token' 
      });
    }

    // Get user from Firebase
    const userRecord = await firebaseAuth.getUser(decodedToken.uid);
    
    req.user = {
      uid: userRecord.uid,
      email: userRecord.email || '',
      emailVerified: userRecord.emailVerified || false,
      name: userRecord.displayName || undefined,
      picture: userRecord.photoURL || undefined,
      role: getUserRole(userRecord.email || '')
    };

    next();
    
  } catch (error: any) {
    console.error('❌ Authentication error:', error);
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
        // Check if Firebase is available
        if (isFirebaseAvailable()) {
          const firebaseAuth = getFirebaseAuth();
          if (firebaseAuth) {
            try {
              // Verify Firebase ID token
              const decodedToken = await firebaseAuth.verifyIdToken(token);
              
              if (decodedToken) {
                // Get user from Firebase
                const userRecord = await firebaseAuth.getUser(decodedToken.uid);
                
                req.user = {
                  uid: userRecord.uid,
                  email: userRecord.email || '',
                  emailVerified: userRecord.emailVerified || false,
                  name: userRecord.displayName || undefined,
                  picture: userRecord.photoURL || undefined,
                  role: getUserRole(userRecord.email || '')
                };
              }
            } catch (error) {
              console.warn('Optional auth token verification failed:', error);
            }
          }
        } else {
          // Mock user for development
          req.user = {
            uid: 'mock-user-id',
            email: 'mock@example.com',
            emailVerified: true,
            name: 'Mock User',
            picture: undefined,
            role: 'admin'
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
    next();
  } catch (error) {
    console.error('❌ Admin check failed:', error);
    return res.status(403).json({ 
      error: 'Forbidden', 
      message: 'Admin access required' 
    });
  }
};
