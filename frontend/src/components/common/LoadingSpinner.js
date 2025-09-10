import React from 'react';
// CSS imported via App.css to avoid webpack circular dependency

/**
 * Reusable Loading Spinner component
 * @param {Object} props - Component props
 * @param {string} props.size - Spinner size: 'small', 'medium', 'large'
 * @param {string} props.color - Spinner color
 * @param {string} props.text - Loading text
 * @param {string} props.className - Additional CSS classes
 */
const LoadingSpinner = ({ 
  size = 'medium', 
  color = 'primary',
  text,
  className = '' 
}) => {
  return (
    <div className={`loading-spinner loading-spinner-${size} ${className}`}>
      <div className={`spinner spinner-${color}`} />
      {text && <p className="loading-text">{text}</p>}
    </div>
  );
};

export default LoadingSpinner;
