/**
 * Real Firebase Authentication Routes
 * Handles real authentication with Firebase Admin SDK
 */

import express from 'express';
import type { Request, Response } from 'express';
import { authenticateUser } from '../middleware/auth';
import { getFirebaseAuth, getUserRole, isFirebaseAvailable } from '../config/firebase';

const router = express.Router();

// Types
interface User {
  uid: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  picture?: string;
  role?: string;
}

interface SocialLoginRequest {
  idToken: string;
  provider: 'google' | 'facebook';
}

interface ProfileUpdateRequest {
  displayName?: string;
  photoURL?: string;
}

interface CustomClaims {
  role?: string;
  admin?: boolean;
}

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/**
 * GET /auth/providers
 * Get available authentication providers
 */
router.get('/providers', (_req: Request, res: Response) => {
  res.json({
    providers: [
      {
        id: 'google',
        name: 'Google',
        enabled: true
      },
      {
        id: 'facebook',
        name: 'Facebook',
        enabled: true
      }
    ]
  });
});

/**
 * POST /auth/social-login
 * Handle real social media login with Firebase
 */
router.post('/social-login', async (req: Request, res: Response) => {
  try {
    const { idToken, provider }: SocialLoginRequest = req.body;
    
    if (!idToken || !provider) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'ID token and provider are required'
      });
    }
    
    if (!['google', 'facebook'].includes(provider)) {
      return res.status(400).json({
        error: 'Invalid provider',
        message: 'Only Google and Facebook are supported'
      });
    }
    
    // Check if Firebase is available
    if (!isFirebaseAvailable()) {
      console.warn('⚠️ Firebase not available, using mock authentication for development');
      
      // Mock user for development
      const mockUser: User = {
        uid: 'mock-user-id',
        email: 'mock@example.com',
        emailVerified: true,
        name: 'Mock User',
        picture: undefined,
        role: 'admin'
      };
      
      console.log(`✅ Mock login successful: ${mockUser.email} via ${provider} (role: ${mockUser.role})`);
      
      res.json({
        success: true,
        user: mockUser,
        message: 'Mock login successful (development mode)'
      });
      return;
    }
    
    // Verify Firebase ID token
    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth) {
      throw new Error('Firebase Auth not available');
    }

    const decodedToken = await firebaseAuth.verifyIdToken(idToken);
    
    if (!decodedToken) {
      return res.status(401).json({
        error: 'Invalid token',
        message: 'Failed to verify authentication token'
      });
    }
    
    // Get user from Firebase
    const userRecord = await firebaseAuth.getUser(decodedToken.uid);
    
    const user: User = {
      uid: userRecord.uid,
      email: userRecord.email || '',
      emailVerified: userRecord.emailVerified || false,
      name: userRecord.displayName || undefined,
      picture: userRecord.photoURL || undefined,
      role: getUserRole(userRecord.email || '')
    };
    
    console.log(`✅ Real Firebase login successful: ${user.email} via ${provider} (role: ${user.role})`);
    
    res.json({
      success: true,
      user,
      message: 'Login successful'
    });
    
  } catch (error: any) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      error: 'Login Failed',
      message: 'An error occurred during authentication'
    });
  }
});

/**
 * GET /auth/profile
 * Get current user profile (requires authentication)
 */
router.get('/profile', authenticateUser, (req: Request, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User not authenticated'
      });
    }
    
    // Ensure the user object has a role property
    const userWithRole: User = {
      ...req.user,
      role: req.user.role || getUserRole(req.user.email)
    };
    
    res.json({
      success: true,
      user: userWithRole
    });
    
  } catch (error: any) {
    console.error('❌ Profile fetch error:', error);
    res.status(500).json({
      error: 'Profile Fetch Failed',
      message: 'An error occurred while fetching profile'
    });
  }
});

/**
 * PUT /auth/profile
 * Update user profile with real Firebase
 */
router.put('/profile', authenticateUser, async (req: Request, res: Response) => {
  try {
    const { displayName, photoURL }: ProfileUpdateRequest = req.body;
    
    if (!req.user) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'User not authenticated'
      });
    }
    
    // Check if Firebase is available
    if (!isFirebaseAvailable()) {
      console.warn('⚠️ Firebase not available, using mock profile update for development');
      
      const updatedUser: User = {
        ...req.user,
        name: displayName || req.user.name,
        role: getUserRole(req.user.email)
      };
      
      console.log(`✅ Mock profile updated for: ${updatedUser.email} (role: ${updatedUser.role})`);
      
      res.json({
        success: true,
        user: updatedUser,
        message: 'Profile updated successfully (development mode)'
      });
      return;
    }
    
    // Update Firebase user profile
    const firebaseAuth = getFirebaseAuth();
    if (!firebaseAuth) {
      throw new Error('Firebase Auth not available');
    }

    await firebaseAuth.updateUser(req.user.uid, {
      displayName: displayName || req.user.name,
      photoURL: photoURL || req.user.picture
    });
    
    // Get updated user record
    const updatedUserRecord = await firebaseAuth.getUser(req.user.uid);
    
    const updatedUser: User = {
      uid: updatedUserRecord.uid,
      email: updatedUserRecord.email || '',
      emailVerified: updatedUserRecord.emailVerified || false,
      name: updatedUserRecord.displayName || undefined,
      picture: updatedUserRecord.photoURL || undefined,
      role: getUserRole(updatedUserRecord.email || '')
    };
    
    console.log(`✅ Real Firebase profile updated for: ${updatedUser.email} (role: ${updatedUser.role})`);
    
    res.json({
      success: true,
      user: updatedUser,
      message: 'Profile updated successfully'
    });
    
  } catch (error: any) {
    console.error('❌ Profile update error:', error);
    res.status(500).json({
      error: 'Profile Update Failed',
      message: 'An error occurred while updating profile'
    });
  }
});

/**
 * POST /auth/logout
 * Logout user (client-side token cleanup)
 */
router.post('/logout', (req: Request, res: Response) => {
  try {
    // In production, this might invalidate Firebase tokens
    // For now, just return success (client handles token cleanup)
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
    
  } catch (error: any) {
    console.error('❌ Logout error:', error);
    res.status(500).json({
      error: 'Logout Failed',
      message: 'An error occurred during logout'
    });
  }
});

export default router;
