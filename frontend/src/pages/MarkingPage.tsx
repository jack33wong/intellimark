/**
 * MarkingPage Component (TypeScript)
 * The main container for the marking and chat interface.
 */
import React from 'react';
import MainLayout from '../components/marking/MainLayout';
import { useMarkingPage } from '../contexts/MarkingPageContext';

const MarkingPage: React.FC = () => {
  // All state and logic are provided by the context.
  // The useMarkingPage hook is already typed, so we get full type safety here.
  const context = useMarkingPage();

  // The spread operator works here because MainLayout is now a TypeScript
  // component that expects the props provided by the context.
  // We will need to migrate MainLayout next to make this fully typed.
  return <MainLayout {...(context as any)} />;
};

export default MarkingPage;
