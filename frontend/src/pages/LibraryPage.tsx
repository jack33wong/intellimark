/**
 * Library Page Component
 * Displays all marking instruction sessions with images, grouped by Exam Board → Subject → Year
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Search, Star, Grid } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import MarkingHistoryService from '../services/markingHistoryService';
import { getSessionImages, type SessionImage } from '../utils/imageCollectionUtils';
import type { UnifiedSession } from '../types';
import ImageModeModal from '../components/common/ImageModeModal';
import LibraryGroup from '../components/library/LibraryGroup';
import SEO from '../components/common/SEO';
import './LibraryPage.css';

export interface LibraryItem {
  sessionId: string;
  sessionTitle: string;
  date: string; // Format: "MM/DD"
  favorite: boolean;
  examBoard: string;
  subject: string;
  examSeries: string;
  examCode: string;
  tier: string;
  images: SessionImage[];
  totalFiles: number;
  studentScore?: {
    totalMarks: number;
    awardedMarks: number;
    scoreText: string;
  };
}

interface GroupedLibrary {
  [examBoard: string]: {
    [subject: string]: {
      [year: string]: LibraryItem[];
    };
  };
}

const LibraryPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, getAuthToken } = useAuth();
  const [sessions, setSessions] = useState<UnifiedSession[]>([]);
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filterFavorites, setFilterFavorites] = useState<boolean>(false);
  const [selectedImageSession, setSelectedImageSession] = useState<{ images: SessionImage[]; initialIndex: number } | null>(null);
  const [isImageModeOpen, setIsImageModeOpen] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  // Extract exam metadata from session
  const getExamMetadata = (session: UnifiedSession): { examBoard: string; subject: string; examSeries: string; examCode: string; tier: string } | null => {
    // Check session-level detectedQuestion first
    if (session.detectedQuestion?.found && session.detectedQuestion.examPapers?.length) {
      const firstExamPaper = session.detectedQuestion.examPapers[0];
      return {
        examBoard: firstExamPaper.examBoard || 'Unknown',
        subject: firstExamPaper.subject || 'Unknown',
        examSeries: firstExamPaper.examSeries || 'Unknown',
        examCode: firstExamPaper.examCode || '',
        tier: firstExamPaper.tier || ''
      };
    }

    // Fallback: Find assistant message with detectedQuestion
    const assistantMessage = session.messages?.find(
      m => m.role === 'assistant' && m.detectedQuestion?.found
    );

    if (!assistantMessage?.detectedQuestion?.examPapers?.length) {
      return null; // Skip sessions without exam metadata
    }

    // Use first exam paper for grouping
    const firstExamPaper = assistantMessage.detectedQuestion.examPapers[0];
    return {
      examBoard: firstExamPaper.examBoard || 'Unknown',
      subject: firstExamPaper.subject || 'Unknown',
      examSeries: firstExamPaper.examSeries || 'Unknown',
      examCode: firstExamPaper.examCode || '',
      tier: firstExamPaper.tier || ''
    };
  };

  // Format date as "MM/DD"
  const formatLibraryDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return '';
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}/${day}`;
  };

  // Fetch sessions
  const fetchSessions = useCallback(async () => {
    if (!user?.uid) {
      setSessions([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      const authToken = await getAuthToken();
      if (!authToken) {
        console.error('Authentication token not available.');
        setLoading(false);
        return;
      }

      const response = await MarkingHistoryService.getMarkingHistoryFromSessions(user.uid, 100, authToken) as {
        success: boolean;
        sessions?: UnifiedSession[];
        total?: number;
        limit?: number;
      };

      if (response.success && response.sessions) {
        // Filter for marking sessions OR mixed sessions (which can contain marking content)
        const markingSessions = response.sessions.filter(
          (session: UnifiedSession) => session.messageType === 'Marking' || session.messageType === 'Mixed'
        );
        setSessions(markingSessions);
      } else {
        console.error('Failed to load sessions:', response);
        setSessions([]);
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, [user?.uid, getAuthToken]);

  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  // Process sessions into library items
  useEffect(() => {
    const items: LibraryItem[] = [];

    sessions.forEach(session => {
      const metadata = getExamMetadata(session);
      if (!metadata) {
        return; // Skip if no exam metadata
      }

      const images = getSessionImages(session);
      if (images.length === 0) {
        return; // Skip if no images
      }

      // Find studentScore from assistant message
      const assistantMessage = session.messages?.find(
        m => m.role === 'assistant' && m.studentScore
      );
      const studentScore = assistantMessage?.studentScore;

      // Only include studentScore if all required fields are present
      const validStudentScore = studentScore &&
        typeof studentScore.totalMarks === 'number' &&
        typeof studentScore.awardedMarks === 'number' &&
        typeof studentScore.scoreText === 'string'
        ? {
          totalMarks: studentScore.totalMarks,
          awardedMarks: studentScore.awardedMarks,
          scoreText: studentScore.scoreText
        }
        : undefined;

      items.push({
        sessionId: session.id,
        sessionTitle: session.title || 'Untitled Session',
        date: formatLibraryDate(session.updatedAt || session.createdAt || ''),
        favorite: session.favorite || false,
        ...metadata,
        images,
        totalFiles: images.length,
        studentScore: validStudentScore
      });
    });

    setLibraryItems(items);
  }, [sessions]);

  // Filter library items based on search and favorites
  const getFilteredGroupedLibrary = (): GroupedLibrary => {
    let filteredItems = libraryItems;

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filteredItems = filteredItems.filter(item =>
        item.sessionTitle.toLowerCase().includes(query) ||
        item.examBoard.toLowerCase().includes(query) ||
        item.subject.toLowerCase().includes(query) ||
        item.examSeries.toLowerCase().includes(query) ||
        item.images.some(img => img.filename?.toLowerCase().includes(query))
      );
    }

    // Apply favorites filter
    if (filterFavorites) {
      filteredItems = filteredItems.filter(item => item.favorite);
    }

    // Re-group filtered items
    const filtered: GroupedLibrary = {};
    filteredItems.forEach(item => {
      if (!filtered[item.examBoard]) {
        filtered[item.examBoard] = {};
      }
      if (!filtered[item.examBoard][item.subject]) {
        filtered[item.examBoard][item.subject] = {};
      }
      if (!filtered[item.examBoard][item.subject][item.examSeries]) {
        filtered[item.examBoard][item.subject][item.examSeries] = [];
      }
      filtered[item.examBoard][item.subject][item.examSeries].push(item);
    });

    // Sort items within each group by date (newest first)
    Object.keys(filtered).forEach(board => {
      Object.keys(filtered[board]).forEach(subject => {
        Object.keys(filtered[board][subject]).forEach(examSeries => {
          filtered[board][subject][examSeries].sort((a, b) => {
            const dateA = new Date(a.date).getTime();
            const dateB = new Date(b.date).getTime();
            return dateB - dateA; // Newest first
          });
        });
      });
    });

    return filtered;
  };

  // Handle thumbnail click - Navigate to marking page in split mode
  const handleThumbnailClick = (item: LibraryItem, imageIndex: number) => {
    // Navigate to marking page
    navigate('/app');

    // Dispatch event to load session with autoSplit instruction
    const event = new CustomEvent('loadMarkingSession', {
      detail: {
        session: { id: item.sessionId, title: item.sessionTitle },
        autoSplit: true,
        initialImageIndex: imageIndex
      }
    });
    window.dispatchEvent(event);
  };

  const filteredGroupedLibrary = getFilteredGroupedLibrary();

  if (loading) {
    return (
      <div className="library-page">
        <div className="library-loading">
          <div className="loading-spinner" />
          <span>Loading library...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="library-page">
      <SEO
        title="Session Library"
        description="View and manage your past AI marking sessions. Access graded GCSE maths papers and feedback."
      />
      {/* Header */}
      <div className="library-header">
        <h1 className="library-title">Library</h1>

        <div className="library-controls">
          {/* Filter controls */}
          <div className="library-filters">
            <div className="filter-dropdown">
              <span>All</span>
            </div>
            <button
              className={`favorite-filter-btn ${filterFavorites ? 'active' : ''}`}
              onClick={() => setFilterFavorites(!filterFavorites)}
              aria-label="Filter favorites"
            >
              <Star size={16} fill={filterFavorites ? 'currentColor' : 'none'} />
            </button>
          </div>

          {/* Search */}
          <div className="library-search">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search files"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>

          {/* View toggle (grid only, but show icon for consistency) */}
          <div className="library-view-toggle">
            <button className="view-toggle-btn active" aria-label="Grid view">
              <Grid size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="library-content">
        {Object.keys(filteredGroupedLibrary).length === 0 ? (
          <div className="library-empty">
            <p>No marking sessions found</p>
          </div>
        ) : (
          Object.keys(filteredGroupedLibrary).map(examBoard => (
            Object.keys(filteredGroupedLibrary[examBoard]).map(subject => (
              Object.keys(filteredGroupedLibrary[examBoard][subject]).map(examSeries => (
                <LibraryGroup
                  key={`${examBoard}-${subject}-${examSeries}`}
                  examBoard={examBoard}
                  subject={subject}
                  examSeries={examSeries}
                  items={filteredGroupedLibrary[examBoard][subject][examSeries]}
                  onThumbnailClick={handleThumbnailClick}
                />
              ))
            ))
          ))
        )}
      </div>

      {/* Image Mode Modal */}
      {isImageModeOpen && selectedImageSession && (
        <ImageModeModal
          isOpen={isImageModeOpen}
          onClose={() => {
            setIsImageModeOpen(false);
            setSelectedImageSession(null);
          }}
          images={selectedImageSession.images}
          initialImageIndex={selectedImageSession.initialIndex}
        />
      )}
    </div>
  );
};

export default LibraryPage;

