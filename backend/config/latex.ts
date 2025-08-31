/**
 * LaTeX Rendering Configuration for Mark Homework System
 * MathJax setup, LaTeX delimiters, and rendering options
 */

/**
 * LaTeX delimiters configuration
 */
export interface LaTeXDelimiters {
  inline: string[];
  display: string[];
  custom?: Array<{
    left: string;
    right: string;
    display: boolean;
  }>;
}

/**
 * MathJax configuration options
 */
export interface MathJaxConfig {
  tex: {
    inlineMath: string[][];
    displayMath: string[][];
    processEscapes: boolean;
    processEnvironments: boolean;
    packages: string[];
  };
  options: {
    skipHtmlTags: string[];
    ignoreHtmlClass: string;
    processHtmlClass: string;
  };
  startup: {
    pageReady: () => void;
  };
}

/**
 * LaTeX rendering configuration service
 */
export class LaTeXConfigService {
  private static readonly DEFAULT_DELIMITERS: LaTeXDelimiters = {
    inline: ['$', '$'],
    display: ['$$', '$$'],
    custom: [
      { left: '\\[', right: '\\]', display: true },
      { left: '\\(', right: '\\)', display: false }
    ]
  };

  private static readonly DEFAULT_MATHJAX_CONFIG: MathJaxConfig = {
    tex: {
      inlineMath: [['$', '$']],
      displayMath: [['$$', '$$']],
      processEscapes: true,
      processEnvironments: true,
      packages: [
        'base',
        'ams',
        'noerrors',
        'noundefined'
      ]
    },
    options: {
      skipHtmlTags: ['script', 'noscript', 'style', 'textarea', 'pre'],
      ignoreHtmlClass: 'tex2jax_ignore',
      processHtmlClass: 'tex2jax_process'
    },
    startup: {
      pageReady: () => {
        console.log('MathJax is ready');
      }
    }
  };

  /**
   * Get default LaTeX delimiters
   * @returns Default delimiters configuration
   */
  static getDefaultDelimiters(): LaTeXDelimiters {
    return { ...this.DEFAULT_DELIMITERS };
  }

  /**
   * Get default MathJax configuration
   * @returns Default MathJax configuration
   */
  static getDefaultMathJaxConfig(): MathJaxConfig {
    return { ...this.DEFAULT_MATHJAX_CONFIG };
  }

  /**
   * Generate MathJax configuration with custom delimiters
   * @param delimiters - Custom LaTeX delimiters
   * @returns MathJax configuration object
   */
  static generateMathJaxConfig(delimiters: LaTeXDelimiters = this.DEFAULT_DELIMITERS): MathJaxConfig {
    const config = { ...this.DEFAULT_MATHJAX_CONFIG };

    // Update inline math delimiters
    if (delimiters.inline && delimiters.inline.length === 2) {
      config.tex.inlineMath = [delimiters.inline];
    }

    // Update display math delimiters
    if (delimiters.display && delimiters.display.length === 2) {
      config.tex.displayMath = [delimiters.display];
    }

    // Add custom delimiters
    if (delimiters.custom) {
      delimiters.custom.forEach(custom => {
        if (custom.display) {
          config.tex.displayMath.push([custom.left, custom.right]);
        } else {
          config.tex.inlineMath.push([custom.left, custom.right]);
        }
      });
    }

    return config;
  }

  /**
   * Generate MathJax script tag with configuration
   * @param config - MathJax configuration
   * @returns HTML script tag string
   */
  static generateMathJaxScript(config: MathJaxConfig = this.DEFAULT_MATHJAX_CONFIG): string {
    const configJson = JSON.stringify(config, null, 2);
    
    return `
      <script>
        window.MathJax = ${configJson};
      </script>
      <script async src="https://polyfill.io/v3/polyfill.min.js?features=es6"></script>
      <script async id="MathJax-script" src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
    `;
  }

  /**
   * Generate MathJax script tag with default configuration
   * @returns HTML script tag string
   */
  static generateDefaultMathJaxScript(): string {
    return this.generateMathJaxScript(this.DEFAULT_MATHJAX_CONFIG);
  }

  /**
   * Extract LaTeX expressions from text
   * @param text - Text to search for LaTeX expressions
   * @param delimiters - LaTeX delimiters to use
   * @returns Array of found LaTeX expressions
   */
  static extractLaTeXExpressions(
    text: string, 
    delimiters: LaTeXDelimiters = this.DEFAULT_DELIMITERS
  ): Array<{
    expression: string;
    isDisplay: boolean;
    startIndex: number;
    endIndex: number;
  }> {
    const expressions: Array<{
      expression: string;
      isDisplay: boolean;
      startIndex: number;
      endIndex: number;
    }> = [];

    // Search for inline math
    if (delimiters.inline && delimiters.inline.length === 2) {
      const [left, right] = delimiters.inline;
      if (left && right) {
        const regex = new RegExp(`\\${left.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(.*?)\\${right.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
        
        let match;
        while ((match = regex.exec(text)) !== null) {
          if (match[1]) {
            expressions.push({
              expression: match[1],
              isDisplay: false,
              startIndex: match.index,
              endIndex: match.index + match[0].length
            });
          }
        }
      }
    }

    // Search for display math
    if (delimiters.display && delimiters.display.length === 2) {
      const [left, right] = delimiters.display;
      if (left && right) {
        const regex = new RegExp(`\\${left.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(.*?)\\${right.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
        
        let match;
        while ((match = regex.exec(text)) !== null) {
          if (match[1]) {
            expressions.push({
              expression: match[1],
              isDisplay: true,
              startIndex: match.index,
              endIndex: match.index + match[0].length
        });
          }
        }
      }
    }

    // Search for custom delimiters
    if (delimiters.custom) {
      delimiters.custom.forEach(custom => {
        if (custom.left && custom.right) {
          const regex = new RegExp(`\\${custom.left.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(.*?)\\${custom.right.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g');
          
          let match;
          while ((match = regex.exec(text)) !== null) {
            if (match[1]) {
              expressions.push({
                expression: match[1],
                isDisplay: custom.display,
                startIndex: match.index,
                endIndex: match.index + match[0].length
              });
            }
          }
        }
      });
    }

    // Sort by start index to maintain order
    return expressions.sort((a, b) => a.startIndex - b.startIndex);
  }

  /**
   * Validate LaTeX expression syntax
   * @param expression - LaTeX expression to validate
   * @returns Validation result with errors if any
   */
  static validateLaTeXExpression(expression: string): {
    isValid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (!expression || expression.trim().length === 0) {
      errors.push('Expression is empty');
      return { isValid: false, errors };
    }

    // Check for unmatched braces
    const braceStack: string[] = [];
    for (let i = 0; i < expression.length; i++) {
      const char = expression[i];
      if (char === '{') {
        braceStack.push(char);
      } else if (char === '}') {
        if (braceStack.length === 0) {
          errors.push(`Unmatched closing brace at position ${i}`);
        } else {
          braceStack.pop();
        }
      }
    }

    if (braceStack.length > 0) {
      errors.push(`Unmatched opening braces: ${braceStack.length} remaining`);
    }

    // Check for common LaTeX syntax issues
    const commonIssues = [
      { pattern: /\\[a-zA-Z]+\s*\{/, description: 'Command without closing brace' },
      { pattern: /\\[a-zA-Z]+\s*$/, description: 'Command at end of expression' },
      { pattern: /\^\s*\{/, description: 'Superscript without closing brace' },
      { pattern: /_\s*\{/, description: 'Subscript without closing brace' }
    ];

    commonIssues.forEach(issue => {
      if (issue.pattern.test(expression)) {
        errors.push(issue.description);
      }
    });

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Get LaTeX rendering options for different contexts
   * @param context - Rendering context
   * @returns Rendering options
   */
  static getRenderingOptions(context: 'chat' | 'homework' | 'preview' = 'chat'): {
    enableAnimations: boolean;
    showErrors: boolean;
    timeout: number;
    retryAttempts: number;
  } {
    switch (context) {
      case 'chat':
        return {
          enableAnimations: true,
          showErrors: false,
          timeout: 5000,
          retryAttempts: 2
        };
      case 'homework':
        return {
          enableAnimations: false,
          showErrors: true,
          timeout: 10000,
          retryAttempts: 3
        };
      case 'preview':
        return {
          enableAnimations: false,
          showErrors: false,
          timeout: 3000,
          retryAttempts: 1
        };
      default:
        return {
          enableAnimations: true,
          showErrors: false,
          timeout: 5000,
          retryAttempts: 2
        };
    }
  }

  /**
   * Generate CSS for LaTeX rendering
   * @returns CSS string for LaTeX styling
   */
  static generateLaTeXCSS(): string {
    return `
      .latex-expression {
        font-family: 'Computer Modern', 'Times New Roman', serif;
        line-height: 1.2;
      }
      
      .latex-inline {
        display: inline;
        vertical-align: middle;
      }
      
      .latex-display {
        display: block;
        text-align: center;
        margin: 1em 0;
      }
      
      .latex-error {
        color: #d32f2f;
        background-color: #ffebee;
        padding: 4px 8px;
        border-radius: 4px;
        font-family: monospace;
        font-size: 0.9em;
      }
      
      .latex-loading {
        color: #1976d2;
        font-style: italic;
      }
    `;
  }
}
