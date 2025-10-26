/**
 * Filename Service for consistent filename generation
 * Handles all filename patterns for maintainability
 */

/**
 * Generate annotated filename with proper pattern
 * Pattern: annotated-{originalBaseName}-{timestamp}-{random}{originalFileExt}
 */
export class FilenameService {
  /**
   * Generate annotated filename
   * @param originalFileName - Original filename (e.g., "q21-edexcel-ball-pen-stroke.png")
   * @param timestamp - Timestamp for uniqueness
   * @returns Annotated filename (e.g., "annotated-q21-edexcel-ball-pen-stroke-1761486663043-a1b2c3.png")
   */
  static generateAnnotatedFilename(originalFileName: string, timestamp?: number): string {
    const ts = timestamp || Date.now();
    const random = Math.random().toString(36).substr(2, 6);
    
    // Extract base name and extension
    const lastDotIndex = originalFileName.lastIndexOf('.');
    const baseName = lastDotIndex > 0 ? originalFileName.substring(0, lastDotIndex) : originalFileName;
    const extension = lastDotIndex > 0 ? originalFileName.substring(lastDotIndex) : '';
    
    return `annotated-${baseName}-${ts}-${random}${extension}`;
  }

  /**
   * Generate original filename (preserve original)
   * @param originalFileName - Original filename
   * @returns Same filename (for consistency)
   */
  static generateOriginalFilename(originalFileName: string): string {
    return originalFileName;
  }

  /**
   * Extract base name from filename
   * @param fileName - Full filename
   * @returns Base name without extension
   */
  static getBaseName(fileName: string): string {
    const lastDotIndex = fileName.lastIndexOf('.');
    return lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;
  }

  /**
   * Extract extension from filename
   * @param fileName - Full filename
   * @returns File extension (including dot)
   */
  static getExtension(fileName: string): string {
    const lastDotIndex = fileName.lastIndexOf('.');
    return lastDotIndex > 0 ? fileName.substring(lastDotIndex) : '';
  }
}
