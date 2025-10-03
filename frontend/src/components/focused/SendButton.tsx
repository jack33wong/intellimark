/**
 * SendButton Component (TypeScript)
 * A button for sending messages or analyzing images.
 */
import React from 'react';
import { Send } from 'lucide-react';
import './SendButton.css'; // Assuming styles are in this file

// Define the type for the props this component receives
interface SendButtonProps {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  size?: 'main' | 'small';
  variant?: 'primary' | 'success';
  onError?: (error: Error) => void; // Add the optional onError prop
}

const SendButton: React.FC<SendButtonProps> = ({
  onClick,
  disabled = false,
  loading = false,
  size = 'main',
  variant = 'primary',
}) => {
  const buttonText = loading ? '...' : size === 'main' ? 'Send' : '';

  return (
    <button
      type="button"
      className={`send-button ${size} ${variant} ${disabled || loading ? 'disabled' : ''}`}
      onClick={onClick}
      disabled={disabled || loading}
      aria-label="Send"
    >
      <div className="send-button-content">
        {loading ? (
          <div className="spinner" />
        ) : (
          <Send size={size === 'main' ? 20 : 16} />
        )}
        {size === 'main' && buttonText && <span>{buttonText}</span>}
      </div>
    </button>
  );
};

export default SendButton;

