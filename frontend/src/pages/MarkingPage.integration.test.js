import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { BrowserRouter as Router } from 'react-router-dom';
import { MarkingPageProvider, useMarkingPage } from '../contexts/MarkingPageContext';
import MarkingPage from './MarkingPage';
import { AuthProvider } from '../contexts/AuthContext';
import { simpleSessionService } from '../services/simpleSessionService';

// The manual mock in `src/config/__mocks__` now handles Firebase automatically.
// The inline jest.mock for firebase is no longer needed.

// Mock child components that are not relevant to this test
jest.mock('../components/marking/SessionManagement', () => {
  return () => {
    const { onToggleInfoDropdown, showInfoDropdown, currentSession } = jest.requireActual('../contexts/MarkingPageContext').useMarkingPage();
    return (
      <div data-testid="session-management">
        <button data-testid="task-details-button" onClick={onToggleInfoDropdown}>Task Details</button>
        {showInfoDropdown && currentSession?.sessionMetadata && (
          <div>Model Used: {currentSession.sessionMetadata.modelUsed}</div>
        )}
      </div>
    );
  };
});

// Mock the API calls
global.fetch = jest.fn();

const renderComponent = () => {
  return render(
    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthProvider>
        <MarkingPageProvider>
          <MarkingPage />
        </MarkingPageProvider>
      </AuthProvider>
    </Router>
  );
};

describe('MarkingPage Integration Tests', () => {
    beforeEach(() => {
        global.fetch.mockClear();
        simpleSessionService.clearAllSessions();
    });

    it('should correctly replace the thinking message without leaving a ghost', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
                success: true,
                unifiedSession: {
                    id: 'session-1',
                    title: 'Test Session',
                    messages: [
                        { id: 'user-1', role: 'user', content: 'Hello' },
                        { id: 'ai-1', role: 'assistant', content: 'Hi there!' }
                    ]
                }
            })
        });
        renderComponent();

        const input = screen.getByPlaceholderText(/ask me anything/i);
        const sendButton = screen.getByRole('button', { name: /send/i });
        fireEvent.change(input, { target: { value: 'Hello' } });
        fireEvent.click(sendButton);

        await screen.findByText(/processing question/i);

        await waitFor(() => {
            expect(screen.getByText('Hi there!')).toBeInTheDocument();
        });

        const assistantMessages = document.querySelectorAll('.chat-message.assistant');
        expect(assistantMessages).toHaveLength(1);
        expect(screen.queryByText(/processing question/i)).not.toBeInTheDocument();
    });

    it('should keep the task details dropdown open when an AI response arrives', async () => {
        global.fetch.mockResolvedValueOnce({
            ok: true,
            json: () => Promise.resolve({
                success: true,
                unifiedSession: {
                    id: 'session-2',
                    title: 'Image Test',
                    messages: [
                        { id: 'user-2', role: 'user', content: 'Check image' },
                        { id: 'ai-2', role: 'assistant', content: 'Image feedback.' }
                    ],
                    sessionMetadata: { modelUsed: 'gemini-pro' }
                }
            })
        });
        renderComponent();
        
        const input = screen.getByPlaceholderText(/ask me anything/i);
        const sendButton = screen.getByRole('button', { name: /send/i });
        fireEvent.change(input, { target: { value: 'Check image' } });
        fireEvent.click(sendButton);

        const detailsButton = await screen.findByTestId('task-details-button');
        fireEvent.click(detailsButton);
        
        await screen.findByText(/model used/i);
        
        await waitFor(() => {
            expect(screen.getByText('Image feedback.')).toBeInTheDocument();
        });

        expect(screen.getByText(/model used/i)).toBeInTheDocument();
    });
});

// This polyfill correctly mocks the missing DOM APIs for the test environment.
beforeAll(() => {
    window.HTMLElement.prototype.scrollIntoView = jest.fn();
    window.HTMLElement.prototype.scrollTo = jest.fn();
});

