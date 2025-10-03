import { renderHook } from '@testing-library/react';
// 👇 FIX: Import `act` directly from 'react' to resolve the deprecation warning.
import { act } from 'react';
import { useSessionManager } from './useSessionManager';
import { simpleSessionService } from '../services/simpleSessionService';
import { useAuth } from '../contexts/AuthContext';

// Mock the dependencies of the hook
jest.mock('../services/simpleSessionService', () => ({
  simpleSessionService: {
    setAuthContext: jest.fn(),
    subscribe: jest.fn(),
    getCurrentSession: jest.fn(),
    addMessage: jest.fn(),
    clearSession: jest.fn(),
    setCurrentSession: jest.fn(),
    updateSession: jest.fn(),
    updateSessionState: jest.fn(),
  },
}));

jest.mock('../contexts/AuthContext', () => ({ useAuth: jest.fn() }));

const renderUseSessionManager = () => renderHook(() => useSessionManager());

describe('useSessionManager hook', () => {
  let capturedCallback;
  let consoleErrorSpy;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.clearAllMocks();
    useAuth.mockReturnValue({ getAuthToken: jest.fn().mockResolvedValue('mock-token') });
    simpleSessionService.getCurrentSession.mockReturnValue(null);
    simpleSessionService.subscribe.mockImplementation((callback) => {
      capturedCallback = callback;
      return jest.fn();
    });
    simpleSessionService.simulateUpdate = (newState) => {
      if (capturedCallback) act(() => capturedCallback(newState));
    };
  });
  
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('should initialize with a null session and empty values', () => {
    const { result } = renderUseSessionManager();
    expect(result.current.currentSession).toBeNull();
  });

  it('should call simpleSessionService.addMessage when the addMessage action is called', async () => {
    const { result } = renderUseSessionManager();
    const testMessage = { role: 'user', content: 'This is a test' };
    await act(async () => { await result.current.addMessage(testMessage); });
    expect(simpleSessionService.addMessage).toHaveBeenCalledWith(testMessage);
  });
  
  it('should call simpleSessionService.clearSession when the clearSession action is called', () => {
    const { result } = renderUseSessionManager();
    act(() => { result.current.clearSession(); });
    expect(simpleSessionService.clearSession).toHaveBeenCalled();
  });
  
  it('should correctly update its state when simpleSessionService pushes an update', () => {
    const { result } = renderUseSessionManager();
    const newSession = { id: 'session-123', title: 'Test Title', messages: [], favorite: true, rating: 4 };
    simpleSessionService.simulateUpdate({ currentSession: newSession });
    expect(result.current.sessionTitle).toBe('Test Title');
  });

  it('should call the correct service methods on onFavoriteToggle', async () => {
      const { result } = renderUseSessionManager();
      simpleSessionService.simulateUpdate({ currentSession: { id: 'session-fav-test', favorite: false } });
      await act(async () => { await result.current.onFavoriteToggle(); });
      expect(simpleSessionService.updateSessionState).toHaveBeenCalledWith(expect.objectContaining({ favorite: true }));
      expect(simpleSessionService.updateSession).toHaveBeenCalledWith('session-fav-test', { favorite: true });
  });

  it('should call the correct service methods on onRatingChange', async () => {
    const { result } = renderUseSessionManager();
    simpleSessionService.simulateUpdate({ currentSession: { id: 'session-rating-test', rating: 0 } });
    await act(async () => { await result.current.onRatingChange(5); });
    expect(simpleSessionService.updateSessionState).toHaveBeenCalledWith(expect.objectContaining({ rating: 5 }));
    expect(simpleSessionService.updateSession).toHaveBeenCalledWith('session-rating-test', { rating: 5 });
  });
});

