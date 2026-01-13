/**
 * SendButton Component (TypeScript)
 * A button for sending messages or analyzing images.
 */
import React from 'react';
import { SendHorizontal } from 'lucide-react';
import './SendButton.css'; // Assuming styles are in this file

// Define the type for the props this component receives
interface SendButtonProps {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  size?: 'main' | 'small';
  variant?: 'primary' | 'success';
  onError?: (error: Error) => void;
  className?: string; // Correctly added className
}

const SendButton: React.FC<SendButtonProps> = ({
  onClick,
  disabled = false,
  loading = false,
  size = 'main',
  variant = 'primary',
  className = '', // Destructured with default
}) => {
  const buttonText = loading ? '...' : size === 'main' ? 'Send' : '';

  return (
    <button
      type="button"
      className={`send-button ${size} ${variant} ${disabled || loading ? 'disabled' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled || loading}
      aria-label="Send"
    >
      <div className="send-button-content">
        {loading ? (
          <div className="spinner" />
        ) : (
          <SendHorizontal size={20} />
        )}
      </div>
    </button>
  );
};

export default SendButton;

