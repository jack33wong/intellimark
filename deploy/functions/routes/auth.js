"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middleware/auth");
const firebase_1 = require("../config/firebase");
const router = express_1.default.Router();
router.get('/providers', (_req, res) => {
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
                error: 'Invalid provider',
                message: 'Only Google and Facebook are supported'
            });
        }
        if (!(0, firebase_1.isFirebaseAvailable)()) {
            console.warn('⚠️ Firebase not available, using mock authentication for development');
            const mockUser = {
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
        const firebaseAuth = (0, firebase_1.getFirebaseAuth)();
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
        const userRecord = await firebaseAuth.getUser(decodedToken.uid);
        const user = {
            uid: userRecord.uid,
            email: userRecord.email || '',
            emailVerified: userRecord.emailVerified || false,
            name: userRecord.displayName || undefined,
            picture: userRecord.photoURL || undefined,
            role: (0, firebase_1.getUserRole)(userRecord.email || '')
        };
        console.log(`✅ Real Firebase login successful: ${user.email} via ${provider} (role: ${user.role})`);
        res.json({
            success: true,
            user,
            message: 'Login successful'
        });
    }
    catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({
            error: 'Login Failed',
            message: 'An error occurred during authentication'
        });
    }
});
router.get('/profile', auth_1.authenticateUser, (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'User not authenticated'
            });
        }
        const userWithRole = {
            ...req.user,
            role: req.user.role || (0, firebase_1.getUserRole)(req.user.email)
        };
        res.json({
            success: true,
            user: userWithRole
        });
    }
    catch (error) {
        console.error('❌ Profile fetch error:', error);
        res.status(500).json({
            error: 'Profile Fetch Failed',
            message: 'An error occurred while fetching profile'
        });
    }
});
router.put('/profile', auth_1.authenticateUser, async (req, res) => {
    try {
        const { displayName, photoURL } = req.body;
        if (!req.user) {
            return res.status(401).json({
                error: 'Unauthorized',
                message: 'User not authenticated'
            });
        }
        if (!(0, firebase_1.isFirebaseAvailable)()) {
            console.warn('⚠️ Firebase not available, using mock profile update for development');
            const updatedUser = {
                ...req.user,
                name: displayName || req.user.name,
                role: (0, firebase_1.getUserRole)(req.user.email)
            };
            console.log(`✅ Mock profile updated for: ${updatedUser.email} (role: ${updatedUser.role})`);
            res.json({
                success: true,
                user: updatedUser,
                message: 'Profile updated successfully (development mode)'
            });
            return;
        }
        const firebaseAuth = (0, firebase_1.getFirebaseAuth)();
        if (!firebaseAuth) {
            throw new Error('Firebase Auth not available');
        }
        await firebaseAuth.updateUser(req.user.uid, {
            displayName: displayName || req.user.name,
            photoURL: photoURL || req.user.picture
        });
        const updatedUserRecord = await firebaseAuth.getUser(req.user.uid);
        const updatedUser = {
            uid: updatedUserRecord.uid,
            email: updatedUserRecord.email || '',
            emailVerified: updatedUserRecord.emailVerified || false,
            name: updatedUserRecord.displayName || undefined,
            picture: updatedUserRecord.photoURL || undefined,
            role: (0, firebase_1.getUserRole)(updatedUserRecord.email || '')
        };
        console.log(`✅ Real Firebase profile updated for: ${updatedUser.email} (role: ${updatedUser.role})`);
        res.json({
            success: true,
            user: updatedUser,
            message: 'Profile updated successfully'
        });
    }
    catch (error) {
        console.error('❌ Profile update error:', error);
        res.status(500).json({
            error: 'Profile Update Failed',
            message: 'An error occurred while updating profile'
        });
    }
});
router.post('/logout', (req, res) => {
    try {
        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    }
    catch (error) {
        console.error('❌ Logout error:', error);
        res.status(500).json({
            error: 'Logout Failed',
            message: 'An error occurred during logout'
        });
    }
});
exports.default = router;
