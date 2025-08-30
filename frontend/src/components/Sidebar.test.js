import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from './Sidebar';

// Mock the lucide-react icons
jest.mock('lucide-react', () => ({
  MessageSquare: ({ size, children, ...props }) => (
    <div data-testid="message-square" {...props}>{children}</div>
  ),
  BarChart3: ({ size, children, ...props }) => (
    <div data-testid="bar-chart" {...props}>{children}</div>
  ),
  Settings: ({ size, children, ...props }) => (
    <div data-testid="settings" {...props}>{children}</div>
  ),
  Trash2: ({ size, children, ...props }) => (
    <div data-testid="trash" {...props}>{children}</div>
  ),
  User: ({ size, children, ...props }) => (
    <div data-testid="user" {...props}>{children}</div>
  ),
  TrendingUp: ({ size, children, ...props }) => (
    <div data-testid="trending-up" {...props}>{children}</div>
  ),
  Calendar: ({ size, children, ...props }) => (
    <div data-testid="calendar" {...props}>{children}</div>
  ),
  Target: ({ size, children, ...props }) => (
    <div data-testid="target" {...props}>{children}</div>
  ),
}));

// Mock fetch
global.fetch = jest.fn();

describe('Sidebar Component', () => {
  const mockProps = {
    chats: [
      {
        id: '1',
        title: 'Test Chat 1',
        updatedAt: new Date().toISOString(),
        messageCount: 5
      },
      {
        id: '2',
        title: 'Test Chat 2',
        updatedAt: new Date().toISOString(),
        messageCount: 3
      }
    ],
    currentChat: null,
    onNewChat: jest.fn(),
    onSelectChat: jest.fn(),
    onDeleteChat: jest.fn(),
    isLoading: false
  };

  beforeEach(() => {
    fetch.mockClear();
  });

  test('renders sidebar header', () => {
    render(<Sidebar {...mockProps} />);
    expect(screen.getByText('Intellimark Chat')).toBeInTheDocument();
    expect(screen.getByText('AI-powered conversations')).toBeInTheDocument();
  });

  test('renders new chat button', () => {
    render(<Sidebar {...mockProps} />);
    expect(screen.getByText('New Chat')).toBeInTheDocument();
  });

  test('renders user progress section', () => {
    render(<Sidebar {...mockProps} />);
    expect(screen.getByText('User Progress')).toBeInTheDocument();
  });

  test('renders chat history section', () => {
    render(<Sidebar {...mockProps} />);
    expect(screen.getByText('Chat History')).toBeInTheDocument();
  });

  test('renders admin section', () => {
    render(<Sidebar {...mockProps} />);
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  test('calls onNewChat when new chat button is clicked', () => {
    render(<Sidebar {...mockProps} />);
    const newChatButton = screen.getByText('New Chat');
    fireEvent.click(newChatButton);
    expect(mockProps.onNewChat).toHaveBeenCalledTimes(1);
  });

  test('displays chat items from props', () => {
    render(<Sidebar {...mockProps} />);
    expect(screen.getByText('Test Chat 1')).toBeInTheDocument();
    expect(screen.getByText('Test Chat 2')).toBeInTheDocument();
  });

  test('shows loading state when isLoading is true', () => {
    render(<Sidebar {...mockProps} isLoading={true} />);
    expect(screen.getByText('Creating...')).toBeInTheDocument();
  });
});
