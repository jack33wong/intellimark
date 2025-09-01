/**
 * Authentication Page
 * Shows social media login options
 */

import React from 'react';
import Login from './Login';
import './AuthPage.css';

const AuthPage = () => {
  return (
    <div className="auth-page">
      <Login />
    </div>
  );
};

export default AuthPage;
