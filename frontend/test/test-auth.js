/**
 * Test Authentication Status
 */

function testAuth() {
  console.log('🔐 Testing Authentication Status...');
  
  // Check localStorage
  const authToken = localStorage.getItem('authToken');
  console.log('Auth token from localStorage:', authToken ? 'Present' : 'Missing');
  
  // Check sessionStorage
  const sessionToken = sessionStorage.getItem('authToken');
  console.log('Auth token from sessionStorage:', sessionToken ? 'Present' : 'Missing');
  
  // Check if user is logged in
  const user = JSON.parse(localStorage.getItem('user') || 'null');
  console.log('User data:', user ? `Logged in as ${user.email}` : 'Not logged in');
  
  return {
    hasAuthToken: !!(authToken || sessionToken),
    user: user
  };
}

// Run in browser console
console.log('Run testAuth() in browser console to check authentication status');

