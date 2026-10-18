import { useState, useCallback } from 'react';
import { trackFunnelEvent } from '../utils/funnelTracker';

// Define the shape of the state managed by this hook
interface ImageUploadState {
  selectedFile: File | null;
  previewUrl: string | null;
  error: string | null;
}

export const useImageUpload = () => {
  const [state, setState] = useState<ImageUploadState>({
    selectedFile: null,
    previewUrl: null,
    error: null,
  });

  const handleFileSelect = useCallback((file: File) => {
    // Basic file validation
    if (!file.type.startsWith('image/')) {
      trackFunnelEvent('client_file_rejected', {
        reason: 'unsupported_type_or_size',
        fileName: file?.name || 'unknown',
        fileType: file?.type || 'unknown',
        fileSize: file?.size || 0
      });
      setState(prev => ({ ...prev, error: 'Please select a valid image file.' }));
      return;
    }
    
    const reader = new FileReader();
    reader.onloadend = () => {
      setState({
        selectedFile: file,
        previewUrl: reader.result as string,
        error: null,
      });
    };
    reader.onerror = () => {
        setState(prev => ({ ...prev, error: 'Failed to read file.' }));
    };
    reader.readAsDataURL(file);
  }, []);

  const clearFile = useCallback(() => {
    setState({
      selectedFile: null,
      previewUrl: null,
      error: null,
    });
  }, []);

  const processImage = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') {
          resolve(reader.result);
        } else {
          reject(new Error('Failed to process image file.'));
        }
      };
      reader.onerror = (error) => reject(error);
      reader.readAsDataURL(file);
    });
  }, []);
  
  return {
    ...state,
    handleFileSelect,
    clearFile,
    processImage,
  };
};
