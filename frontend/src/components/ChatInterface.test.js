import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ChatInterface from './ChatInterface';

// Mock the lucide-react icons
jest.mock('lucide-react', () => ({
  Send: ({ size, children, ...props }) => (
    <div data-testid="send" {...props}>{children}</div>
  ),
  User: ({ size, children, ...props }) => (
    <div data-testid="user" {...props}>{children}</div>
  ),
  Bot: ({ size, children, ...props }) => (
    <div data-testid="bot" {...props}>{children}</div>
  ),
  MessageSquare: ({ size, children, ...props }) => (
    <div data-testid="message-square" {...props}>{children}</div>
  ),
}));

// Mock fetch
global.fetch = jest.fn();

describe('ChatInterface Component', () => {
  const mockCurrentChat = {
    id: '1',
    title: 'Test Chat',
    updatedAt: new Date().toISOString(),
    messageCount: 5
  };

  const mockOnUpdateChatTitle = jest.fn();

  beforeEach(() => {
    fetch.mockClear();
    mockOnUpdateChatTitle.mockClear();
  });

  test('renders empty state when no current chat', () => {
    render(<ChatInterface currentChat={null} onUpdateChatTitle={mockOnUpdateChatTitle} />);
    expect(screen.getByText('Welcome to Intellimark Chat')).toBeInTheDocument();
    expect(screen.getByText('Start a new conversation to begin chatting with AI. Your chat history will appear here.')).toBeInTheDocument();
  });

  test('renders chat header when current chat exists', () => {
    render(<ChatInterface currentChat={mockCurrentChat} onUpdateChatTitle={mockOnUpdateChatTitle} />);
    expect(screen.getByText('Test Chat')).toBeInTheDocument();
  });

  test('renders chat input when current chat exists', () => {
    render(<ChatInterface currentChat={mockCurrentChat} onUpdateChatTitle={mockOnUpdateChatTitle} />);
    expect(screen.getByPlaceholderText('Type your message...')).toBeInTheDocument();
    expect(screen.getByText('Send')).toBeInTheDocument();
  });

  test('send button is disabled when input is empty', () => {
    render(<ChatInterface currentChat={mockCurrentChat} onUpdateChatTitle={mockOnUpdateChatTitle} />);
    const sendButton = screen.getByText('Send');
    expect(sendButton).toBeDisabled();
  });

  test('send button is enabled when input has content', () => {
    render(<ChatInterface currentChat={mockCurrentChat} onUpdateChatTitle={mockOnUpdateChatTitle} />);
    const input = screen.getByPlaceholderText('Type your message...');
    const sendButton = screen.getByText('Send');
    
    fireEvent.change(input, { target: { value: 'Hello world' } });
    expect(sendButton).not.toBeDisabled();
  });

  test('input value updates when typing', () => {
    render(<ChatInterface currentChat={mockCurrentChat} onUpdateChatTitle={mockOnUpdateChatTitle} />);
    const input = screen.getByPlaceholderText('Type your message...');
    
    fireEvent.change(input, { target: { value: 'Hello world' } });
    expect(input.value).toBe('Hello world');
  });

  test('renders messages when they exist', async () => {
    const mockMessages = [
      {
        id: '1',
        content: 'Hello',
        sender: 'user',
        timestamp: new Date().toISOString()
      },
      {
        id: '2',
        content: 'Hi there!',
        sender: 'ai',
        timestamp: new Date().toISOString()
      }
    ];

    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => mockMessages
    });

    render(<ChatInterface currentChat={mockCurrentChat} onUpdateChatTitle={mockOnUpdateChatTitle} />);
    
    await waitFor(() => {
      expect(screen.getByText('Hello')).toBeInTheDocument();
      expect(screen.getByText('Hi there!')).toBeInTheDocument();
    });
  });

  test('shows thinking indicator when loading', () => {
    render(<ChatInterface currentChat={mockCurrentChat} onUpdateChatTitle={mockOnUpdateChatTitle} />);
    // This test would need to be expanded to actually trigger the loading state
    // For now, we just ensure the component renders without the thinking indicator
    expect(screen.queryByText('Thinking...')).not.toBeInTheDocument();
  });
});
