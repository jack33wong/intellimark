import React from 'react';
import MainLayout from '../components/marking/MainLayout';
import { useMarkingPage } from '../contexts/MarkingPageContext';

const MarkingPage = () => {
  // All state and functions are now provided by our custom hook
  const context = useMarkingPage();

  // We simply pass all the context values to the MainLayout
  return <MainLayout {...context} />;
};

export default MarkingPage;