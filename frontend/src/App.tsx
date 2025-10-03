import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { MarkingPageProvider } from './contexts/MarkingPageContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import OptionalAuthRoute from './components/auth/OptionalAuthRoute';
import { Sidebar, Header } from './components/layout';
import AdminPage from './components/admin/AdminPage';
import MarkingPage from './pages/MarkingPage';
import Login from './components/auth/Login';
import SubscriptionPage from './components/subscription/SubscriptionPage';
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

  const handleMarkingHistoryClick = async (result: MarkingResult) => {
    try {
      // In a fully typed app, you would have a typed API client here
      const response = await fetch(`http://localhost:5001/api/messages/session/${result.id}`);
      if (response.ok) {
        const sessionData = await response.json();
        setSelectedMarkingResult(sessionData.success ? sessionData.session : result);
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

  const AdminLayout = ({ children }: { children: React.ReactNode }) => (
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
                    >
                      <MarkingPage />
                    </MarkingPageProvider>
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
      </Router>
    </AuthProvider>
  );
}

export default App;

