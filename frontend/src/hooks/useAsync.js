import { useState, useEffect, useCallback } from 'react';

/**
 * Custom hook for handling async operations
 * @param {Function} asyncFunction - Async function to execute
 * @param {Array} deps - Dependencies array
 * @param {boolean} immediate - Whether to execute immediately
 * @returns {Object} Async state and controls
 */
export const useAsync = (asyncFunction, deps = [], immediate = true) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const execute = useCallback(async (...args) => {
    try {
      setLoading(true);
      setError(null);
      const result = await asyncFunction(...args);
      setData(result);
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [asyncFunction]);

  const reset = useCallback(() => {
    setData(null);
    setError(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (immediate) {
      execute();
    }
  }, [execute, immediate]);

  return {
    data,
    loading,
    error,
    execute,
    reset
  };
};

/**
 * Custom hook for handling async operations with retry
 * @param {Function} asyncFunction - Async function to execute
 * @param {number} retries - Number of retries
 * @param {number} delay - Delay between retries
 * @param {Array} deps - Dependencies array
 * @returns {Object} Async state and controls
 */
export const useAsyncWithRetry = (asyncFunction, retries = 3, delay = 1000, deps = []) => {
  const [retryCount, setRetryCount] = useState(0);
  
  const executeWithRetry = useCallback(async (...args) => {
    let lastError;
    
    for (let i = 0; i <= retries; i++) {
      try {
        const result = await asyncFunction(...args);
        setRetryCount(0);
        return result;
      } catch (error) {
        lastError = error;
        setRetryCount(i + 1);
        
        if (i < retries) {
          await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
        }
      }
    }
    
    throw lastError;
  }, [asyncFunction, retries, delay]);

  const asyncState = useAsync(executeWithRetry, deps, false);

  return {
    ...asyncState,
    retryCount,
    maxRetries: retries
  };
};
