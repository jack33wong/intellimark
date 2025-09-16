/**
 * SessionManagement Component
 * Handles session data, metadata, and user interactions
 */

import React from 'react';
import SessionHeader from './SessionHeader';

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
  onToggleInfoDropdown
}) => {
  return (
    <SessionHeader
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
    />
  );
};

export default SessionManagement;
