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
import UnifiedProfileModal from './components/profile/UnifiedProfileModal';
import GuestLimitModal from './components/common/GuestLimitModal';
import AnalyticsTracker from './components/common/AnalyticsTracker';
import EventManager, { EVENT_TYPES } from './utils/eventManager';
import useTheme from './hooks/useTheme';
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
  isProcessing
}: MainLayoutWrapperProps) => (
  <div className="app-body">
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
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [selectedMarkingResult, setSelectedMarkingResult] = useState<MarkingResult | null>(null);
  const [markHomeworkResetKey, setMarkHomeworkResetKey] = useState<number>(0);
  const [isChatMode, setIsChatMode] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  const [autoSplit, setAutoSplit] = useState<boolean>(false);
  const [initialImageIndex, setInitialImageIndex] = useState<number>(0);

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
    return () => {
      window.removeEventListener('loadMarkingSession', handleLoadMarkingSession as any);
    };
  }, []);

  const handleMarkingHistoryClick = async (result: MarkingResult & { id: string }) => {
    try {
      const { simpleSessionService } = await import('./services/markingApiService');
      const response = await simpleSessionService.getSession(result.id);
      if (response.success && response.session) {
        setSelectedMarkingResult(response.session);
      } else {
        setSelectedMarkingResult(result);
      }
      navigate('/mark-homework');
    } catch (error) {
      console.error('Error fetching session data:', error);
      setSelectedMarkingResult(result);
      navigate('/mark-homework');
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
  const isSpecialRoute = ['/login', '/upgrade'].includes(location.pathname);

  // Common props for the layout wrapper
  const layoutProps = {
    isSpecialRoute,
    isSidebarOpen,
    setIsSidebarOpen,
    handleMarkingHistoryClick,
    handleMarkHomeworkClick,
    handleMarkingResultSaved,
    isChatMode,
    isProcessing
  };

  return (
    <div className="app-container">
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route path="/upgrade" element={
          <MainLayoutWrapper {...layoutProps}>
            <SubscriptionPage />
          </MainLayoutWrapper>
        } />

        <Route path="/library" element={
          <OptionalAuthRoute>
            <MainLayoutWrapper {...layoutProps} hideHeader={true}>
              <LibraryPage />
            </MainLayoutWrapper>
          </OptionalAuthRoute>
        } />

        <Route path="/analysis" element={
          <OptionalAuthRoute>
            <MainLayoutWrapper {...layoutProps} hideHeader={true}>
              <AnalysisPage />
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

        <Route path="/mark-homework" element={
          <OptionalAuthRoute>
            <MainLayoutWrapper {...layoutProps} rightSideClass={isChatMode ? 'chat-mode' : ''}>
              <div className="mark-homework-main-content">
                <MarkingPageProvider
                  key={markHomeworkResetKey}
                  selectedMarkingResult={selectedMarkingResult}
                  onPageModeChange={setIsChatMode}
                  onProcessingChange={setIsProcessing}
                  setSidebarOpen={setIsSidebarOpen}
                  autoSplit={autoSplit}
                  initialImageIndex={initialImageIndex}
                >
                  <MarkingPage />
                </MarkingPageProvider>
              </div>
            </MainLayoutWrapper>
          </OptionalAuthRoute>
        } />

        <Route path="/" element={
          <OptionalAuthRoute>
            <MainLayoutWrapper {...layoutProps}>
              <div className="welcome-message">
                <h1>Welcome to AI Marking</h1>
                <p>Your AI-powered homework marking assistant</p>
              </div>
            </MainLayoutWrapper>
          </OptionalAuthRoute>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

const App: React.FC = () => {
  // Initialize theme
  useTheme();

  const [isGuestLimitModalOpen, setIsGuestLimitModalOpen] = useState(false);

  // Listen for guest limit modal events
  useEffect(() => {
    const cleanup = EventManager.listen(EVENT_TYPES.OPEN_GUEST_LIMIT_MODAL, () => {
      setIsGuestLimitModalOpen(true);
    });
    return () => cleanup();
  }, []);

  return (
    <AuthProvider>
      <Router future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true
      }}>
        <AnalyticsTracker />
        <AppContent />
        <UnifiedProfileModal />
        <GuestLimitModal
          isOpen={isGuestLimitModalOpen}
          onClose={() => setIsGuestLimitModalOpen(false)}
        />
      </Router>
    </AuthProvider>
  );
}

export default App;
