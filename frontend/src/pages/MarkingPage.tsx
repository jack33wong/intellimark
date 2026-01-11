/**
 * MarkingPage Component (TypeScript)
 * The main container for the marking and chat interface.
 */
import React from 'react';
import MainLayout from '../components/marking/MainLayout';
import { useMarkingPage } from '../contexts/MarkingPageContext';

interface MarkingPageProps {
  noIndex?: boolean;
}

const MarkingPage: React.FC<MarkingPageProps> = ({ noIndex = false }) => {
  // All state and logic are provided by the context.
  // The useMarkingPage hook is already typed, so we get full type safety here.
  const context = useMarkingPage();

  return <MainLayout {...(context as any)} noIndex={noIndex} />;
};

export default MarkingPage;
