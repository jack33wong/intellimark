/**
 * SessionManagement Component
 * Handles session data, metadata, and user interactions
 */

import React from 'react';
import SessionHeader from './SessionHeader';
import './css/SessionManagement.css';

const SessionManagement = ({
  sessionTitle,
  isFavorite,
  onFavoriteToggle,
  rating,
  onRatingChange,
  hoveredRating,
  onRatingHover,
  user,
  markingResult,
  sessionData,
  showInfoDropdown,
  onToggleInfoDropdown,
  currentSession,
  isProcessing = false
}) => {
  
  return (
    <SessionHeader
      key={currentSession?.id} // Force re-render when session ID changes
      sessionTitle={sessionTitle}
      isFavorite={isFavorite}
      onFavoriteToggle={onFavoriteToggle}
      rating={rating}
      onRatingChange={onRatingChange}
      hoveredRating={hoveredRating}
      onRatingHover={onRatingHover}
      user={user}
      markingResult={markingResult}
      sessionData={sessionData}
      showInfoDropdown={showInfoDropdown}
      onToggleInfoDropdown={onToggleInfoDropdown}
      currentSession={currentSession}
      isProcessing={isProcessing}
    />
  );
};

export default SessionManagement;
