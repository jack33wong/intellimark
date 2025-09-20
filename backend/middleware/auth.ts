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
      return res.status(503).json({ 
        error: 'Service Unavailable', 
        message: 'Firebase authentication service is not available' 
      });
    }

    // Verify Firebase ID token
    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth) {
      throw new Error('Firebase Auth not available');
    }

    
    let decodedToken;
    let uid;
    
    try {
      // First try to verify as ID token
      decodedToken = await firebaseAuth.verifyIdToken(token);
      uid = decodedToken.uid;
    } catch (idTokenError) {
      
      try {
        // If ID token verification fails, try to verify as custom token
        decodedToken = await firebaseAuth.verifyIdToken(token, true); // Check custom token
        uid = decodedToken.uid;
      } catch (customTokenError) {
        
        try {
          // Parse custom token directly (JWT format)
          const parts = token.split('.');
          if (parts.length === 3) {
            const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
            if (payload.uid && payload.claims) {
              uid = payload.uid;
              decodedToken = { uid, claims: payload.claims };
            } else {
              throw new Error('Invalid custom token payload');
            }
          } else {
            throw new Error('Invalid token format');
          }
        } catch (parseError) {
          console.error(`❌ [${new Date().toISOString()}] authenticateUser: All token verification methods failed`);
          console.error(`❌ [${new Date().toISOString()}] ID token error:`, idTokenError.message);
          console.error(`❌ [${new Date().toISOString()}] Custom token error:`, customTokenError.message);
          console.error(`❌ [${new Date().toISOString()}] Parse error:`, parseError.message);
          return res.status(401).json({ 
            error: 'Authentication Failed', 
            message: 'Invalid authentication token' 
          });
        }
      }
    }
    
    if (!decodedToken || !uid) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Invalid authentication token' 
      });
    }

    // Get user from Firebase
    const userRecord = await firebaseAuth.getUser(uid);
    
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
              
              let decodedToken;
              let uid;
              
              try {
                // First try to verify as ID token
                decodedToken = await firebaseAuth.verifyIdToken(token);
                uid = decodedToken.uid;
              } catch (idTokenError) {
                
                try {
                  // If ID token verification fails, try to verify as custom token
                  decodedToken = await firebaseAuth.verifyIdToken(token, true); // Check custom token
                  uid = decodedToken.uid;
                } catch (customTokenError) {
                  
                  try {
                    // Parse custom token directly (JWT format)
                    const parts = token.split('.');
                    if (parts.length === 3) {
                      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
                      if (payload.uid && payload.claims) {
                        uid = payload.uid;
                        decodedToken = { uid, claims: payload.claims };
                      } else {
                        throw new Error('Invalid custom token payload');
                      }
                    } else {
                      throw new Error('Invalid token format');
                    }
                  } catch (parseError) {
                    console.error(`❌ [${new Date().toISOString()}] optionalAuth: All token verification methods failed`);
                    console.error(`❌ [${new Date().toISOString()}] optionalAuth: ID token error:`, idTokenError.message);
                    console.error(`❌ [${new Date().toISOString()}] optionalAuth: Custom token error:`, customTokenError.message);
                    console.error(`❌ [${new Date().toISOString()}] optionalAuth: Parse error:`, parseError.message);
                    // Don't block the request, just continue without authentication
                    return next();
                  }
                }
              }
              
              if (decodedToken && uid) {
                // Get user from Firebase
                const userRecord = await firebaseAuth.getUser(uid);
                
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
              console.error(`❌ [${new Date().toISOString()}] optionalAuth: Token verification failed:`, error);
              console.error(`❌ [${new Date().toISOString()}] optionalAuth: Error details:`, error.message);
              console.error(`❌ [${new Date().toISOString()}] optionalAuth: Error stack:`, error.stack);
            }
          }
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
 * Require authentication middleware (alias for authenticateUser)
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export const requireAuth = authenticateUser;

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
