// Quick ESLint rule to catch missing required props
module.exports = {
  rules: {
    // Custom rule to warn about missing required props
    'react/require-default-props': 'error',
    'react/prop-types': 'error',
    'react/no-unused-prop-types': 'warn'
  }
};
