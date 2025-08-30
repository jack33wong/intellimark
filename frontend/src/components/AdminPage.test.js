import React from 'react';
import { render, screen } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import AdminPage from './AdminPage';

// Mock the lucide-react icons
jest.mock('lucide-react', () => ({
  Upload: ({ size, children, ...props }) => (
    <div data-testid="upload" {...props}>{children}</div>
  ),
  FileText: ({ size, children, ...props }) => (
    <div data-testid="file-text" {...props}>{children}</div>
  ),
  Trash2: ({ size, children, ...props }) => (
    <div data-testid="trash" {...props}>{children}</div>
  ),
  Edit: ({ size, children, ...props }) => (
    <div data-testid="edit" {...props}>{children}</div>
  ),
  Download: ({ size, children, ...props }) => (
    <div data-testid="download" {...props}>{children}</div>
  ),
  Search: ({ size, children, ...props }) => (
    <div data-testid="search" {...props}>{children}</div>
  ),
  Filter: ({ size, children, ...props }) => (
    <div data-testid="filter" {...props}>{children}</div>
  ),
  Plus: ({ size, children, ...props }) => (
    <div data-testid="plus" {...props}>{children}</div>
  ),
  ArrowLeft: ({ size, children, ...props }) => (
    <div data-testid="arrow-left" {...props}>{children}</div>
  ),
  Calendar: ({ size, children, ...props }) => (
    <div data-testid="calendar" {...props}>{children}</div>
  ),
  BookOpen: ({ size, children, ...props }) => (
    <div data-testid="book-open" {...props}>{children}</div>
  ),
}));

// Mock fetch
global.fetch = jest.fn();

// Wrapper component to provide router context
const AdminPageWithRouter = () => (
  <BrowserRouter>
    <AdminPage />
  </BrowserRouter>
);

describe('AdminPage Component', () => {
  beforeEach(() => {
    fetch.mockClear();
    
    // Mock successful API responses
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => []
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => []
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => []
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => []
    });
  });

  test('renders admin header with title', () => {
    render(<AdminPageWithRouter />);
    expect(screen.getByText('Admin Dashboard - Past Papers Management')).toBeInTheDocument();
  });

  test('renders back to chat button', () => {
    render(<AdminPageWithRouter />);
    expect(screen.getByText('Back to Chat')).toBeInTheDocument();
  });

  test('renders upload new paper button', () => {
    render(<AdminPageWithRouter />);
    expect(screen.getByText('Upload New Paper')).toBeInTheDocument();
  });

  test('renders filters section', () => {
    render(<AdminPageWithRouter />);
    expect(screen.getByText('Filters')).toBeInTheDocument();
  });

  test('renders papers section', () => {
    render(<AdminPageWithRouter />);
    expect(screen.getByText('Past Papers (0)')).toBeInTheDocument();
  });

  test('shows no papers message initially', () => {
    render(<AdminPageWithRouter />);
    expect(screen.getByText(/No past papers found/)).toBeInTheDocument();
  });

  test('renders search filter', () => {
    render(<AdminPageWithRouter />);
    expect(screen.getByPlaceholderText('Search papers...')).toBeInTheDocument();
  });

  test('renders exam board filter', () => {
    render(<AdminPageWithRouter />);
    expect(screen.getByText('All Exam Boards')).toBeInTheDocument();
  });

  test('renders year filter', () => {
    render(<AdminPageWithRouter />);
    expect(screen.getByText('All Years')).toBeInTheDocument();
  });

  test('renders subject filter', () => {
    render(<AdminPageWithRouter />);
    expect(screen.getByText('All Subjects')).toBeInTheDocument();
  });
});
