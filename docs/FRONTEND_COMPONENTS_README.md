# MathRenderer Component

A TypeScript React component for safely rendering LaTeX mathematical expressions using KaTeX.

## Features

- ✅ **TypeScript Support**: Fully typed with proper interfaces
- ✅ **Error Handling**: Graceful handling of invalid LaTeX expressions
- ✅ **Performance**: Uses `useMemo` for efficient re-rendering
- ✅ **Flexible Display**: Supports both inline and block math modes
- ✅ **Safe Rendering**: Prevents crashes from malformed LaTeX

## Installation

The component requires the following dependencies (already installed):

```bash
npm install katex react-katex
npm install --save-dev typescript @types/react @types/react-dom
```

## Usage

### Basic Usage

```tsx
import React from 'react';
import MathRenderer from './components/MathRenderer';

const MyComponent: React.FC = () => {
  return (
    <div>
      <h1>Mathematical Expression</h1>
      <MathRenderer expression="x^2 + y^2 = z^2" />
    </div>
  );
};
```

### Inline vs Block Mode

```tsx
// Block mode (default) - centered on its own line
<MathRenderer expression="\\frac{1}{2}" displayMode="block" />

// Inline mode - flows with text
<p>
  The value is <MathRenderer expression="\\frac{1}{2}" displayMode="inline" /> 
  which equals 0.5.
</p>
```

### Error Handling

The component automatically handles invalid LaTeX expressions:

```tsx
// This will display an error message instead of crashing
<MathRenderer expression="\\frac{1}{2" /> // Missing closing brace
<MathRenderer expression="\\invalidcommand{test}" /> // Unknown command
<MathRenderer expression="" /> // Empty expression
```

## Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `expression` | `string` | Required | The LaTeX expression to render |
| `displayMode` | `'inline' \| 'block'` | `'block'` | How to display the math |
| `className` | `string` | `''` | Additional CSS classes |

## Examples

### Basic Mathematical Expressions

```tsx
// Simple arithmetic
<MathRenderer expression="2 + 2 = 4" />

// Exponents and roots
<MathRenderer expression="x^2 + y^2 = z^2" />
<MathRenderer expression="\\sqrt{16} = 4" />

// Fractions
<MathRenderer expression="\\frac{1}{2}" />
<MathRenderer expression="\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" />
```

### Greek Letters and Symbols

```tsx
<MathRenderer expression="\\pi" />
<MathRenderer expression="\\alpha + \\beta = \\gamma" />
<MathRenderer expression="\\theta \\approx 3.14159" />
```

### Summations and Integrals

```tsx
// Summation
<MathRenderer expression="\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}" />

// Integral
<MathRenderer expression="\\int_{0}^{\\infty} e^{-x} dx = 1" />
```

### Matrices

```tsx
// Matrix
<MathRenderer expression="\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}" />

// Determinant
<MathRenderer expression="\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}" />
```

## Error Handling

When an invalid LaTeX expression is provided, the component will:

1. Log the error to the console
2. Display a user-friendly error message
3. Show the original expression that caused the error
4. Continue rendering the rest of the component

Example error output:
```
Invalid LaTeX: \frac{1}{2
Error: KaTeX parse error: Expected '}', got 'EOF' at position 8: \frac{1}{2
```

## Performance Considerations

- The component uses `useMemo` to prevent unnecessary re-renders
- Only re-renders when the expression, display mode, or className changes
- KaTeX CSS is imported once at the component level

## Styling

The component includes basic styling for error states. You can customize the appearance by:

1. Adding custom CSS classes via the `className` prop
2. Styling the `.math-renderer` and `.latex-error` classes
3. Overriding KaTeX's default styles

## Troubleshooting

### Common Issues

1. **"Cannot read properties of null (reading 'useMemo')"**
   - Ensure React 18+ is installed
   - Check that TypeScript types are properly installed
   - Verify that `react-katex` is installed

2. **LaTeX not rendering**
   - Check that the expression is valid LaTeX
   - Ensure KaTeX CSS is imported
   - Verify that the expression is not empty

3. **TypeScript errors**
   - Ensure `@types/react` and `@types/react-dom` are installed
   - Check that `tsconfig.json` is properly configured

### Debug Mode

To enable debug logging, you can modify the component to log all expressions:

```tsx
const MathRenderer: React.FC<MathRendererProps> = ({ expression, ...props }) => {
  console.log('Rendering LaTeX:', expression); // Add this line
  // ... rest of component
};
```

## License

This component is part of the AI Marking Chat application and follows the same license terms.

