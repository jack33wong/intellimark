/**
 * Centralized Event Manager
 * 
 * Provides a clean interface for dispatching and listening to custom events
 * across the application. This eliminates the need to manually create
 * CustomEvent objects and manage event listeners.
 */

class EventManager {
  /**
   * Dispatch a custom event
   * @param {string} eventType - The type of event to dispatch
   * @param {any} data - The data to pass with the event
   */
  static dispatch(eventType, data = null) {
    window.dispatchEvent(new CustomEvent(eventType, { detail: data }));
  }

  /**
   * Listen to a custom event
   * @param {string} eventType - The type of event to listen for
   * @param {function} handler - The function to call when the event is triggered
   * @returns {function} - A cleanup function to remove the listener
   */
  static listen(eventType, handler) {
    window.addEventListener(eventType, handler);
    return () => window.removeEventListener(eventType, handler);
  }

  /**
   * Listen to multiple events at once
   * @param {Object} eventHandlers - Object mapping event types to handlers
   * @returns {function} - A cleanup function to remove all listeners
   */
  static listenToMultiple(eventHandlers) {
    const cleanupFunctions = Object.entries(eventHandlers).map(([eventType, handler]) => {
      return this.listen(eventType, handler);
    });

    return () => {
      cleanupFunctions.forEach(cleanup => cleanup());
    };
  }
}

// Event type constants for better IDE support and consistency
export const EVENT_TYPES = {
  SESSION_UPDATED: 'sessionUpdated',
  SESSION_DELETED: 'sessionDeleted',
  SESSIONS_CLEARED: 'sessionsCleared',
  PAGE_MODE_CHANGED: 'pageModeChanged',
  CHAT_MESSAGE_SENT: 'chatMessageSent',
  IMAGE_UPLOADED: 'imageUploaded',
  MARKING_COMPLETED: 'markingCompleted'
};

export default EventManager;
