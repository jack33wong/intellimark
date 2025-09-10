# Frontend Refactoring Guide

## Overview
This document outlines the refactoring changes made to improve the frontend code structure, maintainability, and performance.

## New Structure

```
frontend/src/
├── components/
│   ├── common/           # Reusable UI components
│   │   ├── Button.js
│   │   ├── Button.css
│   │   ├── Modal.js
│   │   ├── Modal.css
│   │   ├── LoadingSpinner.js
│   │   ├── LoadingSpinner.css
│   │   └── index.js
│   ├── marking/          # Marking-specific components
│   │   ├── ImageUpload.js
│   │   ├── ImageUpload.css
│   │   ├── ChatInterface.js
│   │   ├── ChatInterface.css
│   │   ├── MarkHomeworkPage.js
│   │   ├── MarkHomeworkPage.css
│   │   └── index.js
│   └── [other components...]
├── hooks/                # Custom React hooks
│   ├── useLocalStorage.js
│   ├── useDebounce.js
│   ├── useAsync.js
│   ├── useFirestoreChat.js
│   └── index.js
├── utils/                # Utility functions
│   ├── constants.js
│   ├── helpers.js
│   └── index.js
├── types/                # TypeScript type definitions
│   ├── components.ts
│   ├── api.ts
│   ├── payment.ts
│   └── index.ts
└── [other directories...]
```

## Key Improvements

### 1. Component Extraction
- **Button**: Reusable button component with variants and states
- **Modal**: Reusable modal component with accessibility features
- **LoadingSpinner**: Consistent loading indicators
- **ImageUpload**: Dedicated image upload component
- **ChatInterface**: Separated chat functionality

### 2. Custom Hooks
- **useLocalStorage**: Manage localStorage with React state
- **useDebounce**: Debounce values and callbacks
- **useAsync**: Handle async operations with loading/error states
- **useFirestoreChat**: Existing chat management hook

### 3. Utility Functions
- **constants.js**: Centralized application constants
- **helpers.js**: Reusable utility functions
- **Type definitions**: TypeScript interfaces for better type safety

### 4. Code Organization
- **Barrel exports**: Clean import statements
- **Separation of concerns**: Business logic separated from UI
- **Consistent naming**: Clear, descriptive component and function names
- **CSS organization**: Component-specific stylesheets

## Benefits

### Maintainability
- Smaller, focused components are easier to understand and modify
- Clear separation of concerns reduces coupling
- Consistent patterns make code predictable

### Reusability
- Common components can be used across the application
- Utility functions eliminate code duplication
- Custom hooks encapsulate complex logic

### Performance
- Smaller components enable better React optimization
- Custom hooks prevent unnecessary re-renders
- Lazy loading opportunities for large components

### Developer Experience
- TypeScript types provide better IDE support
- Clear file structure makes navigation easier
- Consistent patterns reduce cognitive load

## Migration Guide

### Using New Components

```javascript
// Old way
import Button from '../common/Button';
import Modal from '../common/Modal';

// New way (with barrel exports)
import { Button, Modal } from '../common';
```

### Using Custom Hooks

```javascript
// Local storage
const [theme, setTheme] = useLocalStorage('theme', 'light');

// Debounced search
const debouncedSearchTerm = useDebounce(searchTerm, 300);

// Async operations
const { data, loading, error, execute } = useAsync(fetchData);
```

### Using Utility Functions

```javascript
// Constants
import { API_ENDPOINTS, SUBSCRIPTION_PLANS } from '../utils/constants';

// Helpers
import { generateId, formatFileSize, debounce } from '../utils/helpers';
```

## Future Improvements

### 1. Complete TypeScript Migration
- Convert all .js files to .ts/.tsx
- Add comprehensive type definitions
- Enable strict TypeScript checking

### 2. Performance Optimization
- Implement React.memo for expensive components
- Add lazy loading for route components
- Optimize bundle size with code splitting

### 3. Testing
- Add unit tests for utility functions
- Add component tests for common components
- Add integration tests for complex workflows

### 4. Accessibility
- Add ARIA labels and roles
- Implement keyboard navigation
- Add screen reader support

### 5. State Management
- Consider Redux Toolkit for complex state
- Implement proper error boundaries
- Add loading states for all async operations

## Best Practices

### Component Design
- Keep components small and focused
- Use composition over inheritance
- Prefer props over context when possible
- Use TypeScript for better type safety

### Hook Usage
- Use custom hooks to extract complex logic
- Follow the rules of hooks
- Use useCallback and useMemo appropriately
- Avoid unnecessary dependencies

### File Organization
- Group related files together
- Use barrel exports for clean imports
- Keep component files close to their styles
- Use consistent naming conventions

### Performance
- Use React.memo for expensive components
- Implement proper key props for lists
- Avoid inline object/function creation in render
- Use useCallback for event handlers passed to children
