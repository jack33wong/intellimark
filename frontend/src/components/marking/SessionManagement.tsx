/**
 * SessionManagement Component (TypeScript)
 * This component is now a simple wrapper that renders the self-sufficient SessionHeader.
 */
import React from 'react';
import SessionHeader from './SessionHeader';
import './css/SessionManagement.css';

const SessionManagement: React.FC = () => {
  // This component no longer needs to accept or pass down any props.
  // The SessionHeader component is now self-sufficient and gets its own data
  // from the useMarkingPage() context hook.
  return <SessionHeader />;
};

export default SessionManagement;
