import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ChatMessage from './ChatMessage';

// Mock the utility functions that the component depends on
jest.mock('../../utils/messageUtils', () => ({
  isUserMessage: (message) => message.role === 'user',
  hasImage: (message) => !!(message.imageData || message.imageLink),
  getMessageDisplayText: (message) => message.content,
  getMessageTimestamp: () => '12:34',
}));

jest.mock('../../utils/sessionUtils', () => ({
  isMarkingMessage: () => false,
  isAnnotatedImageMessage: (message) => message.role === 'assistant' && !!message.imageLink,
}));

// Mock the Markdown renderer for simplicity in these tests
const MockMarkdownRenderer = ({ content }) => <div data-testid="markdown-renderer">{content}</div>;

describe('ChatMessage Component', () => {
  let consoleErrorSpy;
  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('should render a user message with text content correctly', () => {
    const userMessage = { id: 'user-1', role: 'user', content: 'Hello' };
    render(<ChatMessage message={userMessage} getImageSrc={() => null} MarkdownMathRenderer={MockMarkdownRenderer} ensureStringContent={(c) => c} />);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('should render an assistant message with an image from an imageLink', () => {
    const assistantImageMessage = { id: 'asst-1', role: 'assistant', content: 'Annotated.', imageLink: 'http://example.com/img.jpg' };
    render(<ChatMessage message={assistantImageMessage} getImageSrc={(m) => m.imageLink} MarkdownMathRenderer={MockMarkdownRenderer} ensureStringContent={(c) => c} />);
    const image = screen.getByAltText('Marked homework');
    expect(image).toHaveAttribute('src', 'http://example.com/img.jpg');
  });

  it('should render the "thinking" indicator when progressData is present', () => {
    const thinkingMessage = { id: 'asst-2', role: 'assistant', content: '', isProcessing: true, progressData: { allSteps: ['1'], currentStepDescription: 'Thinking...' } };
    render(<ChatMessage message={thinkingMessage} getImageSrc={() => null} MarkdownMathRenderer={MockMarkdownRenderer} ensureStringContent={(c) => c} />);
    expect(screen.getByText('Thinking...')).toBeInTheDocument();
  });

  // 👇 FIX: The test logic is now corrected to match the component's behavior.
  it('should show and hide progress details when the toggle is clicked', () => {
    // Arrange
    const progressMessage = { 
      id: 'asst-3', 
      role: 'assistant', 
      content: 'Done.', 
      progressData: { 
        allSteps: ['Step A'], 
        currentStepIndex: 1, 
        isComplete: true 
      } 
    };

    // Act
    render(<ChatMessage message={progressMessage} getImageSrc={() => null} MarkdownMathRenderer={MockMarkdownRenderer} ensureStringContent={(c) => c} />);
    
    // Assert (Phase 1): Because the message is complete, the dropdown now starts OPEN.
    expect(screen.getByText('Step A')).toBeInTheDocument();

    // Act: Click the toggle button to hide details
    const toggleButton = screen.getByRole('button');
    fireEvent.click(toggleButton);

    // Assert (Phase 2): Progress details are now hidden
    expect(screen.queryByText('Step A')).not.toBeInTheDocument();
  });
  
  it('should render a user message with an image from imageData', () => {
    const userImageMessage = { id: 'user-2', role: 'user', content: 'My homework.', imageData: 'data:image/png;base64,test' };
    render(<ChatMessage message={userImageMessage} getImageSrc={(m) => m.imageData} MarkdownMathRenderer={MockMarkdownRenderer} ensureStringContent={(c) => c} />);
    const image = screen.getByAltText('Uploaded');
    expect(image).toHaveAttribute('src', 'data:image/png;base64,test');
  });

  it('should display an error message if an image fails to load', () => {
    const userImageMessage = { id: 'user-3', role: 'user', content: 'Fail.', imageData: 'invalid-src' };
    render(<ChatMessage message={userImageMessage} getImageSrc={(m) => m.imageData} MarkdownMathRenderer={MockMarkdownRenderer} ensureStringContent={(c) => c} />);
    const image = screen.getByAltText('Uploaded');
    fireEvent.error(image);
    expect(screen.getByText('📷 Image failed to load')).toBeInTheDocument();
  });

});

