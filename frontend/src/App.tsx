import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
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
import './App.css';

// Define the type for the marking result prop
interface MarkingResult {
  id: string;
  // Add other properties of your marking result object here
}

function AppContent() {
  const navigate = useNavigate();
  const [isSidebarOpen, setIsSidebarOpen] = useState<boolean>(true);
  const [selectedMarkingResult, setSelectedMarkingResult] = useState<MarkingResult | null>(null);
  const [markHomeworkResetKey, setMarkHomeworkResetKey] = useState<number>(0);
  const [isChatMode, setIsChatMode] = useState<boolean>(false);

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

  const AdminLayout = ({ children, hideHeader = false }: { children: React.ReactNode; hideHeader?: boolean }) => (
    <div className="app-container">
      <div className="app-body">
        <Sidebar
          isOpen={isSidebarOpen}
          onMarkingHistoryClick={handleMarkingHistoryClick}
          onMarkHomeworkClick={handleMarkHomeworkClick}
          onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)}
          onMarkingResultSaved={handleMarkingResultSaved}
        />
        <div className="right-side">
          {!hideHeader && <Header onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)} isSidebarOpen={isSidebarOpen} />}
          <div className="main-content">
            {children}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="app-container">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/upgrade" element={<SubscriptionPage />} />

        <Route path="/library" element={
          <OptionalAuthRoute>
            <AdminLayout hideHeader={true}>
              <LibraryPage />
            </AdminLayout>
          </OptionalAuthRoute>
        } />

        <Route path="/analysis" element={
          <OptionalAuthRoute>
            <AdminLayout hideHeader={true}>
              <AnalysisPage />
            </AdminLayout>
          </OptionalAuthRoute>
        } />

        <Route path="/admin" element={
          <ProtectedRoute requireAdmin={true}>
            <AdminLayout>
              <AdminPage />
            </AdminLayout>
          </ProtectedRoute>
        } />

        <Route path="/mark-homework" element={
          <OptionalAuthRoute>
            <div className="app-container">
              <div className="app-body">
                <Sidebar
                  isOpen={isSidebarOpen}
                  onMarkingHistoryClick={handleMarkingHistoryClick}
                  onMarkHomeworkClick={handleMarkHomeworkClick}
                  onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)}
                  onMarkingResultSaved={handleMarkingResultSaved}
                />
                <div className={`right-side ${isChatMode ? 'chat-mode' : ''}`}>
                  <Header onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)} isSidebarOpen={isSidebarOpen} />
                  <div className="mark-homework-main-content">
                    <MarkingPageProvider
                      key={markHomeworkResetKey}
                      selectedMarkingResult={selectedMarkingResult}
                      onPageModeChange={setIsChatMode}
                      setSidebarOpen={setIsSidebarOpen}
                      autoSplit={autoSplit}
                      initialImageIndex={initialImageIndex}
                    >
                      <MarkingPage />
                    </MarkingPageProvider> as any
                  </div>
                </div>
              </div>
            </div>
          </OptionalAuthRoute>
        } />

        <Route path="/" element={
          <OptionalAuthRoute>
            <div className="app-container">
              <div className="app-body">
                <Sidebar
                  isOpen={isSidebarOpen}
                  onMarkingHistoryClick={handleMarkingHistoryClick}
                  onMarkHomeworkClick={handleMarkHomeworkClick}
                  onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)}
                  onMarkingResultSaved={handleMarkingResultSaved}
                />
                <div className="right-side">
                  <Header onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)} isSidebarOpen={isSidebarOpen} />
                  <div className="main-content">
                    <div className="welcome-message">
                      <h1>Welcome to IntelliMark</h1>
                      <p>Your AI-powered homework marking assistant</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </OptionalAuthRoute>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

const App: React.FC = () => {
  return (
    <AuthProvider>
      <Router future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true
      }}>
        <AppContent />
        <UnifiedProfileModal />
      </Router>
    </AuthProvider>
  );
}

export default App;
