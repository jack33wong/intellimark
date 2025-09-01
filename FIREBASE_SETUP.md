# 🔥 Firebase Authentication Setup Guide

## 📋 **Prerequisites**
- Google account for Firebase Console
- Facebook Developer account (for Facebook login)

## 🚀 **Step 1: Create Firebase Project**

### 1.1 Go to Firebase Console
- Visit [https://console.firebase.google.com/](https://console.firebase.google.com/)
- Click **"Add project"**

### 1.2 Project Setup
- **Project name**: `intellimark` (or your preferred name)
- **Enable Google Analytics**: Optional (recommended)
- Click **"Create project"**

### 1.3 Wait for Project Creation
- Firebase will set up your project
- Click **"Continue"** when ready

## 🔐 **Step 2: Enable Authentication**

### 2.1 Navigate to Authentication
- In left sidebar, click **"Authentication"**
- Click **"Get started"**

### 2.2 Enable Google Sign-in
- Click **"Google"** in the providers list
- Click **"Enable"**
- **Project support email**: Your email address
- Click **"Save"**

### 2.3 Enable Facebook Sign-in
- Click **"Facebook"** in the providers list
- Click **"Enable"**
- **App ID**: You'll get this from Facebook Developers
- **App secret**: You'll get this from Facebook Developers
- Click **"Save"**

## 📱 **Step 3: Create Web App**

### 3.1 Add Web App
- Click the gear icon (⚙️) next to "Project Overview"
- Click **"Project settings"**
- Scroll to **"Your apps"** section
- Click the web app icon (</>)

### 3.2 Register App
- **App nickname**: `intellimark-web`
- **Firebase Hosting**: Check if you plan to use it
- Click **"Register app"**

### 3.3 Copy Configuration
- Copy the entire `firebaseConfig` object
- It looks like this:
```javascript
const firebaseConfig = {
  apiKey: "AIzaSyC...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

## 📝 **Step 4: Configure Environment Variables**

### 4.1 Create .env.local File
- In your `frontend` directory, create `.env.local`
- Copy the values from your Firebase config:

```bash
REACT_APP_FIREBASE_API_KEY=AIzaSyC...
REACT_APP_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
REACT_APP_FIREBASE_PROJECT_ID=your-project-id
REACT_APP_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
REACT_APP_FIREBASE_MESSAGING_SENDER_ID=123456789
REACT_APP_FIREBASE_APP_ID=1:123456789:web:abc123
```

### 4.2 Restart Frontend
- Stop your frontend server (Ctrl+C)
- Run `npm start` again

## 🔑 **Step 5: Facebook App Setup (Optional)**

### 5.1 Create Facebook App
- Go to [Facebook Developers](https://developers.facebook.com/)
- Click **"Create App"**
- Choose **"Consumer"** app type
- Fill in app details

### 5.2 Get App Credentials
- In your Facebook app dashboard
- Copy **App ID** and **App Secret**
- Add these to Firebase Authentication > Sign-in method > Facebook

## 🧪 **Step 6: Test Authentication**

### 6.1 Test Google Login
- Go to your app's login page
- Click **"Continue with Google"**
- Should open Google sign-in popup
- After successful login, check browser console for success message

### 6.2 Test Facebook Login
- Click **"Continue with Facebook"**
- Should open Facebook sign-in popup
- After successful login, check browser console for success message

## 🚨 **Troubleshooting**

### Common Issues:

#### 1. **"Firebase: Error (auth/unauthorized-domain)"**
- Go to Firebase Console > Authentication > Settings > Authorized domains
- Add your domain (e.g., `localhost` for development)

#### 2. **"Firebase: Error (auth/popup-blocked)"**
- Browser blocked popup
- Allow popups for your domain
- Try using `signInWithRedirect` instead of `signInWithPopup`

#### 3. **"Firebase: Error (auth/network-request-failed)"**
- Check internet connection
- Verify Firebase project is active
- Check if Firebase services are down

#### 4. **"Invalid API key"**
- Verify `.env.local` file exists
- Check API key is correct
- Restart frontend server after changes

## 🔒 **Security Notes**

- ✅ **Never commit** `.env.local` to git
- ✅ **Always verify** ID tokens on backend
- ✅ **Use HTTPS** in production
- ✅ **Set proper CORS** origins
- ✅ **Enable rate limiting** (already implemented)

## 📚 **Next Steps**

After successful setup:
1. Test both Google and Facebook login
2. Verify backend receives valid ID tokens
3. Check user creation in Firebase Console
4. Test protected routes
5. Deploy to production with proper environment variables

## 🆘 **Need Help?**

- Check Firebase Console for error logs
- Review browser console for frontend errors
- Check backend server logs for authentication errors
- Verify all environment variables are set correctly
