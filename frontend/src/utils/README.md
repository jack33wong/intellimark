# LaTeX Renderer Utility

A modular and reusable LaTeX rendering utility for React applications using KaTeX.

## Features

- ✅ Automatic delimiter detection (`\[ \]`, `\( \)`, `$$ $$`, `$ $`)
- ✅ Support for both inline and block math
- ✅ Error handling for invalid LaTeX
- ✅ Multiple usage patterns (component, hook, utility function)
- ✅ Easy to import and use anywhere in your application

## Installation

Make sure you have the required dependencies:

```bash
npm install katex react-katex
```

## Usage

### 1. Component Usage (Recommended)

```jsx
import { MathRenderer } from '../utils/latexRenderer';

function MyComponent() {
  return (
    <div>
      {/* Block math */}
      <MathRenderer expression="E = mc^2" displayMode="block" />
      
      {/* Inline math */}
      <MathRenderer expression="x^2 + y^2 = z^2" displayMode="inline" />
      
      {/* With automatic delimiter detection */}
      <MathRenderer expression="\\[E = mc^2\\]" />
      <MathRenderer expression="\\(x^2 + y^2 = z^2\\)" />
    </div>
  );
}
```

### 2. Hook Usage

```jsx
import { useLatexRenderer } from '../utils/latexRenderer';

function MyComponent() {
  const { renderedComponent, displayMode } = useLatexRenderer("\\[E = mc^2\\]");
  
  return (
    <div>
      {renderedComponent}
      <p>Display mode: {displayMode}</p>
    </div>
  );
}
```

### 3. Utility Function

```jsx
import { processLatexExpression } from '../utils/latexRenderer';

function MyComponent() {
  const { processedExpression, displayMode } = processLatexExpression("\\[E = mc^2\\]");
  
  console.log('Processed:', processedExpression); // "E = mc^2"
  console.log('Mode:', displayMode); // "block"
  
  return <div>...</div>;
}
```

## Supported Delimiters

| Delimiter | Type | Example |
|-----------|------|---------|
| `\[ \]` | Block | `\[E = mc^2\]` |
| `\( \)` | Inline | `\(x^2 + y^2 = z^2\)` |
| `$$ $$` | Block | `$$E = mc^2$$` |
| `$ $` | Inline | `$x^2 + y^2 = z^2$` |
| None | Uses `displayMode` prop | `E = mc^2` |

## API Reference

### MathRenderer Component

```jsx
<MathRenderer 
  expression="string"           // LaTeX expression to render
  displayMode="block|inline"    // Default: "block"
  className="string"           // Additional CSS classes
/>
```

### useLatexRenderer Hook

```jsx
const { 
  renderedComponent,           // React component to render
  displayMode,                 // Detected or fallback display mode
  processedExpression          // Expression with delimiters removed
} = useLatexRenderer(
  expression,                  // LaTeX expression
  fallbackDisplayMode         // Default: "block"
);
```

### processLatexExpression Function

```jsx
const { 
  processedExpression,         // Expression with delimiters removed
  displayMode                  // Detected display mode or null
} = processLatexExpression(expression);
```

## Error Handling

The renderer automatically handles invalid LaTeX expressions and displays error messages:

```jsx
<MathRenderer expression="\\invalid{command}" />
// Renders: "Invalid LaTeX: \invalid{command}"
```

## Examples

### Inline Math in Text

```jsx
<p>
  The quadratic formula is: 
  <MathRenderer 
    expression="x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}" 
    displayMode="inline" 
  />
</p>
```

### Block Math with Delimiters

```jsx
<MathRenderer expression="\\[\\int_{0}^{\\infty} e^{-x} dx = 1\\]" />
```

### Multiple Expressions

```jsx
<div>
  <MathRenderer expression="\\[E = mc^2\\]" />
  <MathRenderer expression="\\(\\pi\\)" />
  <MathRenderer expression="$$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$" />
</div>
```

## Integration with Chat Interface

You can easily integrate this into your chat interface:

```jsx
import { MathRenderer } from '../utils/latexRenderer';

function ChatMessage({ message }) {
  // Parse message for LaTeX expressions and render them
  const renderMessage = (text) => {
    // Simple regex to find LaTeX expressions
    const latexRegex = /(\$[^$]+\$|\\[\(\[][^\]\)]+[\]\)])/g;
    
    return text.split(latexRegex).map((part, index) => {
      if (latexRegex.test(part)) {
        return <MathRenderer key={index} expression={part} />;
      }
      return part;
    });
  };

  return (
    <div className="message">
      {renderMessage(message.text)}
    </div>
  );
}
```

## Performance

- Uses `useMemo` for efficient re-rendering
- Only re-renders when expression or displayMode changes
- Lightweight utility functions for processing

