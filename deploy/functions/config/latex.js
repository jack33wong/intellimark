export class LaTeXConfigService {
    static getDefaultDelimiters() {
        return { ...this.DEFAULT_DELIMITERS };
    }
    static getDefaultMathJaxConfig() {
        return { ...this.DEFAULT_MATHJAX_CONFIG };
    }
    static generateMathJaxConfig(delimiters = this.DEFAULT_DELIMITERS) {
        const config = { ...this.DEFAULT_MATHJAX_CONFIG };
        if (delimiters.inline && delimiters.inline.length === 2) {
            config.tex.inlineMath = [delimiters.inline];
        }
        if (delimiters.display && delimiters.display.length === 2) {
            config.tex.displayMath = [delimiters.display];
        }
        if (delimiters.custom) {
            delimiters.custom.forEach(custom => {
                if (custom.display) {
                    config.tex.displayMath.push([custom.left, custom.right]);
                }
                else {
                    config.tex.inlineMath.push([custom.left, custom.right]);
                }
            });
        }
        return config;
    }
    static generateMathJaxScript(config = this.DEFAULT_MATHJAX_CONFIG) {
        const configJson = JSON.stringify(config, null, 2);
        return `
      <script>
        window.MathJax = ${configJson};
      </script>
      <script async src="https://polyfill.io/v3/polyfill.min.js?features=es6"></script>
      <script async id="MathJax-script" src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-mml-chtml.js"></script>
    `;
    }
    static generateDefaultMathJaxScript() {
        return this.generateMathJaxScript(this.DEFAULT_MATHJAX_CONFIG);
    }
    static extractLaTeXExpressions(text, delimiters = this.DEFAULT_DELIMITERS) {
        const expressions = [];
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
        return expressions.sort((a, b) => a.startIndex - b.startIndex);
    }
    static validateLaTeXExpression(expression) {
        const errors = [];
        if (!expression || expression.trim().length === 0) {
            errors.push('Expression is empty');
            return { isValid: false, errors };
        }
        const braceStack = [];
        for (let i = 0; i < expression.length; i++) {
            const char = expression[i];
            if (char === '{') {
                braceStack.push(char);
            }
            else if (char === '}') {
                if (braceStack.length === 0) {
                    errors.push(`Unmatched closing brace at position ${i}`);
                }
                else {
                    braceStack.pop();
                }
            }
        }
        if (braceStack.length > 0) {
            errors.push(`Unmatched opening braces: ${braceStack.length} remaining`);
        }
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
    static getRenderingOptions(context = 'chat') {
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
    static generateLaTeXCSS() {
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
LaTeXConfigService.DEFAULT_DELIMITERS = {
    inline: ['$', '$'],
    display: ['$$', '$$'],
    custom: [
        { left: '\\[', right: '\\]', display: true },
        { left: '\\(', right: '\\)', display: false }
    ]
};
LaTeXConfigService.DEFAULT_MATHJAX_CONFIG = {
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
