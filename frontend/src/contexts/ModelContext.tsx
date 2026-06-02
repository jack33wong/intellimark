import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import apiClient from '../services/apiClient';

export interface UIModel {
  id: string;
  name: string;
  label: string;
  description: string;
}

interface ModelContextType {
  models: UIModel[];
  defaultModel: string;
  isLoading: boolean;
  error: string | null;
}

const ModelContext = createContext<ModelContextType>({
  models: [],
  defaultModel: 'fast', // safe fallback
  isLoading: true,
  error: null,
});

export const useModels = () => useContext(ModelContext);

export const ModelProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [models, setModels] = useState<UIModel[]>([]);
  const [defaultModel, setDefaultModel] = useState<string>('fast');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchModels = async () => {
      try {
        const response = await apiClient.get('/api/config/models');
        const data = response.data;
        if (data && data.success && data.models) {
          setModels(data.models);
          setDefaultModel(data.defaultModel || 'fast');
        } else {
          console.error('Failed to load models configuration, falling back to empty array', data);
          // Set to empty array, UI should handle gracefully
          setModels([]);
        }
      } catch (err: any) {
        console.error('Failed to load models configuration:', err);
        setError(err.message || 'Failed to load models');
        // Do not inject fake models with hardcoded versions
        setModels([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchModels();
  }, []);

  return (
    <ModelContext.Provider value={{ models, defaultModel, isLoading, error }}>
      {children}
    </ModelContext.Provider>
  );
};
