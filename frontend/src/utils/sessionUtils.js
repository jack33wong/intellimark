import API_CONFIG from '../config/api';

/**
 * Utility functions for session management
 * Centralizes all session loading and creation logic
 */

/**
 * Loads a session from the backend and adds it to SessionManager
 * This ensures the sidebar updates properly for new sessions
 * 
 * @param {string} sessionId - The session ID to load
 * @param {Function} getAuthToken - Function to get auth token
 * @param {Object} sessionManager - SessionManager instance
 * @param {Function} selectSession - Function to select the session
 * @returns {Promise<boolean>} - True if successful, false otherwise
 */
export const loadSessionIntoManager = async (sessionId, getAuthToken, sessionManager, selectSession) => {
  if (!sessionId) {
    console.warn('loadSessionIntoManager: No sessionId provided');
    return false;
  }

  try {
    const authToken = await getAuthToken();
    const sessionResponse = await fetch(`${API_CONFIG.BASE_URL}/api/chat/task/${sessionId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (sessionResponse.ok) {
      const sessionData = await sessionResponse.json();
      if (sessionData.success && sessionData.session) {
        // Add the session to SessionManager (this will emit sessionCreated event)
        sessionManager.setSession(sessionData.session);
        // Then select it as current
        selectSession(sessionId);
        return true;
      }
    }
    
    // Fallback: just select the session ID
    selectSession(sessionId);
    return false;
  } catch (error) {
    console.error('Failed to load session data:', error);
    // Fallback: just select the session ID
    selectSession(sessionId);
    return false;
  }
};

/**
 * Creates a new session and loads it into SessionManager
 * This is a convenience function that combines session creation and loading
 * 
 * @param {string} sessionId - The session ID that was created
 * @param {string} sessionTitle - The session title
 * @param {Function} getAuthToken - Function to get auth token
 * @param {Object} sessionManager - SessionManager instance
 * @param {Function} selectSession - Function to select the session
 * @param {Function} setSessionTitle - Function to set the session title
 * @returns {Promise<boolean>} - True if successful, false otherwise
 */
export const createAndLoadSession = async (
  sessionId, 
  sessionTitle, 
  getAuthToken, 
  sessionManager, 
  selectSession, 
  setSessionTitle
) => {
  if (!sessionId) {
    console.warn('createAndLoadSession: No sessionId provided');
    return false;
  }

  // Load the session into SessionManager
  const success = await loadSessionIntoManager(sessionId, getAuthToken, sessionManager, selectSession);
  
  // Set the session title
  if (sessionTitle) {
    setSessionTitle(sessionTitle);
  }
  
  return success;
};

/**
 * Handles session creation for different modes
 * Provides a unified interface for all session creation scenarios
 * 
 * @param {Object} params - Parameters object
 * @param {string} params.sessionId - The session ID
 * @param {string} params.sessionTitle - The session title
 * @param {string} params.mode - The mode ('question' or 'marking')
 * @param {Function} params.getAuthToken - Function to get auth token
 * @param {Object} params.sessionManager - SessionManager instance
 * @param {Function} params.selectSession - Function to select the session
 * @param {Function} params.setSessionTitle - Function to set the session title
 * @returns {Promise<boolean>} - True if successful, false otherwise
 */
export const handleSessionCreation = async ({
  sessionId,
  sessionTitle,
  mode = 'question',
  getAuthToken,
  sessionManager,
  selectSession,
  setSessionTitle
}) => {
  if (!sessionId) {
    console.warn('handleSessionCreation: No sessionId provided');
    return false;
  }

  // Generate default title if not provided
  const defaultTitle = mode === 'question' 
    ? `Question - ${new Date().toLocaleDateString()}`
    : `Marking - ${new Date().toLocaleDateString()}`;
  
  const finalTitle = sessionTitle || defaultTitle;

  return await createAndLoadSession(
    sessionId,
    finalTitle,
    getAuthToken,
    sessionManager,
    selectSession,
    setSessionTitle
  );
};
