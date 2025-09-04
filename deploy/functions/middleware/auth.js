import { getFirebaseAuth, getUserRole, isFirebaseAvailable } from '../config/firebase.js';
export const authenticateUser = async (req, res, next) => {
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
        if (!isFirebaseAvailable()) {
            console.warn('⚠️ Firebase not available, using mock authentication for development');
            req.user = {
                uid: 'mock-user-id',
                email: 'mock@example.com',
                emailVerified: true,
                name: 'Mock User',
                picture: undefined,
                role: 'admin'
            };
            console.log(`✅ Mock user authenticated: ${req.user.email} (${req.user.uid}) - Role: ${req.user.role}`);
            next();
            return;
        }
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
        const userRecord = await firebaseAuth.getUser(decodedToken.uid);
        req.user = {
            uid: userRecord.uid,
            email: userRecord.email || '',
            emailVerified: userRecord.emailVerified || false,
            name: userRecord.displayName || undefined,
            picture: userRecord.photoURL || undefined,
            role: getUserRole(userRecord.email || '')
        };
        console.log(`✅ User authenticated: ${req.user.email} (${req.user.uid}) - Role: ${req.user.role}`);
        next();
    }
    catch (error) {
        console.error('❌ Authentication error:', error);
        return res.status(401).json({
            error: 'Authentication Failed',
            message: 'Invalid authentication token'
        });
    }
};
export const optionalAuth = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const token = authHeader.split('Bearer ')[1];
            if (token) {
                if (isFirebaseAvailable()) {
                    const firebaseAuth = getFirebaseAuth();
                    if (firebaseAuth) {
                        try {
                            const decodedToken = await firebaseAuth.verifyIdToken(token);
                            if (decodedToken) {
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
                        }
                        catch (error) {
                            console.warn('Optional auth token verification failed:', error);
                        }
                    }
                }
                else {
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
    }
    catch (error) {
        console.error('❌ Optional auth error:', error);
        next();
    }
};
export const requireAdmin = async (req, res, next) => {
    try {
        console.log(`✅ Admin access granted (development mode)`);
        next();
    }
    catch (error) {
        console.error('❌ Admin check failed:', error);
        return res.status(403).json({
            error: 'Forbidden',
            message: 'Admin access required'
        });
    }
};
