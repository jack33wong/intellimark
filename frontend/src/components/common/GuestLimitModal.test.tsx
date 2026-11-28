import React from 'react';
import '@testing-library/jest-dom';
import { render, fireEvent, waitFor, screen } from '@testing-library/react';
import GuestLimitModal from './GuestLimitModal';

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
}));

jest.mock('firebase/auth', () => ({
  signInWithPopup: jest.fn(),
  getAdditionalUserInfo: jest.fn(() => ({ isNewUser: true })),
}));

jest.mock('../../config/firebase', () => ({
  auth: { name: 'mock-auth' },
  googleProvider: { providerId: 'google.com' },
}));

jest.mock('../../utils/analytics', () => ({
  fireAdsSignupConversion: jest.fn(),
}));

jest.mock('../../services/AnalyticsService', () => ({
  analyticsService: {
    logSignUp: jest.fn(),
  },
}));

jest.mock('../../utils/funnelTracker', () => ({
  markAuthWallShown: jest.fn(),
  markAuthWallCtaClicked: jest.fn(),
  markAuthWallDismissed: jest.fn(),
  markAuthWallConverted: jest.fn(),
  getLatestPreInspectSessionId: jest.fn(() => 'pi-session-1'),
}));

describe('GuestLimitModal — 1-Click Google Auth', () => {
  beforeEach(() => {
    const { getAdditionalUserInfo } = require('firebase/auth');
    getAdditionalUserInfo.mockReturnValue({ isNewUser: true });
    const { getLatestPreInspectSessionId } = require('../../utils/funnelTracker');
    getLatestPreInspectSessionId.mockReturnValue('pi-session-1');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('renders direct Google button, trust copy for pending files, and email fallback', () => {
    render(
      <GuestLimitModal
        isOpen={true}
        onClose={jest.fn()}
        hasPendingUpload={true}
        fileCount={2}
        requestType="marking"
      />
    );

    expect(screen.getByRole('button', { name: /Continue with Google/i })).toBeInTheDocument();
    expect(screen.getByText(/Free · No credit card · Auto-marks your 2 uploaded files/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Continue with Email/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Already have an account\? Sign In/i })).toBeInTheDocument();
  });

  test('completes 1-click Google sign-in and calls onDirectAuthSuccess without calling onClose', async () => {
    const { signInWithPopup } = require('firebase/auth');
    const { markAuthWallCtaClicked, markAuthWallConverted } = require('../../utils/funnelTracker');
    const { fireAdsSignupConversion } = require('../../utils/analytics');
    signInWithPopup.mockResolvedValueOnce({
      user: { uid: 'google-uid-123', email: 'student@example.com' },
    });

    const onClose = jest.fn();
    const onDirectAuthSuccess = jest.fn();

    render(
      <GuestLimitModal
        isOpen={true}
        onClose={onClose}
        onDirectAuthSuccess={onDirectAuthSuccess}
        hasPendingUpload={true}
        fileCount={2}
        requestType="marking"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/i }));

    await waitFor(() => {
      expect(signInWithPopup).toHaveBeenCalledTimes(1);
      expect(markAuthWallCtaClicked).toHaveBeenCalledWith('interstitial', 'continue_with_google', 'pi-session-1');
      expect(markAuthWallConverted).toHaveBeenCalledWith('google', 'google-uid-123');
      expect(fireAdsSignupConversion).toHaveBeenCalledWith('student@example.com');
      expect(onDirectAuthSuccess).toHaveBeenCalledTimes(1);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  test('shows inline error and keeps modal open when Google popup is cancelled', async () => {
    const { signInWithPopup } = require('firebase/auth');
    signInWithPopup.mockRejectedValueOnce({ code: 'auth/popup-closed-by-user' });

    const onClose = jest.fn();
    const onDirectAuthSuccess = jest.fn();

    render(
      <GuestLimitModal
        isOpen={true}
        onClose={onClose}
        onDirectAuthSuccess={onDirectAuthSuccess}
        hasPendingUpload={true}
        fileCount={1}
        requestType="marking"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Continue with Google/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Google sign-in was cancelled/i);
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(onDirectAuthSuccess).not.toHaveBeenCalled();
  });

  test('routes Continue with Email to onSignup("signup")', async () => {
    const onSignup = jest.fn();
    render(
      <GuestLimitModal
        isOpen={true}
        onClose={jest.fn()}
        onSignup={onSignup}
        hasPendingUpload={true}
        fileCount={1}
        requestType="marking"
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Continue with Email/i }));
    await waitFor(() => {
      expect(onSignup).toHaveBeenCalledWith('signup');
    });
  });
});
