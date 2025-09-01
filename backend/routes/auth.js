/**
 * Authentication Routes
 * Handles social media login (Google, Facebook) and profile management
 */

const express = require('express');
const admin = require('firebase-admin');
const { authenticateUser } = require('../middleware/auth');

const router = express.Router();

/**
 * POST /auth/social-login
 * Handle social media login (Google, Facebook)
 */
router.post('/social-login', async (req, res) => {
  try {
    const { idToken, provider } = req.body;
    
    if (!idToken || !provider) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'ID token and provider are required'
      });
    }

    if (!['google', 'facebook'].includes(provider)) {
      return res.status(400).json({
        error: 'Unsupported provider',
        message: 'Only Google and Facebook are supported'
      });
    }

    // Verify the Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // Check if user exists, if not create them
    let userRecord;
    try {
      userRecord = await admin.auth().getUser(decodedToken.uid);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        // Create new user from social login
        userRecord = await admin.auth().createUser({
          uid: decodedToken.uid,
          email: decodedToken.email,
          displayName: decodedToken.name || decodedToken.email.split('@')[0],
          emailVerified: decodedToken.email_verified || false,
          photoURL: decodedToken.picture || null
        });

        // Set custom claims
        await admin.auth().setCustomUserClaims(userRecord.uid, {
          role: 'user',
          provider: provider,
          createdAt: Date.now()
        });
      } else {
        throw error;
      }
    }

    console.log(`✅ Social login successful: ${userRecord.email} via ${provider}`);

    res.json({
      message: 'Social login successful',
      user: {
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName,
        emailVerified: userRecord.emailVerified,
        photoURL: userRecord.photoURL,
        provider: provider
      }
    });

  } catch (error) {
    console.error('❌ Social login error:', error);
    res.status(500).json({
      error: 'Social login failed',
      message: 'Authentication failed'
    });
  }
});

/**
 * GET /auth/providers
 * Get supported authentication providers
 */
router.get('/providers', (_req, res) => {
  try {
    const providers = {
      supported: ['google', 'facebook'],
      google: {
        name: 'Google',
        icon: '🔍',
        description: 'Sign in with your Google account'
      },
      facebook: {
        name: 'Facebook',
        icon: '📘',
        description: 'Sign in with your Facebook account'
      }
    };
    
    res.json(providers);
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to get providers',
      message: 'Server error' 
    });
  }
});

/**
 * GET /auth/profile
 * Get current user profile (requires authentication)
 */
router.get('/profile', authenticateUser, async (req, res) => {
  try {
    const { uid } = req.user;
    
    // Get user record from Firebase
    const userRecord = await admin.auth().getUser(uid);
    const customClaims = userRecord.customClaims || {};
    
    res.json({
      user: {
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName,
        emailVerified: userRecord.emailVerified,
        photoURL: userRecord.photoURL,
        role: customClaims.role || 'user',
        createdAt: customClaims.createdAt || null
      }
    });

  } catch (error) {
    console.error('❌ Profile fetch error:', error);
    res.status(500).json({
      error: 'Profile fetch failed',
      message: 'Failed to retrieve user profile'
    });
  }
});

/**
 * PUT /auth/profile
 * Update user profile (requires authentication)
 */
router.put('/profile', authenticateUser, async (req, res) => {
  try {
    const { uid } = req.user;
    const { displayName, photoURL } = req.body;
    
    const updateData = {};
    if (displayName !== undefined) updateData.displayName = displayName;
    if (photoURL !== undefined) updateData.photoURL = photoURL;
    
    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({
        error: 'No updates provided',
        message: 'Please provide fields to update'
      });
    }
    
    // Update user in Firebase
    await admin.auth().updateUser(uid, updateData);
    
    console.log(`✅ Profile updated: ${uid}`);
    
    res.json({
      message: 'Profile updated successfully',
      updates: updateData
    });

  } catch (error) {
    console.error('❌ Profile update error:', error);
    res.status(500).json({
      error: 'Profile update failed',
      message: 'Failed to update user profile'
    });
  }
});

/**
 * POST /auth/admin/set-role
 * Set user role (admin only)
 */
router.post('/admin/set-role', authenticateUser, async (req, res) => {
  try {
    const { uid, role } = req.body;
    
    if (!uid || !role) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'User ID and role are required'
      });
    }
    
    // Check if current user is admin
    const currentUserRecord = await admin.auth().getUser(req.user.uid);
    const currentUserClaims = currentUserRecord.customClaims || {};
    
    if (currentUserClaims.role !== 'admin') {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Admin access required'
      });
    }
    
    // Set custom claims for target user
    await admin.auth().setCustomUserClaims(uid, {
      role: role,
      updatedBy: req.user.uid,
      updatedAt: Date.now()
    });
    
    console.log(`✅ Role updated: ${uid} -> ${role} by ${req.user.email}`);
    
    res.json({
      message: 'User role updated successfully',
      user: { uid, role }
    });

  } catch (error) {
    console.error('❌ Role update error:', error);
    res.status(500).json({
      error: 'Role update failed',
      message: 'Failed to update user role'
    });
  }
});

/**
 * DELETE /auth/account
 * Delete user account (requires authentication)
 */
router.delete('/account', authenticateUser, async (req, res) => {
  try {
    const { uid } = req.user;
    
    // Delete user from Firebase
    await admin.auth().deleteUser(uid);
    
    console.log(`✅ User account deleted: ${uid}`);
    
    res.json({
      message: 'Account deleted successfully'
    });

  } catch (error) {
    console.error('❌ Account deletion error:', error);
    res.status(500).json({
      error: 'Account deletion failed',
      message: 'Failed to delete user account'
    });
  }
});

module.exports = router;
