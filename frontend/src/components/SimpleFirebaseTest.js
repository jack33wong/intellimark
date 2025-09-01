import React, { useState } from 'react';

const SimpleFirebaseTest = () => {
  const [testResults, setTestResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);

  const addResult = (message, type = 'info') => {
    setTestResults(prev => [...prev, { message, type, timestamp: new Date().toLocaleTimeString() }]);
  };

  const testEnvironmentVariables = () => {
    setTestResults([]);
    addResult('🧪 Testing Environment Variables...', 'info');
    
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
  };

  const testFirebaseAPI = async () => {
    setIsLoading(true);
    addResult('🌐 Testing Firebase API...', 'info');
    
    try {
      const apiKey = process.env.REACT_APP_FIREBASE_API_KEY;
      const projectId = process.env.REACT_APP_FIREBASE_PROJECT_ID;
      
      // Test 1: Basic project info
      const response = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}?key=${apiKey}`);
      
      if (response.ok) {
        const data = await response.json();
        addResult(`✅ Project API accessible: ${data.projectId}`, 'success');
      } else {
        const errorData = await response.json();
        addResult(`❌ Project API error: ${errorData.error?.message || response.statusText}`, 'error');
        addResult(`🔍 Status: ${response.status}`, 'info');
      }
      
      // Test 2: Check if Authentication is enabled
      const authResponse = await fetch(`https://identitytoolkit.googleapis.com/v1/projects/${projectId}/config?key=${apiKey}`);
      
      if (authResponse.ok) {
        addResult('✅ Authentication API accessible', 'success');
      } else {
        const authError = await authResponse.json();
        addResult(`❌ Authentication API error: ${authError.error?.message || authResponse.statusText}`, 'error');
        addResult(`🔍 Status: ${authResponse.status}`, 'info');
      }
      
    } catch (error) {
      addResult(`❌ Network error: ${error.message}`, 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const clearResults = () => {
    setTestResults([]);
  };

  return (
    <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
      <h1>🧪 Simple Firebase Test</h1>
      
      <div style={{ marginBottom: '20px' }}>
        <button 
          onClick={testEnvironmentVariables}
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
          Test Environment Variables
        </button>
        
        <button 
          onClick={testFirebaseAPI}
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
          {isLoading ? 'Testing...' : 'Test Firebase API'}
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
          <p>Click "Test Environment Variables" to start testing...</p>
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
        <h3>💡 What This Tests:</h3>
        <ul>
          <li><strong>Environment Variables:</strong> Checks if all Firebase config values are loaded</li>
          <li><strong>Firebase API:</strong> Tests if your API key can access Firebase services</li>
          <li><strong>Authentication:</strong> Verifies if Authentication is enabled in your project</li>
        </ul>
        
        <h3>🔧 If You Get 400 Errors:</h3>
        <ol>
          <li>Go to <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer">Firebase Console</a></li>
          <li>Select project: <strong>intellimark-6649e</strong></li>
          <li>Go to <strong>Authentication</strong> → <strong>Sign-in method</strong></li>
          <li>Make sure <strong>Google</strong> and <strong>Facebook</strong> are enabled</li>
          <li>Check if there are any domain restrictions</li>
        </ol>
      </div>
    </div>
  );
};

export default SimpleFirebaseTest;
