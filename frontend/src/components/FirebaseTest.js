import React, { useState, useEffect } from 'react';
import { auth, googleProvider, facebookProvider } from '../config/firebase';
import { signInWithRedirect, getRedirectResult } from 'firebase/auth';

const FirebaseTest = () => {
  const [testResults, setTestResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const addResult = (message, type = 'info') => {
    setTestResults(prev => [...prev, { message, type, timestamp: new Date().toLocaleTimeString() }]);
  };

  const testFirebaseConfig = () => {
    setTestResults([]);
    addResult('🧪 Testing Firebase Configuration...', 'info');
    
    try {
      // Test 1: Check if Firebase is initialized
      if (auth) {
        addResult('✅ Firebase Auth initialized successfully', 'success');
      } else {
        addResult('❌ Firebase Auth not initialized', 'error');
      }

      // Test 2: Check if providers are available
      if (googleProvider) {
        addResult('✅ Google provider available', 'success');
      } else {
        addResult('❌ Google provider not available', 'error');
      }

      if (facebookProvider) {
        addResult('✅ Facebook provider available', 'success');
      } else {
        addResult('❌ Facebook provider not available', 'error');
      }

      // Test 3: Check environment variables
      const envVars = {
        'API Key': process.env.REACT_APP_FIREBASE_API_KEY,
        'Auth Domain': process.env.REACT_APP_FIREBASE_AUTH_DOMAIN,
        'Project ID': process.env.REACT_APP_FIREBASE_PROJECT_ID,
        'Storage Bucket': process.env.REACT_APP_FIREBASE_STORAGE_BUCKET,
        'Messaging Sender ID': process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID,
        'App ID': process.env.REACT_APP_FIREBASE_APP_ID
      };

      Object.entries(envVars).forEach(([key, value]) => {
        if (value && value !== 'your_api_key_here' && value !== 'your_sender_id_here' && value !== 'your_app_id_here') {
          addResult(`✅ ${key}: ${value.substring(0, 20)}...`, 'success');
        } else {
          addResult(`❌ ${key}: Not set or placeholder value`, 'error');
        }
      });

    } catch (error) {
      addResult(`❌ Configuration error: ${error.message}`, 'error');
    }
  };

  const testGoogleLogin = async () => {
    setIsLoading(true);
    addResult('🔐 Testing Google Sign-in...', 'info');
    
    try {
      await signInWithRedirect(auth, googleProvider);
      addResult('🔄 Redirecting to Google...', 'info');
      // Note: User will be redirected to Google, then back to our app
    } catch (error) {
      addResult(`❌ Google login failed: ${error.message}`, 'error');
      setIsLoading(false);
    }
  };

  // Handle redirect result when component mounts
  useEffect(() => {
    const handleRedirectResult = async () => {
      try {
        const result = await getRedirectResult(auth);
        if (result) {
          addResult(`✅ Google login successful! User: ${result.user.email}`, 'success');
          
          // Get ID token
          const idToken = await result.user.getIdToken();
          addResult(`🔑 ID Token received (${idToken.substring(0, 50)}...)`, 'success');
          
          // Test backend verification
          try {
            const response = await fetch('http://localhost:5001/api/auth/social-login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ idToken, provider: 'google' })
            });
            
            if (response.ok) {
              addResult('✅ Backend verification successful!', 'success');
            } else {
              const errorData = await response.json();
              addResult(`❌ Backend verification failed: ${errorData.message}`, 'error');
            }
          } catch (backendError) {
            addResult(`❌ Backend connection error: ${backendError.message}`, 'error');
          }
        }
      } catch (error) {
        addResult(`❌ Redirect result error: ${error.message}`, 'error');
      } finally {
        setIsLoading(false);
      }
    };

    handleRedirectResult();
  }, []);

  const clearResults = () => {
    setTestResults([]);
  };

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>🔥 Firebase Configuration Test</h1>
      
      <div style={{ marginBottom: '20px' }}>
        <button 
          onClick={testFirebaseConfig}
          style={{ 
            padding: '10px 20px', 
            marginRight: '10px',
            backgroundColor: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer'
          }}
        >
          Test Configuration
        </button>
        
        <button 
          onClick={testGoogleLogin}
          disabled={isLoading}
          style={{ 
            padding: '10px 20px',
            backgroundColor: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            opacity: isLoading ? 0.6 : 1
          }}
        >
          {isLoading ? 'Testing...' : 'Test Google Login'}
        </button>
        
        <button 
          onClick={clearResults}
          style={{ 
            padding: '10px 20px',
            marginLeft: '10px',
            backgroundColor: '#6c757d',
            color: 'white',
            border: 'none',
            borderRadius: '5px',
            cursor: 'pointer'
          }}
        >
          Clear Results
        </button>
      </div>

      <div style={{ 
        backgroundColor: '#f8f9fa', 
        padding: '15px', 
        borderRadius: '5px',
        border: '1px solid #dee2e6'
      }}>
        <h3>Test Results:</h3>
        {testResults.length === 0 ? (
          <p>Click "Test Configuration" to start testing...</p>
        ) : (
          <div>
            {testResults.map((result, index) => (
              <div 
                key={index} 
                style={{ 
                  margin: '5px 0',
                  padding: '5px',
                  backgroundColor: 
                    result.type === 'success' ? '#d4edda' :
                    result.type === 'error' ? '#f8d7da' :
                    result.type === 'info' ? '#d1ecf1' : '#fff3cd',
                  border: `1px solid ${
                    result.type === 'success' ? '#c3e6cb' :
                    result.type === 'error' ? '#f5c6cb' :
                    result.type === 'info' ? '#bee5eb' : '#ffeaa7'
                  }`,
                  borderRadius: '3px',
                  fontSize: '14px'
                }}
              >
                <span style={{ fontWeight: 'bold' }}>[{result.timestamp}]</span> {result.message}
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: '20px', padding: '15px', backgroundColor: '#e7f3ff', borderRadius: '5px' }}>
        <h3>💡 Next Steps:</h3>
        <ol>
          <li>Click "Test Configuration" to see what's missing</li>
          <li>Go to <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer">Firebase Console</a></li>
          <li>Select project: <strong>intellimark-6649e</strong></li>
          <li>Add web app and get the missing config values</li>
          <li>Update <code>.env.local</code> with real values</li>
          <li>Restart frontend and test again</li>
        </ol>
      </div>
    </div>
  );
};

export default FirebaseTest;
