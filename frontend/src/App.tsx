import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { MarkingPageProvider } from './contexts/MarkingPageContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import OptionalAuthRoute from './components/auth/OptionalAuthRoute';
import { Sidebar, Header } from './components/layout';
import AdminPage from './components/admin/AdminPage';
import MarkingPage from './pages/MarkingPage';
import LibraryPage from './pages/LibraryPage';
import AnalysisPage from './pages/AnalysisPage';
import Login from './components/auth/Login';
import SubscriptionPage from './components/subscription/SubscriptionPage';
import MobileCameraPage from './pages/MobileCameraPage';
import UnifiedProfileModal from './components/profile/UnifiedProfileModal';
import GuestLimitModal from './components/common/GuestLimitModal';
import AnalyticsTracker from './components/common/AnalyticsTracker';
import AccuracyPage from './pages/AccuracyPage';
import ProgrammaticLandingPage from './pages/ProgrammaticLandingPage';
import SeoHeader from './components/common/SeoHeader';
import EventManager, { EVENT_TYPES } from './utils/eventManager';
import useTheme from './hooks/useTheme';
import HeroAnimation from './components/layout/HeroAnimation';
import LandingPage from './pages/LandingPage';
import { HelmetProvider } from 'react-helmet-async';
import ScrollToTop from './components/common/ScrollToTop';
import PrivacyPage from './pages/PrivacyPage';
import TermsPage from './pages/TermsPage';
import FeaturesPage from './pages/FeaturesPage';
import AboutPage from './pages/AboutPage';
import CompareChatGPTPage from './pages/CompareChatGPTPage';
import AqaLandingPage from './pages/AqaLandingPage';
import EdexcelLandingPage from './pages/EdexcelLandingPage';
import OcrLandingPage from './pages/OcrLandingPage';
import './App.css';

// Define the type for the marking result prop
interface MarkingResult {
  id: string;
}

// Layout wrapper moved outside to prevent infinite render loops
interface MainLayoutWrapperProps {
  children: React.ReactNode;
  hideHeader?: boolean;
  rightSideClass?: string;
  isSpecialRoute: boolean;
  isSidebarOpen: boolean;
  setIsSidebarOpen: (open: boolean) => void;
  handleMarkingHistoryClick: (result: any) => void;
  handleMarkHomeworkClick: () => void;
  handleMarkingResultSaved: () => void;
  isChatMode: boolean;
  isProcessing: boolean;
  isHistoryLoading: boolean;
}

const MainLayoutWrapper = ({
  children,
  hideHeader = false,
  rightSideClass = "",
  isSpecialRoute,
  isSidebarOpen,
  setIsSidebarOpen,
  handleMarkingHistoryClick,
  handleMarkHomeworkClick,
  handleMarkingResultSaved,
  isChatMode,
  isProcessing,
  isHistoryLoading
}: MainLayoutWrapperProps) => (
  <div className="app-body">
    {isSidebarOpen && window.innerWidth <= 768 && (
      <div className="mobile-sidebar-overlay" onClick={() => setIsSidebarOpen(false)} />
    )}
    {!isSpecialRoute && (
      <Sidebar
        isOpen={isSidebarOpen}
        onMarkingHistoryClick={handleMarkingHistoryClick}
        onMarkHomeworkClick={handleMarkHomeworkClick}
        onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)}
        onMarkingResultSaved={handleMarkingResultSaved}
      />
    )}
    <div className={`right-side ${rightSideClass}`}>
      {/* Full-panel Loading Overlay */}
      {isHistoryLoading && (
        <div className="history-loading-overlay">
          <div className="history-loading-content">
            <div className="loading-spinner" />
            <p className="loading-text">Loading History...</p>
          </div>
        </div>
      )}
      {!hideHeader && !isSpecialRoute && (
        <Header onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)} isSidebarOpen={isSidebarOpen} />
      )}
      <div className="main-content">
        {children}
      </div>
    </div>
  </div>
);

function AppContent() {
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(window.innerWidth > 768);
  const [selectedMarkingResult, setSelectedMarkingResult] = useState<MarkingResult | null>(null);
  const [markHomeworkResetKey, setMarkHomeworkResetKey] = useState<number>(0);
  const [isChatMode, setIsChatMode] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isHistoryLoading, setIsHistoryLoading] = useState<boolean>(false);

  const [autoSplit, setAutoSplit] = useState<boolean>(false);
  const [initialImageIndex, setInitialImageIndex] = useState<number>(0);
  const [isGuestLimitModalOpen, setIsGuestLimitModalOpen] = useState(false);

  // Listen for custom event to load marking session from other pages
  useEffect(() => {
    const handleLoadMarkingSession = async (event: CustomEvent<{
      session: MarkingResult & { id: string, messages?: any[] },
      autoSplit?: boolean,
      initialImageIndex?: number
    }>) => {
      const { session, autoSplit, initialImageIndex } = event.detail;

      // Set initial values
      setAutoSplit(autoSplit || false);
      setInitialImageIndex(initialImageIndex || 0);

      // If session is incomplete (missing messages), fetch it
      if (!session.messages) {
        try {
          const { simpleSessionService } = await import('./services/markingApiService');
          const response = await simpleSessionService.getSession(session.id);
          if (response.success && response.session) {
            setSelectedMarkingResult(response.session);
          } else {
            setSelectedMarkingResult(session);
          }
        } catch (error) {
          console.error('Error loading session from ID:', error);
          setSelectedMarkingResult(session);
        }
      } else {
        setSelectedMarkingResult(session);
      }
    };

    window.addEventListener('loadMarkingSession', handleLoadMarkingSession as any);

    // Listen for other UI events
    const cleanup = EventManager.listenToMultiple({
      [EVENT_TYPES.OPEN_GUEST_LIMIT_MODAL]: () => {
        setIsGuestLimitModalOpen(true);
      },
      [EVENT_TYPES.OPEN_AUTH_MODAL]: (event: any) => {
        const mode = event?.detail?.mode;
        navigate('/login', { state: { mode } });
      }
    });

    return () => {
      window.removeEventListener('loadMarkingSession', handleLoadMarkingSession as any);
      cleanup();
    };
  }, [navigate]);

  const handleMarkingHistoryClick = async (result: MarkingResult & { id: string }) => {
    setIsHistoryLoading(true);
    navigate('/app');
    try {
      const { simpleSessionService } = await import('./services/markingApiService');
      const response = await simpleSessionService.getSession(result.id);
      if (response.success && response.session) {
        setSelectedMarkingResult(response.session);
      } else {
        setSelectedMarkingResult(result);
      }
    } catch (error) {
      console.error('Error fetching session data:', error);
      setSelectedMarkingResult(result);
    } finally {
      setIsHistoryLoading(false);
    }
  };

  const handleMarkHomeworkClick = () => {
    setSelectedMarkingResult(null);
    setMarkHomeworkResetKey(prev => prev + 1);
  };

  // 👇 FIX: Add the missing handleMarkingResultSaved function.
  // This is required by the Sidebar's props, even if it's now obsolete.
  const handleMarkingResultSaved = () => {
    // This function is kept for prop compatibility. The event-driven
    // architecture in the sidebar handles the actual data refresh.
  };

  const location = useLocation();

  // Determine if we should hide the Sidebar/Header for certain routes
  const isSpecialRoute = ['/login', '/pricing'].includes(location.pathname);

  // Common props for the layout wrapper
  const layoutProps = {
    isSpecialRoute,
    isSidebarOpen,
    setIsSidebarOpen,
    handleMarkingHistoryClick,
    handleMarkHomeworkClick,
    handleMarkingResultSaved,
    isChatMode,
    isProcessing,
    isHistoryLoading
  };

  return (
    <div className="app-container">
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/pricing" element={
          <OptionalAuthRoute>
            <SubscriptionPage />
          </OptionalAuthRoute>
        } />
        <Route path="/upgrade" element={<Navigate to="/pricing" replace />} />

        <Route path="/library" element={
          <OptionalAuthRoute>
            <MainLayoutWrapper {...layoutProps} hideHeader={true}>
              <LibraryPage setSidebarOpen={setIsSidebarOpen} />
            </MainLayoutWrapper>
          </OptionalAuthRoute>
        } />

        <Route path="/analysis" element={
          <OptionalAuthRoute>
            <MainLayoutWrapper {...layoutProps} hideHeader={true}>
              <AnalysisPage setSidebarOpen={setIsSidebarOpen} />
            </MainLayoutWrapper>
          </OptionalAuthRoute>
        } />

        <Route path="/admin" element={
          <ProtectedRoute requireAdmin={true}>
            <MainLayoutWrapper {...layoutProps}>
              <AdminPage />
            </MainLayoutWrapper>
          </ProtectedRoute>
        } />


        <Route path="/app" element={
          <OptionalAuthRoute>
            <MainLayoutWrapper {...layoutProps} rightSideClass={isChatMode ? 'chat-mode' : ''}>
              <div className="mark-homework-main-content">
                <MarkingPageProvider
                  key={markHomeworkResetKey}
                  selectedMarkingResult={selectedMarkingResult}
                  isHistoryLoading={isHistoryLoading}
                  onPageModeChange={setIsChatMode}
                  onProcessingChange={setIsProcessing}
                  setSidebarOpen={setIsSidebarOpen}
                  autoSplit={autoSplit}
                  initialImageIndex={initialImageIndex}
                >
                  <MarkingPage noIndex={true} />
                </MarkingPageProvider>
              </div>
            </MainLayoutWrapper>
          </OptionalAuthRoute>
        } />


        <Route path="/accuracy" element={<AccuracyPage />} />

        {/* NEW Keyword-Rich SEO Routes */}
        <Route path="/mark-aqa-gcse-maths-past-papers" element={<AqaLandingPage />} />
        <Route path="/mark-edexcel-gcse-maths-past-papers" element={<EdexcelLandingPage />} />
        <Route path="/mark-ocr-gcse-maths-past-papers" element={<OcrLandingPage />} />

        <Route path="/mark-:examBoard-gcse-maths-past-papers" element={<ProgrammaticLandingPage />} />
        <Route path="/mark-:examBoard-gcse-maths-past-papers/:year" element={<ProgrammaticLandingPage />} />

        {/* Legacy SEO Routes (Keep for compatibility) */}
        <Route path="/gcse-maths-marking/:examBoard" element={<ProgrammaticLandingPage />} />
        <Route path="/gcse-maths-marking/:examBoard/:year" element={<ProgrammaticLandingPage />} />

        <Route path="/" element={<LandingPage />} />
        <Route path="/mobile-upload/:sessionId" element={<MobileCameraPage />} />

        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/features" element={<FeaturesPage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/compare/vs-chatgpt" element={<CompareChatGPTPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <GuestLimitModal
        isOpen={isGuestLimitModalOpen}
        onClose={() => setIsGuestLimitModalOpen(false)}
      />
    </div>
  );
}


const App: React.FC = () => {
  // Initialize theme
  useTheme();

  return (
    <HelmetProvider>
      <AuthProvider>
        <Router future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true
        }}>
          <ScrollToTop />
          <AnalyticsTracker />
          <AppContent />
          <UnifiedProfileModal />
        </Router>
      </AuthProvider>
    </HelmetProvider>
  );
}

export default App;
