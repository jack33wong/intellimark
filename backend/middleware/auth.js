/**
 * Firebase Authentication Middleware
 * Verifies Firebase ID tokens and protects routes
 */

const admin = require('firebase-admin');

/**
 * Middleware to verify Firebase ID token
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const authenticateUser = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'No valid authorization header found' 
      });
    }

    const idToken = authHeader.split('Bearer ')[1];
    
    if (!idToken) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'No ID token provided' 
      });
    }

    // Verify the Firebase ID token
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    
    // Add user info to request object
    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      emailVerified: decodedToken.email_verified,
      name: decodedToken.name || null,
      picture: decodedToken.picture || null
    };

    console.log(`✅ User authenticated: ${req.user.email} (${req.user.uid})`);
    next();
    
  } catch (error) {
    console.error('❌ Authentication error:', error);
    
    if (error.code === 'auth/id-token-expired') {
      return res.status(401).json({ 
        error: 'Token Expired', 
        message: 'Your session has expired. Please log in again.' 
      });
    }
    
    if (error.code === 'auth/id-token-revoked') {
      return res.status(401).json({ 
        error: 'Token Revoked', 
        message: 'Your session has been revoked. Please log in again.' 
      });
    }
    
    return res.status(401).json({ 
      error: 'Authentication Failed', 
      message: 'Invalid or expired authentication token' 
    });
  }
};

/**
 * Optional authentication middleware (doesn't block if no token)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.split('Bearer ')[1];
      
      if (idToken) {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = {
          uid: decodedToken.uid,
          email: decodedToken.email,
          emailVerified: decodedToken.email_verified,
          name: decodedToken.name || null,
          picture: decodedToken.picture || null
        };
        console.log(`✅ Optional auth successful: ${req.user.email}`);
      }
    }
    
    next();
  } catch (error) {
    // Don't block the request, just continue without user info
    console.log('ℹ️ Optional auth failed, continuing without user info');
    next();
  }
};

/**
 * Admin-only middleware (requires admin role in custom claims)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
const requireAdmin = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ 
        error: 'Unauthorized', 
        message: 'Authentication required' 
      });
    }

    // Check if user has admin role in custom claims
    const userRecord = await admin.auth().getUser(req.user.uid);
    const customClaims = userRecord.customClaims || {};
    
    if (!customClaims.admin) {
      return res.status(403).json({ 
        error: 'Forbidden', 
        message: 'Admin access required' 
      });
    }

    console.log(`✅ Admin access granted: ${req.user.email}`);
    next();
    
  } catch (error) {
    console.error('❌ Admin check error:', error);
    return res.status(500).json({ 
      error: 'Server Error', 
      message: 'Failed to verify admin status' 
    });
  }
};

module.exports = {
  authenticateUser,
  optionalAuth,
  requireAdmin
};
