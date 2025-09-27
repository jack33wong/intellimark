/**
 * Marking Middleware
 * 
 * PURPOSE: Shared middleware for common marking operations
 * REPLACES: Duplicate auth extraction and validation across endpoints
 * 
 * DESIGN PRINCIPLES:
 * - Fail fast: Clear validation errors
 * - Simple: Single middleware for all operations
 * - DRY: No code duplication
 */

import type { Request, Response, NextFunction } from 'express';

interface AuthData {
  userId: string;
  userEmail: string;
  isAuthenticated: boolean;
}

interface RequestMetadata {
  timestamp: string;
  userAgent?: string;
  ip?: string;
  [key: string]: any;
}

/**
 * Marking middleware - extracts auth and validates common fields
 */
export const markingMiddleware = (options: any = {}) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Extract authentication data
      (req as any).auth = {
        userId: (req as any).user?.uid || 'anonymous',
        userEmail: (req as any).user?.email || 'anonymous@example.com',
        isAuthenticated: !!(req as any).user?.uid
      };
      
      // Validate required fields based on request type
      const { imageData, message } = req.body;
      
      if (!imageData && !message) {
        return res.status(400).json({
          success: false,
          error: 'Either imageData or message is required'
        });
      }
      
      // Add request metadata
      (req as any).requestMetadata = {
        timestamp: new Date().toISOString(),
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        ...options
      };
      
      next();
    } catch (error: any) {
      console.error('❌ Marking middleware error:', error);
      return res.status(500).json({
        success: false,
        error: 'Middleware validation failed',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Contact support'
      });
    }
  };
};

/**
 * Optional marking middleware - for endpoints that don't require validation
 */
export const optionalMarkingMiddleware = () => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Just extract auth, no validation
      (req as any).auth = {
        userId: (req as any).user?.uid || 'anonymous',
        userEmail: (req as any).user?.email || 'anonymous@example.com',
        isAuthenticated: !!(req as any).user?.uid
      };
      
      next();
    } catch (error: any) {
      console.error('❌ Optional marking middleware error:', error);
      return res.status(500).json({
        success: false,
        error: 'Middleware error',
        details: process.env.NODE_ENV === 'development' ? error.message : 'Contact support'
      });
    }
  };
};
