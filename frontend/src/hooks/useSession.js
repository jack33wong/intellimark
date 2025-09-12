/**
 * Custom hook for session management
 * Handles session state, favorites, ratings, and persistence
 */

import { useState, useCallback, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { FirestoreService } from '../services/firestoreService';

export const useSession = () => {
  const { getAuthToken, user } = useAuth();
  
  // Session state
  const [currentSessionId, setCurrentSessionId] = useState(null);
  const [sessionTitle, setSessionTitle] = useState('Chat Session');
  const [isFavorite, setIsFavorite] = useState(false);
  const [rating, setRating] = useState(0);
  const [hoveredRating, setHoveredRating] = useState(0);

  // Load session data including favorite and rating
  const loadSessionData = useCallback((sessionData) => {
    if (sessionData) {
      setIsFavorite(sessionData.favorite || false);
      setRating(Number(sessionData.rating) || 0);
      if (sessionData.title) {
        setSessionTitle(sessionData.title);
      }
      if (sessionData.id) {
        setCurrentSessionId(sessionData.id);
      }
    }
  }, []);

  // Handle favorite toggle (only for authenticated users)
  const handleFavoriteToggle = useCallback(async () => {
    if (!currentSessionId || !user?.uid) return;
    
    const newFavoriteState = !isFavorite;
    setIsFavorite(newFavoriteState);
    
    try {
      const authToken = await getAuthToken();
      await FirestoreService.updateChatSession(currentSessionId, {
        favorite: newFavoriteState
      }, authToken);
      
      // Notify sidebar to refresh
      window.dispatchEvent(new CustomEvent('sessionUpdated', { 
        detail: { sessionId: currentSessionId, field: 'favorite', value: newFavoriteState } 
      }));
    } catch (error) {
      console.error('Failed to update favorite status:', error);
      // Revert on error
      setIsFavorite(!newFavoriteState);
    }
  }, [currentSessionId, user?.uid, isFavorite, getAuthToken]);

  // Handle rating change (only for authenticated users)
  const handleRatingChange = useCallback(async (newRating) => {
    if (!currentSessionId || !user?.uid) return;
    
    const previousRating = rating;
    const numericRating = Number(newRating);
    setRating(numericRating);
    
    try {
      const authToken = await getAuthToken();
      await FirestoreService.updateChatSession(currentSessionId, {
        rating: numericRating
      }, authToken);
      
      // Notify sidebar to refresh
      window.dispatchEvent(new CustomEvent('sessionUpdated', { 
        detail: { sessionId: currentSessionId, field: 'rating', value: numericRating } 
      }));
    } catch (error) {
      console.error('Failed to update rating:', error);
      // Revert on error
      setRating(previousRating);
    }
  }, [currentSessionId, user?.uid, rating, getAuthToken]);

  // Clear session
  const clearSession = useCallback(() => {
    setCurrentSessionId(null);
    setSessionTitle('Chat Session');
    setIsFavorite(false);
    setRating(0);
    setHoveredRating(0);
  }, []);

  return {
    // State
    currentSessionId,
    setCurrentSessionId,
    sessionTitle,
    setSessionTitle,
    isFavorite,
    rating,
    hoveredRating,
    setHoveredRating,
    
    // Actions
    loadSessionData,
    handleFavoriteToggle,
    handleRatingChange,
    clearSession
  };
};
