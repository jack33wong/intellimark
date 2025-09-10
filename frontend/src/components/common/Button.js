import React from 'react';
// CSS imported via App.css to avoid webpack circular dependency

/**
 * Reusable Button component with variants
 * @param {Object} props - Component props
 * @param {string} props.variant - Button variant: 'primary', 'secondary', 'danger', 'ghost'
 * @param {string} props.size - Button size: 'small', 'medium', 'large'
 * @param {boolean} props.disabled - Whether button is disabled
 * @param {boolean} props.loading - Whether button is in loading state
 * @param {React.ReactNode} props.children - Button content
 * @param {string} props.className - Additional CSS classes
 * @param {Function} props.onClick - Click handler
 * @param {Object} props...rest - Additional props
 */
const Button = ({ 
  variant = 'primary', 
  size = 'medium', 
  disabled = false, 
  loading = false,
  children, 
  className = '', 
  onClick,
  ...rest 
}) => {
  const baseClasses = 'btn';
  const variantClasses = `btn-${variant}`;
  const sizeClasses = `btn-${size}`;
  const stateClasses = disabled ? 'btn-disabled' : '';
  const loadingClasses = loading ? 'btn-loading' : '';
  
  const buttonClasses = [
    baseClasses,
    variantClasses,
    sizeClasses,
    stateClasses,
    loadingClasses,
    className
  ].filter(Boolean).join(' ');

  return (
    <button
      className={buttonClasses}
      disabled={disabled || loading}
      onClick={onClick}
      {...rest}
    >
      {loading && <span className="btn-spinner" />}
      <span className={loading ? 'btn-content-loading' : 'btn-content'}>
        {children}
      </span>
    </button>
  );
};

export default Button;
