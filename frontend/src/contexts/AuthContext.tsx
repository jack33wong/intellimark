/**
 * AuthContext Component (TypeScript)
 * This is the definitive version with the fix for the e2e test.
 */
import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { auth } from '../config/firebase'; 
import { 
    onAuthStateChanged, 
    User, 
    signOut, 
    createUserWithEmailAndPassword, 
    signInWithEmailAndPassword 
} from 'firebase/auth';
import EventManager, { EVENT_TYPES } from '../utils/eventManager';

interface AppUser extends User {
  isAdmin?: boolean; 
}

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
  isAdmin: () => boolean;
  getAuthToken: () => Promise<string | null>;
  logout: () => Promise<void>;
  emailPasswordSignup: (email: string, pass: string, name: string) => Promise<{ success: boolean; message?: string }>;
  emailPasswordSignin: (email: string, pass: string) => Promise<{ success: boolean; message?: string }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!auth) {
      console.error("Firebase auth is not initialized.");
      setLoading(false);
      return;
    }
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // 👇 FIX 1: Get the ID token and store it in localStorage.
        const idToken = await firebaseUser.getIdToken();
        localStorage.setItem('authToken', idToken);
        
        const idTokenResult = await firebaseUser.getIdTokenResult();
        const appUser: AppUser = {
          ...(firebaseUser as any),
          uid: firebaseUser.uid,
          email: firebaseUser.email,
          displayName: firebaseUser.displayName,
          photoURL: firebaseUser.photoURL,
          emailVerified: firebaseUser.emailVerified,
          isAdmin: idTokenResult.claims.admin === true, 
        };
        setUser(appUser);
      } else {
        // 👇 FIX 2: Remove the token from localStorage on logout.
        localStorage.removeItem('authToken');
        setUser(null);
        // 👇 FIX 3: Emit USER_LOGGED_OUT event to clear chat history
        EventManager.dispatch(EVENT_TYPES.USER_LOGGED_OUT, {});
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const getAuthToken = async (): Promise<string | null> => {
    if (auth?.currentUser) {
      return auth.currentUser.getIdToken();
    }
    return null;
  };

  const logout = async (): Promise<void> => {
    if (!auth) return;
    // Emit logout event immediately before Firebase signOut
    EventManager.dispatch(EVENT_TYPES.USER_LOGGED_OUT, {});
    await signOut(auth);
  };
  
  const isAdmin = (): boolean => {
      return !!user?.isAdmin;
  }

  const emailPasswordSignup = async (email: string, pass: string, name: string) => {
      if (!auth) return { success: false, message: "Auth not initialized" };
      try {
          await createUserWithEmailAndPassword(auth, email, pass);
          return { success: true };
      } catch (error: any) {
          return { success: false, message: error.message };
      }
  };

  const emailPasswordSignin = async (email: string, pass: string) => {
      if (!auth) return { success: false, message: "Auth not initialized" };
      try {
          await signInWithEmailAndPassword(auth, email, pass);
          return { success: true };
      } catch (error: any) {
          return { success: false, message: error.message };
      }
  };

  const value: AuthContextType = {
    user,
    loading,
    isAdmin,
    getAuthToken,
    logout,
    emailPasswordSignup,
    emailPasswordSignin,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};

