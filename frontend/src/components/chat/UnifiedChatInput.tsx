/**
 * UnifiedChatInput Component (TypeScript)
 * This component now correctly manages its own state and is fully typed.
 */
import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import imageCompression from 'browser-image-compression';
import { Plus, Brain, X, Check, Sparkles, Smartphone, UploadCloud, BookOpen, Library, Paperclip, FileText, AlertTriangle, Lightbulb } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import LandingPageUploadWidget from '../common/LandingPageUploadWidget';
import MobileUploadModal from '../upload/MobileUploadModal';
import ImageModeModal from '../common/ImageModeModal';
import { ModelSelector, SendButton } from '../focused';
import { useAuth } from '../../contexts/AuthContext';
import { useMarkingPage } from '../../contexts/MarkingPageContext';
import { useModels } from '../../contexts/ModelContext';
import { useSubscription } from '../../hooks/useSubscription';
import ApiClient from '../../services/apiClient';
import ConfigService from '../../services/configService';
import ConfirmationModal from '../common/ConfirmationModal';
import { mobileUploadService } from '../../services/MobileUploadService';
import { FileHandoff } from './FileHandoff';
import { useTelemetry } from '../../hooks/useTelemetry';
import { trackFunnelEvent, getLatestPreInspectSessionId, setLatestPreInspectSessionId } from '../../utils/funnelTracker';
import { getLandingExamContext, clearLandingExamContext } from '../../utils/landingContext';
import { FILE_CONSTRAINTS, validateSupportedUploadFiles } from '../../utils/fileUtils';
import {
  preInspectUploadedFiles,
  recomputePreInspectFromSummaries,
  setPendingPreInspectContext,
  type PreInspectFileSummary,
  type PreInspectResult,
  type PreInspectSuggestionAction,
} from '../../services/preInspectService';
import './UnifiedChatInput.css';

// Define the type for the props this component receives
interface UnifiedChatInputProps {
  mode: 'first-time' | 'follow-up';
  selectedModel: string;
  isProcessing: boolean;
  onModelChange: (model: string) => void;
  onAnalyzeImage: (file: File, text: string) => Promise<boolean> | any;
  onFollowUpImage: (file: File, text: string) => Promise<boolean> | any;
  onSendMessage: (text: string) => Promise<boolean> | any;
  // New props for multi-image support
  onAnalyzeMultiImage?: (files: File[], text: string) => Promise<boolean> | any;
  onFollowUpMultiImage?: (files: File[], text: string) => Promise<boolean> | any;
  currentSession?: any; // Session data to check if model selection should be disabled
  contextQuestionId?: string | null;
  setContextQuestionId?: (id: string | null) => void;
  isNegative?: boolean;
  isFollowUp?: boolean;
}

const UnifiedChatInput: React.FC<UnifiedChatInputProps> = ({
  mode,
  selectedModel,
  isProcessing,
  onModelChange,
  onAnalyzeImage,
  onFollowUpImage,
  onSendMessage,
  onAnalyzeMultiImage,
  onFollowUpMultiImage,
  currentSession,
  contextQuestionId,
  setContextQuestionId,
  isNegative = false,
  isFollowUp = false,
}) => {
  const {
    onGenerateModelAnswer,
    isModelAnswerMode: contextIsModelAnswerMode,
    setIsModelAnswerMode,
    isMarkingSchemeMode: contextIsMarkingSchemeMode,
    setIsMarkingSchemeMode,
    onExplainMarkingScheme,
    initialInput,
    setInitialInput,
    showModelAnswerConfirmation,
    setShowModelAnswerConfirmation,
    pendingModelAnswerPaper,
    setPendingModelAnswerPaper,
    pendingConfirmationMode,
    setPendingConfirmationMode
  } = useMarkingPage();

  // [FIX] Priority: Context State (User Toggles) should determine active mode.
  // We initialize these from the session's usageMode when the session changes.
  const isModelAnswerMode = contextIsModelAnswerMode;
  const isMarkingSchemeMode = contextIsMarkingSchemeMode;

  const location = useLocation();
  const navigate = useNavigate();
  const { logEvent } = useTelemetry();

  const handleNegativeCreditsRedirect = useCallback((source: string) => {
    logEvent('telemetry_events', {
      eventType: 'paywall_viewed',
      metadata: { source, isNegative: true }
    });
    navigate('/pricing', { state: { fromApp: true, source } });
  }, [logEvent, navigate]);
  const { user } = useAuth();
  const { checkPermission } = useSubscription();
  const { defaultModel } = useModels();
  const [canSelectModel, setCanSelectModel] = useState<boolean>(true); // Initialize with true, we'll check permission later
  const [chatInput, setChatInput] = useState<string>('');
  const [selectedPaper, setSelectedPaper] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedQualification, setSelectedQualification] = useState<string | null>(null);
  const [selectedBoard, setSelectedBoard] = useState<string | null>(null);
  const [selectedSubject, setSelectedSubject] = useState<string | null>(null);

  const isEnglishPaper = useCallback((paperStr: string) => {
    return /\b(8700|8702|1EN0|1ET0|J351|J352|C700|C720)\b|english/i.test(paperStr);
  }, []);

  const lastModeRef = useRef(mode);

  // [FIX] Reset context modes when entering fresh first-time mode (unless confirmation/redirect pending)
  useEffect(() => {
    if (mode === 'first-time' && lastModeRef.current !== 'first-time') {
      if (!showModelAnswerConfirmation && !pendingModelAnswerPaper) {
        setIsModelAnswerMode(false);
        setIsMarkingSchemeMode(false);
      }
    }
    lastModeRef.current = mode;
  }, [mode, setIsModelAnswerMode, setIsMarkingSchemeMode, showModelAnswerConfirmation, pendingModelAnswerPaper]);

  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [previewImages, setPreviewImages] = useState<string[]>([]);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [isMultiImage, setIsMultiImage] = useState<boolean>(false);
  const [fileSizeWarning, setFileSizeWarning] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragCounterRef = useRef<number>(0);

  // On-attach Pre-Inspect State (fast 1-3 page preview for instant UX guidance + backend geometry reuse)
  const [preInspectResult, setPreInspectResult] = useState<PreInspectResult | null>(null);
  const [isPreInspecting, setIsPreInspecting] = useState<boolean>(false);
  const [preInspectDismissed, setPreInspectDismissed] = useState<boolean>(false);
  const preInspectAbortRef = useRef<AbortController | null>(null);
  /** Per-file cached pre-inspect summaries keyed by `${name}:${size}:${lastModified}` so removing a file never re-inspects remaining files */
  const inspectedFileMapRef = useRef<Map<string, PreInspectFileSummary>>(new Map());
  const lastPreInspectTokenRef = useRef<string>('');

  const [showUpgradeModal, setShowUpgradeModal] = useState<boolean>(false);
  const [isMobileUploadOpen, setIsMobileUploadOpen] = useState<boolean>(false);
  const [mobileSessionId, setMobileSessionId] = useState<string>('');


  const [showImageMode, setShowImageMode] = useState<boolean>(false);
  const [activeImageIndex, setActiveImageIndex] = useState<number>(0);


  // Metadata & Autocomplete State
  interface LocalExamMetadata {
    boards: string[];
    qualifications: string[];
    tiers: string[];
    papers: string[];
    codes: string[];
    subjects?: string[];
    boardSubjects?: Record<string, string[]>;
    qualificationBoards?: Record<string, string[]>;
    qualificationBoardSubjects?: Record<string, Record<string, string[]>>;
    paperSubjects?: Record<string, string>;
    paperMeta?: Record<string, {
      qualification: string;
      board: string;
      subject: string;
      code: string;
      series: string;
      tier: string;
    }>;
  }
  const [metadata, setMetadata] = useState<LocalExamMetadata>({
    boards: [],
    qualifications: [],
    tiers: [],
    papers: [],
    codes: [],
    subjects: [],
    boardSubjects: {},
    qualificationBoards: {},
    qualificationBoardSubjects: {},
    paperSubjects: {},
    paperMeta: {},
  });

  const normalizeSubjectName = useCallback((raw: string) => {
    const trimmed = raw.trim().replace(/\s+/g, ' ');
    if (!trimmed) return '';
    if (/^maths?$/i.test(trimmed)) return 'Mathematics';
    return trimmed
      .toLowerCase()
      .replace(/(^|[\s:\-\/(])([a-z])/g, (_, sep, ch) => `${sep}${ch.toUpperCase()}`);
  }, []);

  const getPaperQualification = useCallback((paperStr: string) => {
    const metaQual = metadata.paperMeta?.[paperStr]?.qualification;
    if (metaQual) return metaQual;
    const knownQuals = [
      'International AS', 'A-Level', 'AS-Level', 'IGCSE', 'IAL',
      'O Level', 'National 5', 'Level 3', 'GCSE', 'IB', 'AP'
    ];
    for (const q of knownQuals) {
      if (paperStr.startsWith(`${q} `)) return q;
    }
    return 'GCSE';
  }, [metadata.paperMeta]);

  const getPaperBoard = useCallback((paperStr: string) => {
    const metaBoard = metadata.paperMeta?.[paperStr]?.board;
    if (metaBoard) return metaBoard;
    const firstPart = paperStr.split(' - ')[0] || '';
    const qual = getPaperQualification(paperStr);
    return firstPart.startsWith(`${qual} `) ? firstPart.slice(qual.length + 1).trim() : firstPart.trim();
  }, [metadata.paperMeta, getPaperQualification]);

  const getPaperSubject = useCallback((paperStr: string) => {
    const metaSubject = metadata.paperMeta?.[paperStr]?.subject;
    if (metaSubject) return normalizeSubjectName(metaSubject);
    const dbSubject = metadata.paperSubjects?.[paperStr];
    if (dbSubject) return normalizeSubjectName(dbSubject);
    return isEnglishPaper(paperStr) ? 'English Language' : 'Mathematics';
  }, [metadata.paperMeta, metadata.paperSubjects, isEnglishPaper, normalizeSubjectName]);

  const formatPaperDisplayLabel = useCallback((paperStr: string) => {
    const pm = metadata.paperMeta?.[paperStr];
    if (pm) {
      const subjectLabel = normalizeSubjectName(pm.subject || getPaperSubject(paperStr));
      const detailParts = [pm.board, pm.code, pm.series].filter(Boolean).join(' - ');
      const tierSuffix = pm.tier ? `, ${pm.tier}` : '';
      return `${pm.qualification} ${subjectLabel} · ${detailParts}${tierSuffix}`;
    }
    if (/math|english/i.test(paperStr)) return paperStr;
    const subjectLabel = getPaperSubject(paperStr);
    const qual = getPaperQualification(paperStr);
    if (paperStr.startsWith(`${qual} `)) {
      return `${qual} ${subjectLabel} · ${paperStr.slice(qual.length + 1)}`;
    }
    return `${subjectLabel} · ${paperStr}`;
  }, [metadata.paperMeta, normalizeSubjectName, getPaperSubject, getPaperQualification]);

  const parsePaperCardMeta = useCallback((paperStr: string) => {
    const pm = metadata.paperMeta?.[paperStr];
    if (pm) {
      const subjectLabel = normalizeSubjectName(pm.subject || getPaperSubject(paperStr));
      const title = `${pm.board} ${pm.code}`.trim();
      const leftMeta = `${pm.qualification} ${subjectLabel}`.trim();
      const seriesWithTier = pm.tier ? `${pm.series}, ${pm.tier}` : pm.series;
      const subtitle = seriesWithTier ? `${leftMeta} · ${seriesWithTier}` : leftMeta;
      return { title, subtitle };
    }

    const subjectLabel = getPaperSubject(paperStr);
    const parts = paperStr.split(' - ').map((s) => s.trim());

    if (parts.length >= 2) {
      const qual = getPaperQualification(paperStr);
      let board = parts[0];
      if (board.startsWith(`${qual} `)) {
        board = board.slice(qual.length + 1).trim();
      }
      const code = parts[1];
      const series = parts.slice(2).join(' - ');
      const title = `${board} ${code}`.trim();
      const leftMeta = qual ? `${qual} ${subjectLabel}` : subjectLabel;
      const subtitle = series ? `${leftMeta} · ${series}` : leftMeta;
      return { title, subtitle };
    }

    return {
      title: paperStr,
      subtitle: subjectLabel,
    };
  }, [metadata.paperMeta, normalizeSubjectName, getPaperSubject, getPaperQualification]);

  const availableBoards = useMemo(() => {
    if (selectedQualification && metadata.qualificationBoards?.[selectedQualification]?.length) {
      return metadata.qualificationBoards[selectedQualification];
    }
    if (selectedQualification) {
      const unique = new Set<string>();
      (metadata.papers || []).forEach((p) => {
        if (getPaperQualification(p) === selectedQualification) {
          const b = getPaperBoard(p);
          if (b) unique.add(b);
        }
      });
      return Array.from(unique).sort();
    }
    return metadata.boards || [];
  }, [selectedQualification, metadata.qualificationBoards, metadata.boards, metadata.papers, getPaperQualification, getPaperBoard]);

  const availableSubjects = useMemo(() => {
    let rawList: string[] = [];
    if (selectedQualification && selectedBoard && metadata.qualificationBoardSubjects?.[selectedQualification]?.[selectedBoard]?.length) {
      rawList = metadata.qualificationBoardSubjects[selectedQualification][selectedBoard];
    } else if (selectedQualification && !selectedBoard && metadata.qualificationBoardSubjects?.[selectedQualification]) {
      rawList = Object.values(metadata.qualificationBoardSubjects[selectedQualification]).flat();
    } else if (!selectedQualification && selectedBoard && metadata.boardSubjects?.[selectedBoard]?.length) {
      rawList = metadata.boardSubjects[selectedBoard];
    } else if (!selectedQualification && !selectedBoard && metadata.subjects && metadata.subjects.length > 0) {
      rawList = metadata.subjects;
    } else {
      rawList = (metadata.papers || [])
        .filter((p) => (!selectedQualification || getPaperQualification(p) === selectedQualification) &&
                       (!selectedBoard || getPaperBoard(p).toLowerCase() === selectedBoard.toLowerCase()))
        .map((p) => getPaperSubject(p));
    }

    const unique = new Set<string>();
    rawList.forEach((s) => {
      const normalized = normalizeSubjectName(s);
      if (normalized) unique.add(normalized);
    });
    return Array.from(unique).sort();
  }, [selectedQualification, selectedBoard, metadata.qualificationBoardSubjects, metadata.boardSubjects, metadata.subjects, metadata.papers, getPaperQualification, getPaperBoard, getPaperSubject, normalizeSubjectName]);

  const handleQualificationSelect = (qual: string | null) => {
    setSelectedQualification(qual);
    setHighlightedIndex(-1);
    if (qual && selectedBoard) {
      const validBoards = metadata.qualificationBoards?.[qual];
      if (validBoards && !validBoards.includes(selectedBoard)) {
        setSelectedBoard(null);
      }
    }
    if (qual && selectedSubject) {
      const qBoards = metadata.qualificationBoardSubjects?.[qual];
      const validSubs = qBoards ? Object.values(qBoards).flat() : null;
      if (validSubs && !validSubs.includes(selectedSubject)) {
        setSelectedSubject(null);
      }
    }
  };

  const handleBoardSelect = (board: string | null) => {
    setSelectedBoard(board);
    setHighlightedIndex(-1);
    if (board && selectedSubject) {
      const boardSubs = selectedQualification
        ? metadata.qualificationBoardSubjects?.[selectedQualification]?.[board]
        : metadata.boardSubjects?.[board];
      if (boardSubs && !boardSubs.includes(selectedSubject)) {
        setSelectedSubject(null);
      }
    }
  };

  const [showAutocomplete, setShowAutocomplete] = useState<boolean>(false);
  const [isMetadataLoading, setIsMetadataLoading] = useState<boolean>(true);
  const [paperSuggestionDismissed, setPaperSuggestionDismissed] = useState<boolean>(false);
  const landingContextAppliedRef = useRef<boolean>(false);
  const [showPlusMenu, setShowPlusMenu] = useState<boolean>(false);
  const [plusMenuOpenUpward, setPlusMenuOpenUpward] = useState<boolean>(false);
  const plusMenuRef = useRef<HTMLDivElement>(null);
  const [highlightedIndex, setHighlightedIndex] = useState<number>(-1);

  useEffect(() => {
    if (!showPlusMenu) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (plusMenuRef.current && !plusMenuRef.current.contains(e.target as Node)) {
        setShowPlusMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowPlusMenu(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showPlusMenu]);

  const normalizePaperSearch = useCallback((t: string) => {
    return t.toLowerCase()
      .replace(/\bmathematics\b/g, 'maths')
      .replace(/\benglish language\b/g, 'englang')
      .replace(/\beng lang\b/g, 'englang')
      .replace(/\benglish\b/g, 'englang')
      .replace(/\ba level\b/g, 'alevel')
      // Split concatenated month + 2/4-digit year (e.g. "nov2024" -> "nov 2024", "jun25" -> "jun 2025", "sum2024" -> "sum 2024")
      .replace(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?|sum(?:mer)?|win(?:ter)?|aut(?:umn)?)(\d{2,4})\b/gi, (_, month, yr) => {
        const fullYear = yr.length === 2 ? `20${yr}` : yr;
        return `${month} ${fullYear}`;
      })
      .replace(/\bjan\b/g, 'january')
      .replace(/\bfeb\b/g, 'february')
      .replace(/\bmar\b/g, 'march')
      .replace(/\bapr\b/g, 'april')
      .replace(/\bjul\b/g, 'july')
      .replace(/\baug\b/g, 'august')
      .replace(/\bsep(?:t)?\b/g, 'september')
      .replace(/\boct\b/g, 'october')
      .replace(/\bnov\b/g, 'november')
      .replace(/\bdec\b/g, 'december')
      .replace(/\b(jun|june|may|sum|summer)\b/g, 'summer')
      .replace(/[-,/]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }, []);

  // Dynamic filtering logic using useMemo (Modern React)
  const filteredResults = useMemo(() => {
    if (mode !== 'first-time') return [];

    // If autocomplete is closed and no text/filters are active, skip computing suggestions
    if (!showAutocomplete && chatInput.trim().length === 0 && selectedTags.length === 0 && !selectedQualification && !selectedBoard && !selectedSubject) {
      return [];
    }

    let filtered = metadata.papers;

    if (selectedQualification) {
      filtered = filtered.filter((p) => getPaperQualification(p) === selectedQualification);
    }

    if (selectedBoard) {
      const boardLower = selectedBoard.toLowerCase();
      filtered = filtered.filter((p) => getPaperBoard(p).toLowerCase() === boardLower || p.toLowerCase().includes(boardLower));
    }

    if (selectedSubject) {
      const subjLower = selectedSubject.toLowerCase();
      filtered = filtered.filter((p) => getPaperSubject(p).toLowerCase() === subjLower);
    }

    // 1. Filter by ALL selected tags (Facet logic)
    if (selectedTags.length > 0) {
      filtered = filtered.filter((paper: string) =>
        selectedTags.every((tag: string) => paper.toLowerCase().includes(tag.toLowerCase()))
      );
    }

    // 2. Further filter by typing buffer (V17.5 Vocabulary-Based Resilience)
    if (chatInput.trim().length > 0) {
      const input = chatInput.trim();

      // Build vocabulary from all available metadata
      const vocabulary = new Set<string>();
      (metadata.boards || []).forEach(b => normalizePaperSearch(b).split(' ').forEach(w => w && vocabulary.add(w)));
      (metadata.qualifications || []).forEach(q => normalizePaperSearch(q).split(' ').forEach(w => w && vocabulary.add(w)));
      (metadata.tiers || []).forEach(t => normalizePaperSearch(t).split(' ').forEach(w => w && vocabulary.add(w)));
      (metadata.papers || []).forEach(p => {
        // Paper names contain codes and series
        normalizePaperSearch(p).split(' ').forEach(w => w && vocabulary.add(w));
      });

      const rawInputTokens = normalizePaperSearch(input).split(' ').filter(token => token.length > 0);
      // Filter out tokens that aren't in our valid vocabulary
      const inputTokens = Array.from(new Set(rawInputTokens.filter(k => vocabulary.has(k))));

      if (inputTokens.length > 0) {
        filtered = filtered.filter(p => {
          const paperTokens = normalizePaperSearch(p).split(' ').filter(token => token.length > 0);
          return inputTokens.every(it =>
            paperTokens.some(pt => {
              if (pt === it) return true;
              if (/^\d+$/.test(pt) && /^\d+$/.test(it)) return parseInt(pt) === parseInt(it);
              return pt.includes(it);
            })
          );
        });
      }
    }

    // Deduplicate papers that normalize to the same canonical series (e.g. "June 2024" vs "Summer 2024")
    const seenCanonical = new Map<string, string>();
    filtered.forEach((p: string) => {
      const key = normalizePaperSearch(p);
      const existing = seenCanonical.get(key);
      if (!existing) {
        seenCanonical.set(key, p);
      } else if (/\bsummer\b/i.test(existing) && /\b(june|may)\b/i.test(p)) {
        // Prefer specific month label ("June 2024" / "May 2023") over generic "Summer 2024"
        seenCanonical.set(key, p);
      }
    });
    const uniqueFiltered = Array.from(seenCanonical.values());

    return uniqueFiltered.sort((a: string, b: string) => {
      // Sort by Year and Month (Descending)
      const monthOrder: Record<string, number> = {
        'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6, 'summer': 6,
        'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12
      };

      const parseDate = (s: string) => {
        const parts = s.toLowerCase().split(' - ');
        if (parts.length < 3) return { year: 0, month: 0 };
        const datePart = parts[2].split(',')[0].trim();
        const [month, year] = datePart.split(' ');
        return {
          year: parseInt(year) || 0,
          month: monthOrder[month] || 0
        };
      };

      const dateA = parseDate(a);
      const dateB = parseDate(b);

      if (dateA.year !== dateB.year) return dateB.year - dateA.year;
      if (dateA.month !== dateB.month) return dateB.month - dateA.month;
      return a.localeCompare(b);
    }).slice(0, 10);
  }, [metadata.papers, metadata.boards, metadata.qualifications, metadata.tiers, selectedTags, selectedQualification, selectedBoard, selectedSubject, getPaperQualification, getPaperBoard, getPaperSubject, chatInput, mode, showAutocomplete, normalizePaperSearch]);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [showHandoff, setShowHandoff] = useState<boolean>(false);
  const [handoffType, setHandoffType] = useState<'upload' | 'scan' | null>(null);
  const handoverProcessedRef = useRef(false);

  // Check model selection permission once subscribe hook is available
  useEffect(() => {
    setCanSelectModel(checkPermission('model_selection'));
  }, [checkPermission]);
  // Fetch metadata on mount
  useEffect(() => {
    const fetchMetadata = async () => {
      setIsMetadataLoading(true);
      try {
        const data = await ConfigService.getExamMetadata();
        setMetadata(data);
        setSelectedBoard((prev) => {
          if (!prev || !data?.boards?.length) return prev;
          const target = prev.toLowerCase();
          const match = data.boards.find((b: string) => {
            const bl = b.toLowerCase();
            return bl === target || bl.includes(target) || target.includes(bl);
          });
          return match || prev;
        });
      } catch (error) {
        console.error('Failed to fetch exam metadata:', error);
      } finally {
        setIsMetadataLoading(false);
      }
    };
    fetchMetadata();
  }, []);

  // Reset composer, past papers gallery, and landing context when user clicks "New Marking"
  useEffect(() => {
    const handleWorkspaceReset = () => {
      clearLandingExamContext();
      landingContextAppliedRef.current = true;
      setChatInput('');
      setSelectedPaper(null);
      setSelectedTags([]);
      setSelectedQualification(null);
      setSelectedBoard(null);
      setSelectedSubject(null);
      setShowAutocomplete(false);
      setPaperSuggestionDismissed(false);
      setIsModelAnswerMode(false);
      setIsMarkingSchemeMode(false);
    };
    window.addEventListener('workspaceReset', handleWorkspaceReset);
    return () => window.removeEventListener('workspaceReset', handleWorkspaceReset);
  }, [setIsModelAnswerMode, setIsMarkingSchemeMode]);

  // Auto-open and pre-filter Past Papers autocomplete from user's last visited SEO landing page
  useEffect(() => {
    if (mode !== 'first-time' || landingContextAppliedRef.current || isMetadataLoading) return;

    const params = new URLSearchParams(location.search);
    const hasDeepLink = Boolean(params.get('code') || params.get('action') || params.get('mode'));
    if (hasDeepLink || initialInput || pendingModelAnswerPaper || selectedPaper) return;

    const landingCtx = getLandingExamContext();
    if (!landingCtx) return;

    landingContextAppliedRef.current = true;

    // 1. Match qualification only if it actually exists in DB
    const targetQual = (landingCtx.qualification || '').trim().toLowerCase();
    const matchedQual = targetQual
      ? (metadata.qualifications || []).find((q: string) => q.toLowerCase() === targetQual) || null
      : null;

    // 2. Match board against boards available under the matched qualification (or all boards)
    const candidateBoards = matchedQual && metadata.qualificationBoards?.[matchedQual]?.length
      ? metadata.qualificationBoards[matchedQual]
      : (metadata.boards || []);
    const targetBoard = (landingCtx.board || '').trim().toLowerCase();
    const matchedBoard = targetBoard
      ? candidateBoards.find((b: string) => {
          const bl = b.toLowerCase();
          return bl === targetBoard || bl.includes(targetBoard) || targetBoard.includes(bl);
        }) || null
      : null;

    // 3. Match subject only if that subject actually exists under the matched qualification + board
    const candidateSubjects = matchedQual && matchedBoard && metadata.qualificationBoardSubjects?.[matchedQual]?.[matchedBoard]?.length
      ? metadata.qualificationBoardSubjects[matchedQual][matchedBoard]
      : matchedBoard && metadata.boardSubjects?.[matchedBoard]?.length
        ? metadata.boardSubjects[matchedBoard]
        : matchedQual && metadata.qualificationBoardSubjects?.[matchedQual]
          ? Object.values(metadata.qualificationBoardSubjects[matchedQual]).flat()
          : (metadata.subjects || []);
    const targetSubject = (landingCtx.subject || '').trim().toLowerCase();
    const matchedSubject = targetSubject
      ? candidateSubjects.find((s: string) => s.toLowerCase() === targetSubject) || null
      : null;

    setSelectedQualification(matchedQual);
    setSelectedBoard(matchedBoard);
    setSelectedSubject(matchedSubject);
    setShowAutocomplete(true);
  }, [
    mode,
    isMetadataLoading,
    location.search,
    initialInput,
    pendingModelAnswerPaper,
    selectedPaper,
    metadata.qualifications,
    metadata.boards,
    metadata.subjects,
    metadata.boardSubjects,
    metadata.qualificationBoards,
    metadata.qualificationBoardSubjects
  ]);

  // V16.7 Sync input with initialInput from context (for redirection)
  useEffect(() => {
    if (initialInput) {
      setChatInput(initialInput);
      setInitialInput(''); // Clear after syncing
    }
  }, [initialInput, setInitialInput]);

  // Autocomplete will now stay open as long as there is input (no outside-click close)


  // Filter suggestions based on input (never auto-open past paper list on typing)
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setChatInput(value);
    if (mode === 'first-time') {
      setHighlightedIndex(-1);
    }
  };

  const toggleFilterTag = (tag: string, categoryTags: string[] = []) => {
    const isSelected = selectedTags.some(t => t.toLowerCase() === tag.toLowerCase());

    setSelectedTags(prev => {
      if (isSelected) {
        // Toggle OFF
        return prev.filter(t => t.toLowerCase() !== tag.toLowerCase());
      } else {
        // Toggle ON: remove others in same category
        const filtered = prev.filter(t =>
          !categoryTags.some(ct => ct.toLowerCase() === t.toLowerCase())
        );
        return [...filtered, tag];
      }
    });

    setShowAutocomplete(true);
    setHighlightedIndex(-1);
  };

  const removeTag = (tagToRemove: string) => {
    setSelectedTags(prev => prev.filter(tag => tag !== tagToRemove));
    inputRef.current?.focus();
  };

  const combinedInput = React.useMemo(() => {
    const inputPart = chatInput.trim();
    if (selectedPaper) {
      return inputPart ? `${selectedPaper} ${inputPart}` : selectedPaper;
    }
    const tagsPart = selectedTags.length > 0 ? selectedTags.join(' ') : '';
    return tagsPart ? (inputPart ? `${tagsPart} ${inputPart}` : tagsPart) : inputPart;
  }, [selectedPaper, selectedTags, chatInput]);

  // V17.0: Normalize paper codes to ignore slashes/dashes/spaces for flexible matching
  const normalizeCode = useCallback((code: string) => {
    return code.toLowerCase().replace(/[^a-z0-9]/g, '');
  }, []);

  // V17.1: Token-based matching logic with month normalization
  const getMatchingPapers = useCallback((input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return [];

    const vocabulary = new Set<string>();
    (metadata.boards || []).forEach(b => normalizePaperSearch(b).split(' ').forEach(w => w && vocabulary.add(w)));
    (metadata.qualifications || []).forEach(q => normalizePaperSearch(q).split(' ').forEach(w => w && vocabulary.add(w)));
    (metadata.tiers || []).forEach(t => normalizePaperSearch(t).split(' ').forEach(w => w && vocabulary.add(w)));
    (metadata.papers || []).forEach(p => {
      normalizePaperSearch(p).split(' ').forEach(w => w && vocabulary.add(w));
    });

    const rawInputTokens = normalizePaperSearch(trimmed).split(' ').filter(token => token.length > 0);
    const inputTokens = Array.from(new Set(rawInputTokens.filter(k => vocabulary.has(k))));

    if (inputTokens.length === 0) return [];

    let candidatePapers = metadata.papers;
    if (selectedBoard) {
      const boardLower = selectedBoard.toLowerCase();
      candidatePapers = candidatePapers.filter((p) => p.toLowerCase().includes(boardLower));
    }
    if (selectedSubject) {
      const subjLower = selectedSubject.toLowerCase();
      candidatePapers = candidatePapers.filter((p) => getPaperSubject(p).toLowerCase() === subjLower);
    }

    const matched = candidatePapers.filter((p: string) => {
      const paperTokens = normalizePaperSearch(p).split(' ').filter(token => token.length > 0);

      // Strict match on non-noisy keywords
      return inputTokens.every(it => {
        return paperTokens.some(pt => {
          if (pt === it) return true;
          if (/^\d+$/.test(pt) && /^\d+$/.test(it)) return parseInt(pt) === parseInt(it);
          return pt.includes(it);
        });
      });
    });

    // Deduplicate papers that normalize to the same canonical series (e.g. "June 2024" vs "Summer 2024")
    const seenCanonical = new Map<string, string>();
    matched.forEach((p: string) => {
      const key = normalizePaperSearch(p);
      const existing = seenCanonical.get(key);
      if (!existing) {
        seenCanonical.set(key, p);
      } else if (/\bsummer\b/i.test(existing) && /\b(june|may)\b/i.test(p)) {
        seenCanonical.set(key, p);
      }
    });

    return Array.from(seenCanonical.values()).sort((a: string, b: string) => {
      // Sort by Year and Month (Descending)
      const monthOrder: Record<string, number> = {
        'january': 1, 'february': 2, 'march': 3, 'april': 4, 'may': 5, 'june': 6, 'summer': 6,
        'july': 7, 'august': 8, 'september': 9, 'october': 10, 'november': 11, 'december': 12
      };

      const parseDate = (s: string) => {
        const parts = s.toLowerCase().split(' - ');
        if (parts.length < 3) return { year: 0, month: 0 };
        // Format is usually "Board - Code - Month Year, Tier"
        const datePart = parts[2].split(',')[0].trim(); // "november 2020"
        const [month, year] = datePart.split(' ');
        return {
          year: parseInt(year) || 0,
          month: monthOrder[month] || 0
        };
      };

      const dateA = parseDate(a);
      const dateB = parseDate(b);

      if (dateA.year !== dateB.year) return dateB.year - dateA.year;
      if (dateA.month !== dateB.month) return dateB.month - dateA.month;

      // Secondary sort by paper code/name if dates are identical
      return a.localeCompare(b);
    });
  }, [metadata.papers, metadata.boards, metadata.qualifications, metadata.tiers, selectedBoard, selectedSubject, getPaperSubject, normalizePaperSearch]);

  const isInvalidPreInspect = mode === 'first-time' && preInspectResult?.overallStatus === 'invalid';

  const canSend = useMemo(() => {
    if (isProcessing || isNegative) return false;

    // 1. Specialized Mode Check (Model Answer / Marking Scheme)
    if (isModelAnswerMode || isMarkingSchemeMode) {
      if (mode === 'follow-up') return !!combinedInput.trim();
      if (selectedPaper) return true;

      const trimmedInput = combinedInput.trim();
      if (!trimmedInput) return false;

      // Check for trusted links or pending redirects (exact match guaranteed)
      const params = new URLSearchParams(location.search);
      const paramMode = params.get('mode');
      const isFromTrustedLink = (paramMode === 'model' || paramMode === 'marking-scheme' || paramMode === 'markingscheme') && params.get('code');
      const isFromPendingRedirect = pendingModelAnswerPaper && trimmedInput === pendingModelAnswerPaper;
      if ((isFromTrustedLink && trimmedInput === params.get('code')) || isFromPendingRedirect) return true;

      // Unique match required for search
      const matches = getMatchingPapers(trimmedInput);
      return matches.length === 1;
    }

    // 2. Standard Marking Mode Check
    const hasFiles = !!(imageFile || imageFiles.length > 0);

    if (mode === 'follow-up') {
      // In follow-up chat, either text or files is sufficient
      return hasFiles || !!combinedInput.trim();
    } else {
      // First-time standard upload: FILES ARE MANDATORY, and block accidental Send on pre-inspect invalid/non-academic files
      return hasFiles && !isInvalidPreInspect;
    }
  }, [isProcessing, isNegative, isInvalidPreInspect, isModelAnswerMode, isMarkingSchemeMode, selectedPaper, combinedInput, imageFile, imageFiles.length, getMatchingPapers, location.search, mode]);

  const matchedPaper = useMemo(() => {
    if (mode !== 'first-time') return null;
    if (selectedPaper) return selectedPaper;
    const trimmed = combinedInput.trim();
    if (!trimmed) return null;
    const matches = getMatchingPapers(trimmed);
    return matches.length === 1 ? matches[0] : null;
  }, [mode, selectedPaper, combinedInput, getMatchingPapers]);

  const validationMessageType = useMemo(() => {
    // Suppress warning if not in paper mode, input is physically empty (no text typed),  const validationMessageType = useMemo(() => {
    if (!(isModelAnswerMode || isMarkingSchemeMode) || !chatInput.trim() || canSend || isFollowUp) return null;

    const matches = getMatchingPapers(combinedInput);
    if (matches.length === 0) return 'not_found';

    // Analyze matched papers for commonalities
    const tiers = new Set(matches.map(p => p.toLowerCase().includes('foundation') ? 'foundation' : 'higher'));
    const series = new Set(matches.map(p => {
      const parts = p.split(' - ');
      return parts.length >= 3 ? parts[2].split(',')[0].trim() : '';
    }));

    if (tiers.size > 1 && series.size === 1) return 'ambiguous_tier';
    if (series.size > 1 && tiers.size === 1) return 'ambiguous_series';
    if (matches.length > 1) return 'ambiguous_both';

    return 'not_found';
  }, [isModelAnswerMode, isMarkingSchemeMode, combinedInput, canSend, getMatchingPapers]);

  const showValidationWarning = useMemo(() => {
    return !!validationMessageType;
  }, [validationMessageType]);

  const handleSuggestionClick = (suggestion: string) => {
    // Attach selected paper as a visual card inside the composer (keep gallery open on both mobile and desktop)
    // Do not auto-focus textarea so mobile virtual keyboard stays dismissed while browsing
    setSelectedPaper(suggestion);
    setSelectedTags([]);
    setChatInput('');
    setPaperSuggestionDismissed(false);
  };

  // Helper function to detect PDF files
  const isPDF = (file: File) => {
    return file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  };

  const isSupportedAttachmentFile = (file: File): boolean => {
    if (!file) return false;
    const mime = (file.type || '').toLowerCase();
    if (
      mime === 'image/jpeg' ||
      mime === 'image/jpg' ||
      mime === 'image/png' ||
      mime === 'image/webp' ||
      mime === 'image/heic' ||
      mime === 'image/heif' ||
      mime === 'image/gif' ||
      mime === 'image/bmp' ||
      mime === 'image/tiff' ||
      mime === 'application/pdf'
    ) {
      return true;
    }
    return /\.(?:jpe?g|png|webp|heic|heif|gif|bmp|tiff?|pdf)$/i.test(file.name || '');
  };

  const LOCAL_FILE_PATH_REGEX =
    /(?:^|[\r\n\s])(?:\/Users\/[^\r\n]+\.(?:jpe?g|png|webp|gif|bmp|heic|heif|tiff?|pdf)|\/home\/[^\r\n]+\.(?:jpe?g|png|webp|gif|bmp|heic|heif|tiff?|pdf)|[A-Za-z]:\\[^\r\n]+\.(?:jpe?g|png|webp|gif|bmp|heic|heif|tiff?|pdf)|file:\/\/\/[^\r\n]+\.(?:jpe?g|png|webp|gif|bmp|heic|heif|tiff?|pdf))(?=$|[\r\n\s])/i;

  // PDF Preview Component
  const PDFPreview = ({ file, onRemove }: { file: File, onRemove: () => void }) => {
    const fileName = file.name.length > 20 ? file.name.substring(0, 20) + '...' : file.name;
    const fileSize = (file.size / 1024 / 1024).toFixed(1) + ' MB';

    return (
      <div className="pdf-preview-container">
        <div className="pdf-preview-content">
          <div className="pdf-icon-wrapper">
            <div className="pdf-icon" style={{ backgroundColor: 'rgb(250, 66, 62)' }}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" className="pdf-icon-svg">
                <path fillRule="evenodd" clipRule="evenodd" d="M11.2598 2.25191C11.8396 2.25191 12.2381 2.24808 12.6201 2.33981L12.8594 2.40719C13.0957 2.48399 13.3228 2.5886 13.5352 2.71871L13.6582 2.79879C13.9416 2.99641 14.1998 3.25938 14.5586 3.61813L15.5488 4.60836L15.833 4.89449C16.0955 5.16136 16.2943 5.38072 16.4482 5.6318L16.5703 5.84957C16.6829 6.07074 16.7691 6.30495 16.8271 6.54684L16.8574 6.69137C16.918 7.0314 16.915 7.39998 16.915 7.90719V13.0839C16.915 13.7728 16.9157 14.3301 16.8789 14.7802C16.8461 15.1808 16.781 15.5417 16.6367 15.8779L16.5703 16.0205C16.3049 16.5413 15.9008 16.9772 15.4053 17.2812L15.1865 17.4033C14.8099 17.5951 14.4041 17.6745 13.9463 17.7119C13.4961 17.7487 12.9391 17.749 12.25 17.749H7.75C7.06092 17.749 6.50395 17.7487 6.05371 17.7119C5.65317 17.6791 5.29227 17.6148 4.95606 17.4707L4.81348 17.4033C4.29235 17.1378 3.85586 16.7341 3.55176 16.2382L3.42969 16.0205C3.23787 15.6439 3.15854 15.2379 3.12109 14.7802C3.08432 14.3301 3.08496 13.7728 3.08496 13.0839V6.91695C3.08496 6.228 3.08433 5.67086 3.12109 5.22066C3.1585 4.76296 3.23797 4.35698 3.42969 3.98043C3.73311 3.38494 4.218 2.90008 4.81348 2.59664C5.19009 2.40484 5.59593 2.32546 6.05371 2.28805C6.50395 2.25126 7.06091 2.25191 7.75 2.25191H11.2598ZM7.75 3.58199C7.03896 3.58199 6.54563 3.58288 6.16211 3.61422C5.78642 3.64492 5.575 3.70168 5.41699 3.78219C5.0718 3.95811 4.79114 4.23874 4.61524 4.58395C4.53479 4.74193 4.47795 4.95354 4.44727 5.32906C4.41595 5.71254 4.41504 6.20609 4.41504 6.91695V13.0839C4.41504 13.7947 4.41594 14.2884 4.44727 14.6718C4.47798 15.0472 4.53477 15.259 4.61524 15.417L4.68555 15.5429C4.86186 15.8304 5.11487 16.0648 5.41699 16.2187L5.54688 16.2744C5.69065 16.3258 5.88016 16.3636 6.16211 16.3867C6.54563 16.418 7.03898 16.4189 7.75 16.4189H12.25C12.961 16.4189 13.4544 16.418 13.8379 16.3867C14.2135 16.356 14.425 16.2992 14.583 16.2187L14.709 16.1474C14.9963 15.9712 15.2308 15.7189 15.3848 15.417L15.4414 15.2861C15.4927 15.1425 15.5297 14.953 15.5527 14.6718C15.5841 14.2884 15.585 13.7947 15.585 13.0839V8.55758L13.3506 8.30953C12.2572 8.18804 11.3976 7.31827 11.2881 6.22359L11.0234 3.58199H7.75ZM12.6113 6.09176C12.6584 6.56193 13.0275 6.93498 13.4971 6.98727L15.5762 7.21871C15.5727 7.13752 15.5686 7.07109 15.5615 7.01266L15.5342 6.85738C15.5005 6.7171 15.4501 6.58135 15.3848 6.45309L15.3145 6.32711C15.2625 6.24233 15.1995 6.16135 15.0928 6.04488L14.6084 5.54879L13.6182 4.55856C13.2769 4.21733 13.1049 4.04904 12.9688 3.94234L12.8398 3.8525C12.7167 3.77705 12.5853 3.71637 12.4482 3.67184L12.3672 3.6484L12.6113 6.09176Z"></path>
              </svg>
            </div>
          </div>
          <div className="pdf-file-info">
            <div className="pdf-file-name">{fileName}</div>
            <div className="pdf-file-type">PDF • {fileSize}</div>
          </div>
        </div>
        <button className="pdf-remove-btn" onClick={onRemove} type="button" title="Remove PDF">
          ×
        </button>
      </div>
    );
  };

  const processFiles = useCallback(async (newFiles: File[]) => {
    if (newFiles.length === 0) return;
    // Block file selection while processing
    if (isProcessing) return;

    // 0. Strict client-side format & magic-byte validation (blocks HEIC/BMP/SVG/DOCX/corrupt files before upload)
    const {
      validFiles: validatedFiles,
      rejectedFiles,
      errorMessage: formatWarningMsg,
    } = await validateSupportedUploadFiles(newFiles);

    for (const rejected of rejectedFiles) {
      trackFunnelEvent('client_file_rejected', {
        source: 'unified_chat_input',
        mode,
        reason: rejected.reason,
        fileName: rejected.file?.name || 'unknown',
        fileType: rejected.file?.type || 'unknown',
        fileSize: rejected.file?.size || 0,
      }, user?.uid || null);
    }

    // 1. Pre-deduplicate against existing files AND within the newly selected batch using original file name + original size
    const existingFiles: File[] = [...imageFiles, ...(imageFile ? [imageFile] : [])];
    const getOriginalSize = (f: File): number => (f as any)._originalSize ?? f.size;

    const seenKeys = new Set<string>(
      existingFiles.map(f => `${f.name}::${getOriginalSize(f)}`)
    );
    const deduplicatedNewFiles: File[] = [];
    const MAX_SINGLE_FILE_BYTES = 50 * 1024 * 1024; // 50 MB per file (matches backend Firebase Storage limit)
    const MAX_TOTAL_BATCH_BYTES = 100 * 1024 * 1024; // 100 MB total per batch
    let runningBatchBytes = existingFiles.reduce((sum, f) => sum + (f.size || 0), 0);
    let sizeWarningMsg: string | null = formatWarningMsg;

    for (const file of validatedFiles) {
      const key = `${file.name}::${getOriginalSize(file)}`;
      if (seenKeys.has(key)) continue;

      if (file.size > MAX_SINGLE_FILE_BYTES) {
        const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
        sizeWarningMsg = `"${file.name}" (${sizeMB} MB) exceeds the 50 MB per-file limit and was skipped.`;
        trackFunnelEvent('client_file_rejected', {
          source: 'unified_chat_input',
          mode,
          reason: 'file_too_large',
          fileName: file.name || 'unknown',
          fileType: file.type || 'unknown',
          fileSize: file.size || 0,
        }, user?.uid || null);
        continue;
      }

      if (runningBatchBytes + file.size > MAX_TOTAL_BATCH_BYTES) {
        sizeWarningMsg = `Total upload size cannot exceed 100 MB per batch. "${file.name}" was skipped.`;
        trackFunnelEvent('client_file_rejected', {
          source: 'unified_chat_input',
          mode,
          reason: 'batch_too_large',
          fileName: file.name || 'unknown',
          fileType: file.type || 'unknown',
          fileSize: file.size || 0,
        }, user?.uid || null);
        continue;
      }

      seenKeys.add(key);
      runningBatchBytes += file.size;
      deduplicatedNewFiles.push(file);
    }

    setFileSizeWarning(sizeWarningMsg);
    if (deduplicatedNewFiles.length === 0) return;

    // Helper: Detect Safari/WebKit silent canvas memory exhaustion that produces a solid-black JPEG (~70 KB)
    const isSolidBlackOrCorruptBlob = async (blob: Blob, originalSize: number): Promise<boolean> => {
      if (!blob || blob.size === 0) return true;
      // Solid-black 1875x2500 JPEG at q=0.85 is ~73 KB; only inspect suspiciously small outputs from larger photos
      if (originalSize > 150 * 1024 && blob.size < 100 * 1024) {
        try {
          const bitmap = await createImageBitmap(blob);
          const sampleCanvas = document.createElement('canvas');
          sampleCanvas.width = 8;
          sampleCanvas.height = 8;
          const ctx = sampleCanvas.getContext('2d');
          if (!ctx) {
            bitmap.close();
            return false;
          }
          ctx.drawImage(bitmap, 0, 0, 8, 8);
          bitmap.close();
          const { data } = ctx.getImageData(0, 0, 8, 8);
          for (let i = 0; i < data.length; i += 4) {
            if (data[i] > 5 || data[i + 1] > 5 || data[i + 2] > 5) {
              return false; // Found non-black pixel
            }
          }
          return true; // All 64 sampled pixels are completely black
        } catch {
          return false;
        }
      }
      return false;
    };

    const compressSingleFile = async (file: File): Promise<File> => {
      const origSize = getOriginalSize(file);
      // Skip PDFs and files already processed by OpenCV scanner
      if (file.type === 'application/pdf' || file.name.startsWith('mobile-scan-')) {
        (file as any)._originalSize = origSize;
        return file;
      }

      // Skip re-encoding standard browser images already under 1.5 MB:
      // avoids multi-second Web Worker / canvas overhead and preserves lossless/original text clarity.
      const MAX_UNCOMPRESSED_BYTES = 1.5 * 1024 * 1024;
      const isStandardWebImage =
        file.type === 'image/jpeg' ||
        file.type === 'image/png' ||
        file.type === 'image/webp' ||
        (!file.type && /\.(jpe?g|png|webp)$/i.test(file.name));
      if (origSize <= MAX_UNCOMPRESSED_BYTES && isStandardWebImage) {
        (file as any)._originalSize = origSize;
        return file;
      }

      const options = {
        maxSizeMB: 1.5,
        maxWidthOrHeight: 2500,
        useWebWorker: true,
        initialQuality: 0.85,
        alwaysKeepResolution: true // Prevents shrinking small images
      };

      try {
        const compressedBlob = await imageCompression(file, options);
        if (await isSolidBlackOrCorruptBlob(compressedBlob, origSize)) {
          console.warn(`[Compression Guard] Detected blank/black canvas output for ${file.name} (${compressedBlob.size}B). Falling back to original file.`);
          (file as any)._originalSize = origSize;
          return file;
        }
        const compressedFile = new File([compressedBlob], file.name, { type: 'image/jpeg' });
        (compressedFile as any)._originalSize = origSize;
        return compressedFile;
      } catch (error) {
        console.warn(`Compression failed for ${file.name}, using original.`, error);
        (file as any)._originalSize = origSize;
        return file;
      }
    };

    // 2. Compress in small batches of 3 to avoid exceeding Safari/WebKit's per-tab Canvas memory ceiling
    const COMPRESSION_CONCURRENCY = 3;
    const processedNewFiles: File[] = [];
    for (let i = 0; i < deduplicatedNewFiles.length; i += COMPRESSION_CONCURRENCY) {
      const batch = deduplicatedNewFiles.slice(i, i + COMPRESSION_CONCURRENCY);
      const batchResults = await Promise.all(batch.map(compressSingleFile));
      processedNewFiles.push(...batchResults);
    }

    // If we already have files and user selects more, add to existing
    if (existingFiles.length > 0) {
      const allFiles = [...existingFiles, ...processedNewFiles];
      setImageFiles(allFiles);
      setImageFile(null);
      setPreviewImage(null);
      setIsMultiImage(true);

      // Load previews for images only (skip PDFs)
      const imageFilesOnly = allFiles.filter(file => !isPDF(file));
      const readers = imageFilesOnly.map(file => {
        const reader = new FileReader();
        return new Promise<string>((resolve) => {
          reader.onload = () => {
            if (typeof reader.result === 'string') {
              resolve(reader.result);
            }
          };
          reader.readAsDataURL(file);
        });
      });

      if (readers.length > 0) {
        Promise.all(readers).then(previews => {
          setPreviewImages(previews);
        });
      } else {
        setPreviewImages([]);
      }
    } else if (processedNewFiles.length === 1) {
      // Single file mode - but treat PDFs as multi-image for proper SSE handling
      const file = processedNewFiles[0];

      if (isPDF(file)) {
        // PDFs go through multi-image path for proper SSE handling
        setImageFile(null);
        setImageFiles([file]);
        setPreviewImage(null);
        setPreviewImages([]);
        setIsMultiImage(true);
      } else {
        // Regular images go through single image path
        setImageFile(file);
        setImageFiles([]);
        setPreviewImages([]);
        setIsMultiImage(false);

        // Generate preview for images
        const reader = new FileReader();
        reader.onload = () => {
          if (typeof reader.result === 'string') {
            setPreviewImage(reader.result);
          }
        };
        reader.readAsDataURL(file);
      }
    } else {
      // Multi-file mode (first selection)
      setImageFile(null);
      setImageFiles(processedNewFiles);
      setPreviewImage(null);
      setIsMultiImage(true);

      // Load previews for images only (skip PDFs)
      const imageFilesOnly = processedNewFiles.filter(file => !isPDF(file));
      const readers = imageFilesOnly.map(file => {
        const reader = new FileReader();
        return new Promise<string>((resolve) => {
          reader.onload = () => {
            if (typeof reader.result === 'string') {
              resolve(reader.result);
            }
          };
          reader.readAsDataURL(file);
        });
      });

      if (readers.length > 0) {
        Promise.all(readers).then(previews => {
          setPreviewImages(previews);
        });
      } else {
        setPreviewImages([]);
      }
    }

    trackFunnelEvent('file_attached', {
      source: 'unified_chat_input',
      mode,
      fileCount: processedNewFiles.length,
      totalFileCount: existingFiles.length + processedNewFiles.length,
      fileTypes: Array.from(new Set(processedNewFiles.map((f) => f.type || 'unknown'))).slice(0, 5),
    }, user?.uid || null);

    setIsExpanded(true);
    setShowAutocomplete(false);
  }, [imageFiles, imageFile, isMultiImage, isProcessing, mode, user?.uid]);

  // Restore stashed files when a guest cancels /login and returns to /app
  useEffect(() => {
    const handleRestoreStashedFiles = (e: Event) => {
      const detail = (e as CustomEvent<{ files?: File[]; customText?: string }>).detail;
      if (detail?.files && detail.files.length > 0) {
        processFiles(detail.files);
      }
      if (detail?.customText) {
        setChatInput(detail.customText);
      }
    };
    window.addEventListener('restoreStashedFiles', handleRestoreStashedFiles);
    return () => window.removeEventListener('restoreStashedFiles', handleRestoreStashedFiles);
  }, [processFiles]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (isNegative) return;
    const newFiles = Array.from(e.target.files || []);
    processFiles(newFiles);
    // Clear the input value so the same file can be selected again
    if (e.target) e.target.value = '';
  }, [processFiles, isNegative]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (isProcessing || isNegative) return;

    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    const pastedFiles: File[] = [];
    const seenKeys = new Set<string>();

    const addFileIfSupported = (file: File | null) => {
      if (!file || !isSupportedAttachmentFile(file)) return;
      const key = `${file.name}::${file.size}::${file.lastModified}`;
      if (!seenKeys.has(key)) {
        seenKeys.add(key);
        pastedFiles.push(file);
      }
    };

    // 1. Check clipboardData.files first (multi-file Finder/Explorer paste)
    if (clipboardData.files && clipboardData.files.length > 0) {
      for (let i = 0; i < clipboardData.files.length; i++) {
        addFileIfSupported(clipboardData.files[i]);
      }
    }

    // 2. Also check clipboardData.items (screenshots and items with empty MIME type such as .JPG)
    if (clipboardData.items && clipboardData.items.length > 0) {
      for (let i = 0; i < clipboardData.items.length; i++) {
        const item = clipboardData.items[i];
        if (
          item.kind === 'file' ||
          item.type.indexOf('image') !== -1 ||
          item.type === 'application/pdf'
        ) {
          addFileIfSupported(item.getAsFile());
        }
      }
    }

    if (pastedFiles.length > 0) {
      // Prevent the default paste behavior (which might insert filenames or raw paths)
      e.preventDefault();
      processFiles(pastedFiles);
      return;
    }

    // 3. Intercept raw local file paths pasted from Finder/Explorer when browser blocks clipboard file access
    const pastedText = clipboardData.getData('text/plain');
    if (pastedText && LOCAL_FILE_PATH_REGEX.test(pastedText)) {
      e.preventDefault();
      setFileSizeWarning(
        'Browser security prevents pasting local file paths directly. Please drag and drop the files here or use "Add Files".'
      );
    }
  }, [processFiles, isProcessing, isNegative]);

  const isDragDropDisabled =
    isProcessing || isNegative || (mode === 'first-time' && (isModelAnswerMode || isMarkingSchemeMode));

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (isDragDropDisabled) return;
    dragCounterRef.current += 1;
    setIsDragging(true);
  }, [isDragDropDisabled]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = isDragDropDisabled ? 'none' : 'copy';
    }
  }, [isDragDropDisabled]);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current = 0;
    setIsDragging(false);

    if (isDragDropDisabled) return;

    const allDroppedFiles = Array.from(e.dataTransfer?.files || []);
    if (allDroppedFiles.length === 0) return;

    const supportedFiles = allDroppedFiles.filter(isSupportedAttachmentFile);
    if (supportedFiles.length > 0) {
      processFiles(supportedFiles);
    } else {
      for (const file of allDroppedFiles.slice(0, 5)) {
        trackFunnelEvent('client_file_rejected', {
          source: 'unified_chat_input',
          mode,
          reason: 'unsupported_drop_format',
          fileName: file.name || 'unknown',
          fileType: file.type || 'unknown',
          fileSize: file.size || 0,
        }, user?.uid || null);
      }
      setFileSizeWarning('Only image files (JPG, PNG, WEBP, HEIC, etc.) and PDFs are supported.');
    }
  }, [isDragDropDisabled, processFiles, mode, user?.uid]);

  const handleUploadClick = useCallback(() => {
    if (isNegative) {
      handleNegativeCreditsRedirect('upload_button_blocked');
      return;
    }
    trackFunnelEvent('file_picker_opened', { source: 'unified_chat_input', mode }, user?.uid || null);
    fileInputRef.current?.click();
  }, [isNegative, handleNegativeCreditsRedirect, mode, user?.uid]);

  const handleOpenCameraHandoff = useCallback(async () => {
    if (isNegative) {
      handleNegativeCreditsRedirect('camera_button_blocked');
      return;
    }
    let sessionId = mobileSessionId;
    if (!sessionId) {
      sessionId = mobileUploadService.generateSessionId();
      setMobileSessionId(sessionId);
      try {
        await mobileUploadService.createSession(sessionId);
      } catch (err) {
        console.error('Failed to create session:', err);
      }
    }

    // Save session ID for return flow
    localStorage.setItem('active_mobile_session_id', sessionId);

    // Clean Handoff and redirect
    setShowHandoff(false);
    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);

    // Redirect to mobile camera page with return URL
    window.location.href = `/mobile-upload/${sessionId}?returnUrl=${encodeURIComponent(window.location.pathname)}`;
  }, [mobileSessionId, isNegative, navigate]);

  // V16.5: Restore session on return from camera
  useEffect(() => {
    const savedSessionId = localStorage.getItem('active_mobile_session_id');
    if (savedSessionId) {
      console.log('[MobileSync] Restoring active session:', savedSessionId);
      setMobileSessionId(savedSessionId);
    }
  }, []);

  const actionHandledRef = useRef(false);

  // Handle Action deep links (from Landing Page) via FileHandoff Bridge
  useEffect(() => {
    if (mode !== 'first-time') return;

    const params = new URLSearchParams(location.search);
    const action = params.get('action');

    if (!action) {
      actionHandledRef.current = false;
      return;
    }
    if (actionHandledRef.current) return;

    if (action === 'select' || action === 'upload') {
      setHandoffType('upload');
      setShowHandoff(true);
    } else if (action === 'scan') {
      // Direct detection of mobile to skip bridge on desktop
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

      if (isMobile) {
        setHandoffType('scan');
        setShowHandoff(true);
      } else {
        // Desktop: Show QR code modal immediately
        setIsMobileUploadOpen(true);
      }
    }

    // Clean URL via React Router so it doesn't re-trigger on remount
    navigate(location.pathname, { replace: true });
    actionHandledRef.current = true;
  }, [location.search, mode, navigate, location.pathname]);

  const removePreview = useCallback(() => {
    setPreviewImage(null);
    setImageFile(null);
    setPreviewImages([]);
    setImageFiles([]);
    setIsMultiImage(false);
    setIsExpanded(false);
    setFileSizeWarning(null);
  }, []);

  const removeImageAtIndex = useCallback((indexToRemove: number) => {
    setFileSizeWarning(null);
    if (isMultiImage) {
      const newFiles = imageFiles.filter((_, index) => index !== indexToRemove);
      const newPreviews = previewImages.filter((_, index) => index !== indexToRemove);

      if (newFiles.length === 0) {
        // No more files, reset everything
        setImageFiles([]);
        setPreviewImages([]);
        setIsMultiImage(false);
        setIsExpanded(false);
      } else if (newFiles.length === 1) {
        // Only one file left, switch to single image mode
        setImageFile(newFiles[0]);
        setImageFiles([]);
        setPreviewImage(newPreviews[0]);
        setPreviewImages([]);
        setIsMultiImage(false);
      } else {
        // Still multiple files
        setImageFiles(newFiles);
        setPreviewImages(newPreviews);
      }
    } else {
      // Single image mode
      removePreview();
    }
  }, [isMultiImage, imageFiles, previewImages, removePreview]);

  // Trigger lightweight on-attach pre-inspect whenever files are attached in first-time mode
  const attachedFilesList = useMemo<File[]>(() => {
    if (isMultiImage && imageFiles.length > 0) return imageFiles;
    if (imageFile) return [imageFile];
    return [];
  }, [isMultiImage, imageFiles, imageFile]);

  const attachedFilesSignature = useMemo(
    () => attachedFilesList.map((f) => `${f.name}:${f.size}:${f.lastModified}`).join('|'),
    [attachedFilesList]
  );

  useEffect(() => {
    if (preInspectAbortRef.current) {
      preInspectAbortRef.current.abort();
      preInspectAbortRef.current = null;
    }

    if (mode !== 'first-time' || attachedFilesList.length === 0 || isProcessing) {
      setPreInspectResult(null);
      setLatestPreInspectSessionId(null);
      setIsPreInspecting(false);
      setPreInspectDismissed(false);
      if (attachedFilesList.length === 0) {
        inspectedFileMapRef.current.clear();
        lastPreInspectTokenRef.current = '';
        setPendingPreInspectContext({ preInspectToken: null, allowGenericSubjectMarking: false });
      }
      return;
    }

    const fileKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;
    const cachedSummaries = attachedFilesList.map((f) => inspectedFileMapRef.current.get(fileKey(f)));
    const allRemainingKnownInCache =
      cachedSummaries.length > 0 &&
      cachedSummaries.every((s): s is PreInspectFileSummary => Boolean(s));

    // ⚡ Instant 0ms local recomputation when every remaining file is already known from the previous batch
    // (including uninspected images beyond MAX_INSPECTED_IMAGES — zero network request, zero LLM call!)
    if (allRemainingKnownInCache && lastPreInspectTokenRef.current) {
      const localResult = recomputePreInspectFromSummaries(cachedSummaries, lastPreInspectTokenRef.current);
      setPreInspectDismissed(false);
      setIsPreInspecting(false);
      setPreInspectResult(localResult);
      setPendingPreInspectContext({ preInspectToken: lastPreInspectTokenRef.current });
      return;
    }

    setPreInspectDismissed(false);
    setPreInspectResult(null);
    setIsPreInspecting(true);

    const controller = new AbortController();
    preInspectAbortRef.current = controller;

    const timer = window.setTimeout(async () => {
      try {
        const res = await preInspectUploadedFiles(attachedFilesList, {
          sessionId: currentSession?.id || null,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          if (res?.preInspectToken) {
            lastPreInspectTokenRef.current = res.preInspectToken;
          }
          if (res?.perFileRoles && res.perFileRoles.length === attachedFilesList.length) {
            attachedFilesList.forEach((f, idx) => {
              const summary = res.perFileRoles[idx];
              if (summary) {
                inspectedFileMapRef.current.set(fileKey(f), summary);
              }
            });
          }
          setPreInspectResult(res);
          setIsPreInspecting(false);
        }
      } catch (err: any) {
        if (!controller.signal.aborted && err?.name !== 'AbortError') {
          setPreInspectResult(null);
          setIsPreInspecting(false);
        }
      }
    }, 50);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [attachedFilesSignature, mode, isProcessing]);

  const handleSendClick = useCallback(async (overrideText?: string, bypassInvalidGuard = false) => {
    const canBypassInvalid =
      bypassInvalidGuard && !isProcessing && !isNegative && Boolean(imageFile || imageFiles.length > 0);
    if ((!canSend && !canBypassInvalid) || isNegative) {
      if (isNegative) {
        handleNegativeCreditsRedirect('send_button_blocked');
      }
      return;
    }
    if (mode === 'first-time') {
      clearLandingExamContext();
      landingContextAppliedRef.current = true;
    }
    // Abort any in-flight pre-inspect request once the user submits
    if (preInspectAbortRef.current) {
      preInspectAbortRef.current.abort();
      preInspectAbortRef.current = null;
    }
    if (lastPreInspectTokenRef.current) {
      setPendingPreInspectContext({ preInspectToken: lastPreInspectTokenRef.current });
    }
    setIsPreInspecting(false);
    const textToSend = typeof overrideText === 'string' ? overrideText : combinedInput;
    const fileToSend = imageFile;
    const filesToSend = imageFiles;

    const markingFileCount = (isMultiImage && filesToSend.length > 0)
      ? filesToSend.length
      : (fileToSend ? 1 : 0);

    if (markingFileCount > 0) {
      trackFunnelEvent('marking_submit_clicked', {
        type: 'funnel',
        isGuest: !user,
        fileCount: markingFileCount,
        hasMarkScheme: Boolean(preInspectResult?.hasMarkScheme),
        preInspectSessionId: preInspectResult?.preInspectSessionId || getLatestPreInspectSessionId() || null
      }, user?.uid || null);
    }

    let success = true;

    if (isMultiImage && filesToSend.length > 0) {
      // Multi-image mode
      const handler = mode === 'first-time' ? onAnalyzeMultiImage : onFollowUpMultiImage;
      if (handler) {
        const result = await (handler as any)(filesToSend, textToSend);
        if (result === false) success = false;
      } else {
        // Fallback: Process each file individually using single image handlers
        for (let i = 0; i < filesToSend.length; i++) {
          const file = filesToSend[i];
          const singleHandler = mode === 'first-time' ? onAnalyzeImage : onFollowUpImage;
          const fileText = filesToSend.length > 1 ? `${textToSend} (File ${i + 1}/${filesToSend.length})` : textToSend;
          const result = await (singleHandler as any)(file, fileText);
          if (result === false) {
            success = false;
            break;
          }
        }
      }
    } else if (fileToSend) {
      // Single image mode
      const handler = mode === 'first-time' ? onAnalyzeImage : onFollowUpImage;
      const result = await (handler as any)(fileToSend, textToSend);
      if (result === false) success = false;
    } else if (textToSend) {
      // Text only
      if (isFollowUp) {
        const result = await (onSendMessage as any)(textToSend);
        if (result === false) success = false;
      } else if (isModelAnswerMode) {
        const result = await (onGenerateModelAnswer as any)(textToSend);
        if (result === false) success = false;
      } else if (isMarkingSchemeMode) {
        const result = await (onExplainMarkingScheme as any)(textToSend);
        if (result === false) success = false;
      } else {
        const result = await (onSendMessage as any)(textToSend);
        if (result === false) success = false;
      }
    }

    if (success) {
      clearLandingExamContext();
      landingContextAppliedRef.current = true;
      setChatInput('');
      setSelectedPaper(null);
      setSelectedTags([]);
      setSelectedQualification(null);
      setSelectedBoard(null);
      setSelectedSubject(null);
      setShowAutocomplete(false);
      setPaperSuggestionDismissed(false);
      setIsModelAnswerMode(false);
      setIsMarkingSchemeMode(false);
      setPreviewImage(null);
      setImageFile(null);
      setPreviewImages([]);
      setImageFiles([]);
      setIsMultiImage(false);
      setIsExpanded(false);
      setFileSizeWarning(null);
      setPreInspectResult(null);
      setLatestPreInspectSessionId(null);
      setIsPreInspecting(false);
      setPreInspectDismissed(false);

      // Finalize Mobile Session if it exists
      if (mobileSessionId) {
        mobileUploadService.cleanupSession(mobileSessionId);
        setMobileSessionId('');
      }

      // Clear the file input element to prevent duplicate uploads
      const fileInput = document.getElementById('unified-file-input') as HTMLInputElement;
      if (fileInput) {
        fileInput.value = '';
      }
    }
  }, [
    canSend, isNegative, isProcessing, combinedInput, imageFile, imageFiles, isMultiImage, mode,
    onAnalyzeImage, onFollowUpImage, onAnalyzeMultiImage, onFollowUpMultiImage, onSendMessage,
    onGenerateModelAnswer, onExplainMarkingScheme, isModelAnswerMode, isMarkingSchemeMode, handleNegativeCreditsRedirect,
    user, preInspectResult
  ]);

  const handlePreInspectAction = useCallback((suggestion: PreInspectSuggestionAction) => {
    if (suggestion.action === 'attach_file') {
      const fileInput = document.getElementById('unified-file-input') as HTMLInputElement | null;
      fileInput?.click();
      return;
    }
    if (suggestion.action === 'replace_file') {
      removePreview();
      const fileInput = document.getElementById('unified-file-input') as HTMLInputElement | null;
      if (fileInput) {
        fileInput.value = '';
        fileInput.click();
      }
      return;
    }
    if (suggestion.action === 'prefill') {
      setChatInput(suggestion.prompt || '');
      setPreInspectDismissed(true);
      inputRef.current?.focus();
      return;
    }
    if (suggestion.action === 'submit_generic_rubric') {
      setPendingPreInspectContext({
        preInspectToken: preInspectResult?.preInspectToken || null,
        allowGenericSubjectMarking: true,
      });
      void handleSendClick(suggestion.prompt ?? combinedInput);
      return;
    }
    if (suggestion.action === 'submit') {
      void handleSendClick(typeof suggestion.prompt === 'string' ? suggestion.prompt : combinedInput);
    }
  }, [removePreview, preInspectResult, handleSendClick, combinedInput]);

  useEffect(() => {
    if (matchedPaper || showAutocomplete) {
      setPaperSuggestionDismissed(false);
    }
  }, [matchedPaper, showAutocomplete, selectedBoard, selectedSubject]);

  const handlePaperSuggestionAction = useCallback((action: 'model_answer' | 'marking_scheme' | 'upload' | 'scan' | 'browse_papers') => {
    if (action === 'browse_papers') {
      setShowAutocomplete(true);
      return;
    }
    if (isNegative) {
      handleNegativeCreditsRedirect(`paper_suggestion_${action}`);
      return;
    }
    if (action === 'upload') {
      setIsModelAnswerMode(false);
      setIsMarkingSchemeMode(false);
      handleUploadClick();
      return;
    }
    if (action === 'scan') {
      setIsModelAnswerMode(false);
      setIsMarkingSchemeMode(false);
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (isMobile) {
        handleOpenCameraHandoff();
      } else {
        setIsMobileUploadOpen(true);
      }
      return;
    }
    if (!matchedPaper || isProcessing) return;

    trackFunnelEvent('paper_suggestion_action_clicked', {
      action,
      paper: matchedPaper,
    }, user?.uid || null);

    if (action === 'model_answer') {
      setIsMarkingSchemeMode(false);
      setIsModelAnswerMode(true);
      inputRef.current?.focus();
    } else if (action === 'marking_scheme') {
      setIsModelAnswerMode(false);
      setIsMarkingSchemeMode(true);
      inputRef.current?.focus();
    }
  }, [
    isNegative,
    handleNegativeCreditsRedirect,
    setIsModelAnswerMode,
    setIsMarkingSchemeMode,
    handleUploadClick,
    handleOpenCameraHandoff,
    matchedPaper,
    isProcessing,
    user?.uid,
  ]);

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!canSend || isNegative) {
        if (isNegative) {
          handleNegativeCreditsRedirect('send_button_blocked');
        }
        return;
      }
      handleSendClick();
    } else if (e.key === 'Backspace' && chatInput === '' && selectedTags.length > 0) {
      // If user presses Backspace with empty input, remove the last tag
      removeTag(selectedTags[selectedTags.length - 1]);
    }
  };

  const handleModelSelection = useCallback((newModel: string) => {
    // Follow-up model is not allowed to change; it must stay the same as the session's first selected model
    if (currentSession && currentSession.messages && currentSession.messages.length > 0) {
      return;
    }
    // If user is trying to change away from defaultModel, check permissions
    if (newModel !== defaultModel && !canSelectModel) {
      setShowUpgradeModal(true);
      return;
    }
    onModelChange(newModel);
  }, [canSelectModel, onModelChange, defaultModel, currentSession]);

  // V16.4: Background Mobile Sync Logic
  const handleMobileImages = useCallback(async (imageUrls: string[]) => {
    try {
      const newFiles: File[] = [];
      for (let i = 0; i < imageUrls.length; i++) {
        const url = imageUrls[i];
        const response = await fetch(url);
        const blob = await response.blob();
        const filename = `mobile-scan-${Date.now()}-${i}.jpg`;
        newFiles.push(new File([blob], filename, { type: 'image/jpeg' }));
      }

      // Collect existing files/previews
      let currentFiles: File[] = [];
      let currentPreviews: string[] = [];

      // If we already had a single image, convert it to the array
      if (imageFile) {
        currentFiles = [imageFile];
        currentPreviews = [previewImage!];
      } else if (imageFiles.length > 0) {
        currentFiles = [...imageFiles];
        currentPreviews = [...previewImages];
      }

      const combinedFiles = [...currentFiles, ...newFiles];
      const combinedPreviews = [...currentPreviews, ...imageUrls];

      if (combinedFiles.length === 1) {
        setImageFile(combinedFiles[0]);
        setImageFiles([]);
        setPreviewImage(combinedPreviews[0]);
        setPreviewImages([]);
        setIsMultiImage(false);
      } else {
        setImageFiles(combinedFiles);
        setImageFile(null);
        setPreviewImage(null);
        setPreviewImages(combinedPreviews);
        setIsMultiImage(true);
      }
      setIsExpanded(true);

      // Cleanup session persistence after successful receipt
      localStorage.removeItem('active_mobile_session_id');
    } catch (err) {
      console.error('Failed to process mobile images:', err);
    }
  }, [imageFile, imageFiles, previewImage, previewImages, setImageFile, setImageFiles, setPreviewImage, setPreviewImages, setIsMultiImage, setIsExpanded]);

  // The actual background listener
  useEffect(() => {
    if (!mobileSessionId) return;

    console.log("[MobileSync] Background listener active for:", mobileSessionId);
    const unsubscribe = mobileUploadService.listenToSession(mobileSessionId, (session) => {
      if (session && session.status === 'completed' && session.imageUrls && session.imageUrls.length > 0) {
        console.log("[MobileSync] Batch detected in background!");
        handleMobileImages(session.imageUrls);
        // Reset immediately for the next batch
        mobileUploadService.resetSession(mobileSessionId);
      }
    });

    return () => unsubscribe();
  }, [mobileSessionId, handleMobileImages]);

  const handleError = (error: Error) => {
    console.error("Component Error:", error);
  };

  const selectedPaperMeta = useMemo(
    () => (selectedPaper ? parsePaperCardMeta(selectedPaper) : null),
    [selectedPaper, parsePaperCardMeta]
  );

  return (
    <>
      {mode === 'first-time' && !showAutocomplete && (
        <div className={`chat-title-section ${isExpanded ? 'shift-up' : ''}`}>
          <div className="user-greeting">
            <Sparkles size={18} className="greeting-sparkle" />
            <span>Hi {user?.displayName?.split(' ')[0] || 'there'}</span>
          </div>
          <p className="chat-title-greeting">
            What are we marking today?
          </p>
        </div>
      )}

      {mode === 'first-time' && showAutocomplete && (
        <div className="past-papers-gallery" ref={dropdownRef}>
          {/* Level 1: Qualifications / Exam Levels (loaded dynamically from DB) */}
          {metadata.qualifications.length > 0 && (
            <div className="past-papers-gallery-top">
              <div className="past-papers-tabs" role="tablist" aria-label="Exam levels">
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedQualification === null}
                  className={`past-papers-tab ${selectedQualification === null ? 'active' : ''}`}
                  onClick={() => handleQualificationSelect(null)}
                >
                  All Levels
                </button>
                {metadata.qualifications.map((qual: string) => (
                  <button
                    key={qual}
                    type="button"
                    role="tab"
                    aria-selected={selectedQualification === qual}
                    className={`past-papers-tab ${selectedQualification === qual ? 'active' : ''}`}
                    onClick={() => handleQualificationSelect(selectedQualification === qual ? null : qual)}
                  >
                    {qual}
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="autocomplete-close-btn"
                onClick={() => setShowAutocomplete(false)}
                title="Close Past Papers"
              >
                <X size={16} />
              </button>
            </div>
          )}

          {/* Level 2: Exam Boards (dynamically cascaded from selected Level) */}
          <div className={metadata.qualifications.length > 0 ? 'past-papers-subfilters' : 'past-papers-gallery-top'}>
            <div className={metadata.qualifications.length > 0 ? 'past-papers-subfilters' : 'past-papers-tabs'} role="tablist" aria-label="Exam boards">
              <button
                type="button"
                role="tab"
                aria-selected={selectedBoard === null}
                className={`${metadata.qualifications.length > 0 ? 'past-papers-subtab' : 'past-papers-tab'} ${selectedBoard === null ? 'active' : ''}`}
                onClick={() => handleBoardSelect(null)}
              >
                All Boards
              </button>
              {availableBoards.map((board: string) => (
                <button
                  key={board}
                  type="button"
                  role="tab"
                  aria-selected={selectedBoard === board}
                  className={`${metadata.qualifications.length > 0 ? 'past-papers-subtab' : 'past-papers-tab'} ${selectedBoard === board ? 'active' : ''}`}
                  onClick={() => handleBoardSelect(selectedBoard === board ? null : board)}
                >
                  {board}
                </button>
              ))}
            </div>
            {metadata.qualifications.length === 0 && (
              <button
                type="button"
                className="autocomplete-close-btn"
                onClick={() => setShowAutocomplete(false)}
                title="Close Past Papers"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {/* Level 3: Subjects (dynamically cascaded from Level + Board) */}
          {availableSubjects.length > 0 && (
            <div className="past-papers-subfilters" role="tablist" aria-label="Subjects">
              <button
                type="button"
                role="tab"
                aria-selected={selectedSubject === null}
                className={`past-papers-subtab ${selectedSubject === null ? 'active' : ''}`}
                onClick={() => {
                  setSelectedSubject(null);
                  setHighlightedIndex(-1);
                }}
              >
                All Subjects
              </button>
              {availableSubjects.map((subject: string) => (
                <button
                  type="button"
                  key={subject}
                  role="tab"
                  aria-selected={selectedSubject === subject}
                  className={`past-papers-subtab ${selectedSubject === subject ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedSubject(selectedSubject === subject ? null : subject);
                    setHighlightedIndex(-1);
                  }}
                >
                  {subject}
                </button>
              ))}
            </div>
          )}

          {/* Clean single-column list items */}
          {isMetadataLoading && metadata.papers.length === 0 ? (
            <div className="past-papers-empty">
              Loading past papers...
            </div>
          ) : filteredResults.length > 0 ? (
            <div className="autocomplete-results-list past-papers-list">
              {filteredResults.map((result: string, index: number) => {
                const isSelected = selectedPaper === result;
                return (
                  <div
                    key={result}
                    className={`autocomplete-item ${index === highlightedIndex ? 'highlighted' : ''} ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleSuggestionClick(result)}
                  >
                    <Brain size={12} className="suggestion-icon" />
                    <span className="suggestion-text">{formatPaperDisplayLabel(result)}</span>
                    {isSelected && <Check size={12} className="check-icon" />}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="past-papers-empty">
              No matching past papers found. Try clearing a filter or typing another paper code.
            </div>
          )}
        </div>
      )}

      <div className={`followup-chat-input-bar ${isExpanded ? 'expanded' : ''} ${mode}`}>
        <div className="followup-input-wrapper">
          {mode !== 'first-time' && contextQuestionId && (
            <div className="context-chip-container">
              <div className="context-chip">
                <Brain size={12} />
                <span className="chip-label">Question {contextQuestionId} Focused</span>
                <span className="chip-sublabel">AUTO</span>
                <button
                  onClick={() => setContextQuestionId?.(null)}
                  className="context-chip-close"
                >
                  <X size={12} />
                </button>
              </div>
            </div>
          )}
          {mode === 'first-time' && !isProcessing && attachedFilesList.length > 0 && (!preInspectDismissed || isInvalidPreInspect) && (isPreInspecting || preInspectResult) && (
            <div className="pre-inspect-panel" role="status" aria-live="polite">
              {isPreInspecting ? (
                <div className="pre-inspect-loading-row">
                  <Sparkles size={13} className="pre-inspect-spin" />
                  <span>Checking file…</span>
                </div>
              ) : preInspectResult ? (
                <>
                  <div className="pre-inspect-header">
                    <span className={`pre-inspect-title ${preInspectResult.isWarning || isInvalidPreInspect ? 'pre-inspect-title--warning' : ''}`}>
                      {preInspectResult.bannerTitle}
                    </span>
                    {!isInvalidPreInspect && (
                      <button
                        type="button"
                        className="pre-inspect-dismiss"
                        onClick={() => setPreInspectDismissed(true)}
                        title="Dismiss"
                        aria-label="Dismiss"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  {preInspectResult.suggestions && preInspectResult.suggestions.length > 0 && (
                    <div className="pre-inspect-list">
                      {preInspectResult.suggestions.map((suggestion) => (
                        <button
                          key={suggestion.id}
                          type="button"
                          className="pre-inspect-list-row"
                          onClick={() => handlePreInspectAction(suggestion)}
                        >
                          <Lightbulb size={14} className="pre-inspect-row-icon" />
                          <span>{suggestion.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {isInvalidPreInspect && (
                    <div className="pre-inspect-invalid-override">
                      <button
                        type="button"
                        className="pre-inspect-override-link"
                        onClick={() => handleSendClick(undefined, true)}
                      >
                        This is my homework — mark anyway
                      </button>
                    </div>
                  )}
                </>
              ) : null}
            </div>
          )}

          {mode === 'first-time' && !isProcessing && attachedFilesList.length === 0 && !paperSuggestionDismissed && (matchedPaper || showAutocomplete) && (
            <div className="pre-inspect-panel" role="status" aria-live="polite">
              {matchedPaper ? (
                <>
                  <div className="pre-inspect-header">
                    <span className="pre-inspect-title">
                      What would you like to do with {selectedPaperMeta ? `${selectedPaperMeta.title} (${selectedPaperMeta.subtitle})` : formatPaperDisplayLabel(matchedPaper)}?
                    </span>
                    <button
                      type="button"
                      className="pre-inspect-dismiss"
                      onClick={() => setPaperSuggestionDismissed(true)}
                      title="Dismiss"
                      aria-label="Dismiss"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="pre-inspect-list">
                    <button
                      type="button"
                      className="pre-inspect-list-row"
                      onClick={() => handlePaperSuggestionAction('model_answer')}
                    >
                      <Sparkles size={14} className="pre-inspect-row-icon" />
                      <span>Generate model answers for this paper</span>
                    </button>
                    <button
                      type="button"
                      className="pre-inspect-list-row"
                      onClick={() => handlePaperSuggestionAction('marking_scheme')}
                    >
                      <BookOpen size={14} className="pre-inspect-row-icon" />
                      <span>Explain the official marking scheme</span>
                    </button>
                    <button
                      type="button"
                      className="pre-inspect-list-row"
                      onClick={() => handlePaperSuggestionAction('upload')}
                    >
                      <Paperclip size={14} className="pre-inspect-row-icon" />
                      <span>Upload your completed answers to mark (PDF or photos)</span>
                    </button>
                    <button
                      type="button"
                      className="pre-inspect-list-row"
                      onClick={() => handlePaperSuggestionAction('scan')}
                    >
                      <Smartphone size={14} className="pre-inspect-row-icon" />
                      <span>Scan your handwritten answers with camera</span>
                    </button>
                    {!showAutocomplete && (
                      <button
                        type="button"
                        className="pre-inspect-list-row"
                        onClick={() => handlePaperSuggestionAction('browse_papers')}
                      >
                        <Library size={14} className="pre-inspect-row-icon" />
                        <span>Choose a different past paper</span>
                      </button>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="pre-inspect-header">
                    <span className="pre-inspect-title">
                      What would you like to do{selectedQualification || selectedBoard || selectedSubject ? ` (${[selectedQualification, selectedBoard, selectedSubject].filter(Boolean).join(' · ')})` : ''}?
                    </span>
                    <button
                      type="button"
                      className="pre-inspect-dismiss"
                      onClick={() => setPaperSuggestionDismissed(true)}
                      title="Dismiss"
                      aria-label="Dismiss"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="pre-inspect-list">
                    <button
                      type="button"
                      className="pre-inspect-list-row"
                      onClick={() => {
                        if (filteredResults.length > 0) {
                          setHighlightedIndex(0);
                          const listEl = dropdownRef.current?.querySelector('.past-papers-list');
                          listEl?.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                      }}
                    >
                      <Sparkles size={14} className="pre-inspect-row-icon" />
                      <span>Select a past paper from the list above for model answers or mark schemes</span>
                    </button>
                    <button
                      type="button"
                      className="pre-inspect-list-row"
                      onClick={() => handlePaperSuggestionAction('upload')}
                    >
                      <Paperclip size={14} className="pre-inspect-row-icon" />
                      <span>Upload your completed answers to mark (PDF or photos)</span>
                    </button>
                    <button
                      type="button"
                      className="pre-inspect-list-row"
                      onClick={() => handlePaperSuggestionAction('scan')}
                    >
                      <Smartphone size={14} className="pre-inspect-row-icon" />
                      <span>Scan your handwritten answers with camera</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <div
            className={`followup-single-line-container ${isExpanded ? 'expanded' : ''} ${isNegative ? 'negative-credits' : ''} ${isDragging ? 'drag-over' : ''}`}
            onDragEnter={handleDragEnter}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {isNegative && (
              <div className="negative-credits-warning">
                <span className="warning-icon">⚠️</span>
                <span>You have insufficient credits. Please top up or upgrade to continue.</span>
                <button
                  className="warning-action-btn"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleNegativeCreditsRedirect('chat_banner_topup');
                  }}
                >
                  Top Up
                </button>
              </div>
            )}

            {((mode === 'first-time' && selectedPaper && selectedPaperMeta) ||
              (isExpanded && ((previewImage || previewImages.length > 0) || (imageFile && isPDF(imageFile)) || (imageFiles.length > 0 && imageFiles.some(file => isPDF(file)))))) && (
              <div className="composer-attachments-strip">
                {mode === 'first-time' && selectedPaper && selectedPaperMeta && (
                  <div className="attachment-tile paper-tile" title={`${selectedPaperMeta.title} · ${selectedPaperMeta.subtitle}`}>
                    <span className="attachment-tile-badge">PAPER</span>
                    <div className="attachment-tile-footer">
                      <span className="attachment-tile-title">{selectedPaperMeta.title}</span>
                      <span className="attachment-tile-sub">{selectedPaperMeta.subtitle}</span>
                    </div>
                    <button
                      type="button"
                      className="attachment-tile-remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedPaper(null);
                      }}
                      title="Remove attached paper"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}

                {isExpanded && isMultiImage && imageFiles.map((file, index) => {
                  if (isPDF(file)) {
                    return (
                      <div key={`pdf-${index}`} className="attachment-tile pdf-tile" title={file.name}>
                        <div className="attachment-tile-pdf-header">
                          <span className="attachment-tile-pdf-icon">
                            <FileText size={13} />
                          </span>
                          <span className="attachment-tile-badge">PDF</span>
                        </div>
                        <div className="attachment-tile-footer">
                          <span className="attachment-tile-filename">{file.name}</span>
                        </div>
                        <button
                          type="button"
                          className="attachment-tile-remove"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeImageAtIndex(index);
                          }}
                          title="Remove PDF"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    );
                  }
                  const imageIndex = imageFiles.slice(0, index).filter(f => !isPDF(f)).length;
                  const preview = previewImages[imageIndex];
                  return (
                    <div key={`img-${index}`} className="attachment-tile image-tile">
                      <img
                        src={preview}
                        alt={`Page ${index + 1}`}
                        className="attachment-tile-img"
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveImageIndex(imageIndex);
                          setShowImageMode(true);
                        }}
                      />
                      <button
                        type="button"
                        className="attachment-tile-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeImageAtIndex(index);
                        }}
                        title="Remove image"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  );
                })}

                {isExpanded && !isMultiImage && imageFile && isPDF(imageFile) && (
                  <div className="attachment-tile pdf-tile" title={imageFile.name}>
                    <div className="attachment-tile-pdf-header">
                      <span className="attachment-tile-pdf-icon">
                        <FileText size={13} />
                      </span>
                      <span className="attachment-tile-badge">PDF</span>
                    </div>
                    <div className="attachment-tile-footer">
                      <span className="attachment-tile-filename">{imageFile.name}</span>
                    </div>
                    <button
                      type="button"
                      className="attachment-tile-remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        removePreview();
                      }}
                      title="Remove PDF"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}

                {isExpanded && !isMultiImage && !(imageFile && isPDF(imageFile)) && previewImage && (
                  <div className="attachment-tile image-tile">
                    <img
                      src={previewImage}
                      alt="Preview"
                      className="attachment-tile-img"
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveImageIndex(0);
                        setShowImageMode(true);
                      }}
                    />
                    <button
                      type="button"
                      className="attachment-tile-remove"
                      onClick={(e) => {
                        e.stopPropagation();
                        removePreview();
                      }}
                      title="Remove image"
                    >
                      <X size={12} />
                    </button>
                  </div>
                )}
              </div>
            )}
            <div className="followup-controls-row">
              <div className="followup-text-wrapper">
                <textarea
                  ref={inputRef}
                  rows={mode === 'follow-up' ? 1 : 2}
                  value={chatInput}
                  onChange={handleInputChange}
                  onKeyPress={handleKeyPress}
                  onPaste={handlePaste}
                  placeholder={
                    isProcessing
                      ? "AI is processing..."
                      : mode === 'follow-up'
                        ? "Ask a follow-up question about your marks..."
                        : selectedPaper && isModelAnswerMode
                          ? "Press Enter or click ↑ to generate model answer..."
                          : selectedPaper && isMarkingSchemeMode
                            ? "Press Enter or click ↑ to explain mark scheme..."
                            : selectedPaper && !(imageFile || imageFiles.length > 0)
                              ? "Upload your answers to mark, or choose an action below..."
                              : isModelAnswerMode
                                ? "Search or select a past paper to generate a model answer (e.g. 1MA1/2H, 8700/1)..."
                                : isMarkingSchemeMode
                                  ? "Search or select a past paper to explain its mark scheme (e.g. 1MA1/2H, 8700/1)..."
                                  : (imageFile || imageFiles.length > 0)
                                    ? "Add instructions or press send to mark..."
                                    : "Drop an exam paper, mark scheme, or enter a code (e.g. 1MA1/2H, 0610/41)..."
                  }
                  disabled={isProcessing}
                  className="followup-text-input"
                />
                {fileSizeWarning && (
                  <div className="input-validation-message">
                    <span className="warning-icon">⚠️</span>
                    <span>{fileSizeWarning}</span>
                  </div>
                )}
                {showValidationWarning && (
                  <div className="input-validation-message">
                    <span className="warning-icon">⚠️</span>
                    <span>
                      {(() => {
                        switch (validationMessageType) {
                          case 'ambiguous_tier':
                            return 'Multiple papers found. Please specify the tier (e.g., Higher or Foundation).';
                          case 'ambiguous_series':
                            return 'Multiple papers found. Please specify the year/series (e.g., June 2022).';
                          case 'ambiguous_both':
                            return 'Multiple papers found. Please select a specific paper from the suggestions below.';
                          case 'not_found':
                          default:
                            return 'Please select a valid exam paper to continue';
                        }
                      })()}
                    </span>
                  </div>
                )}
              </div>
              <div className="followup-buttons-row">
                <div className="followup-left-buttons">
                  {mode === 'first-time' ? (
                    <>
                    <div className="plus-menu-anchor" ref={plusMenuRef}>
                      <button
                        type="button"
                        className={`followup-upload-button add-files-btn plus-menu-trigger ${showPlusMenu ? 'open' : ''} ${isNegative ? 'disabled' : ''}`}
                        onClick={() => {
                          if (isNegative) {
                            handleNegativeCreditsRedirect('plus_menu_blocked');
                            return;
                          }
                          if (!showPlusMenu) {
                            const rect = plusMenuRef.current?.getBoundingClientRect();
                            const spaceBelow = rect ? window.innerHeight - rect.bottom : 400;
                            setPlusMenuOpenUpward(spaceBelow < 300);
                          }
                          setShowPlusMenu((prev) => !prev);
                        }}
                        disabled={isProcessing || isNegative}
                        title={
                          isNegative
                            ? "You have exhausted your credits. Please top up to continue."
                            : "Upload files, scan, browse past papers, or switch modes"
                        }
                        aria-expanded={showPlusMenu}
                        aria-haspopup="menu"
                      >
                        <span className="btn-icon plus-menu-icon">
                          <Plus size={20} />
                        </span>
                      </button>

                      {showPlusMenu && (
                        <div className={`plus-dropdown-menu ${plusMenuOpenUpward ? 'open-upward' : ''}`} role="menu">
                          <button
                            type="button"
                            className="plus-dropdown-item"
                            role="menuitem"
                            onClick={() => {
                              setShowPlusMenu(false);
                              setIsModelAnswerMode(false);
                              setIsMarkingSchemeMode(false);
                              handleUploadClick();
                            }}
                          >
                            <Paperclip size={16} className="plus-dropdown-icon" />
                            <span className="plus-dropdown-text">
                              <span className="plus-dropdown-label">Upload files</span>
                              <span className="plus-dropdown-hint">PDF or photos · Mark scheme optional &amp; free</span>
                            </span>
                          </button>

                          <button
                            type="button"
                            className="plus-dropdown-item"
                            role="menuitem"
                            onClick={() => {
                              setShowPlusMenu(false);
                              setIsModelAnswerMode(false);
                              setIsMarkingSchemeMode(false);
                              const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
                              if (isMobile) {
                                handleOpenCameraHandoff();
                              } else {
                                setIsMobileUploadOpen(true);
                              }
                            }}
                          >
                            <Smartphone size={16} className="plus-dropdown-icon" />
                            <span className="plus-dropdown-text">
                              <span className="plus-dropdown-label">Scan with Camera</span>
                            </span>
                          </button>

                          <button
                            type="button"
                            className={`plus-dropdown-item ${showAutocomplete ? 'active' : ''}`}
                            role="menuitem"
                            onClick={() => {
                              setShowPlusMenu(false);
                              setShowAutocomplete((prev) => !prev);
                            }}
                          >
                            <Library size={16} className="plus-dropdown-icon" />
                            <span className="plus-dropdown-text">
                              <span className="plus-dropdown-label">Past Papers</span>
                            </span>
                            {showAutocomplete && <Check size={14} className="plus-dropdown-check" />}
                          </button>

                          <div className="plus-dropdown-divider" />

                          <button
                            type="button"
                            className={`plus-dropdown-item ${isModelAnswerMode ? 'active' : ''}`}
                            role="menuitem"
                            onClick={() => {
                              setShowPlusMenu(false);
                              const newVal = !isModelAnswerMode;
                              setIsModelAnswerMode(newVal);
                              if (newVal) {
                                setIsMarkingSchemeMode(false);
                                if (!selectedPaper) setShowAutocomplete(true);
                                inputRef.current?.focus();
                              }
                            }}
                          >
                            <Sparkles size={16} className="plus-dropdown-icon" />
                            <span className="plus-dropdown-text">
                              <span className="plus-dropdown-label">Generate Model Answer</span>
                            </span>
                            {isModelAnswerMode && <Check size={14} className="plus-dropdown-check" />}
                          </button>

                          <button
                            type="button"
                            className={`plus-dropdown-item ${isMarkingSchemeMode ? 'active' : ''}`}
                            role="menuitem"
                            onClick={() => {
                              setShowPlusMenu(false);
                              const newVal = !isMarkingSchemeMode;
                              setIsMarkingSchemeMode(newVal);
                              if (newVal) {
                                setIsModelAnswerMode(false);
                                if (!selectedPaper) setShowAutocomplete(true);
                                inputRef.current?.focus();
                              }
                            }}
                          >
                            <BookOpen size={16} className="plus-dropdown-icon" />
                            <span className="plus-dropdown-text">
                              <span className="plus-dropdown-label">Explain Mark Scheme</span>
                            </span>
                            {isMarkingSchemeMode && <Check size={14} className="plus-dropdown-check" />}
                          </button>
                        </div>
                      )}
                    </div>

                    {isModelAnswerMode && (
                      <span className="inline-mode-pill">
                        <Sparkles size={14} />
                        <span>Model Answer</span>
                        <button
                          type="button"
                          className="inline-mode-pill-remove"
                          onClick={() => setIsModelAnswerMode(false)}
                          title="Exit Model Answer mode"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    )}

                    {isMarkingSchemeMode && (
                      <span className="inline-mode-pill">
                        <BookOpen size={14} />
                        <span>Mark Scheme</span>
                        <button
                          type="button"
                          className="inline-mode-pill-remove"
                          onClick={() => setIsMarkingSchemeMode(false)}
                          title="Exit Mark Scheme mode"
                        >
                          <X size={12} />
                        </button>
                      </span>
                    )}
                  </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={`followup-upload-button add-files-btn ${isNegative ? 'disabled' : ''}`}
                        onClick={handleUploadClick}
                        disabled={isProcessing || isNegative}
                        title={
                          isNegative
                            ? "You have exhausted your credits. Please top up to continue."
                            : "Upload PDF or photos · Mark scheme optional (free, doesn't count toward page limit)"
                        }
                      >
                        <span className="btn-icon"><Plus size={16} /></span>
                        <span className="btn-text">Add Files</span>
                      </button>

                      <button
                        type="button"
                        className={`followup-upload-button mobile-scan-btn scan-camera-btn ${isNegative ? 'disabled' : ''}`}
                        onClick={() => {
                          if (isNegative) {
                            handleNegativeCreditsRedirect('camera_button_blocked');
                            return;
                          }
                          const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
                          if (isMobile) {
                            handleOpenCameraHandoff();
                          } else {
                            setIsMobileUploadOpen(true);
                          }
                        }}
                        disabled={isProcessing || isNegative}
                        title={isNegative ? "You have exhausted your credits. Please top up to continue." : "Scan from Mobile"}
                      >
                        <span className="btn-icon"><Smartphone size={16} /></span>
                        <span className="btn-text">Scan with Camera</span>
                      </button>

                      {!isMarkingSchemeMode && (
                        <button
                          type="button"
                          className={`followup-upload-button mode-toggle-btn model-answer-btn ${isModelAnswerMode ? 'active' : ''} ${isNegative ? 'disabled' : ''}`}
                          onClick={() => {
                            if (isNegative) {
                              handleNegativeCreditsRedirect('mode_toggle_blocked');
                              return;
                            }
                            const newVal = !isModelAnswerMode;
                            setIsModelAnswerMode(newVal);
                            if (newVal) setIsMarkingSchemeMode(false);
                          }}
                          disabled={isProcessing || isNegative}
                          title={isNegative ? "You have exhausted your credits. Please top up to continue." : (isModelAnswerMode ? "Switch to Normal Mode" : "Generate Model Answer")}
                        >
                          <span className="btn-icon"><Sparkles size={15} /></span>
                          <span className="btn-text">Generate Model Answer</span>
                        </button>
                      )}

                      {!isModelAnswerMode && (
                        <button
                          type="button"
                          className={`followup-upload-button mode-toggle-btn marking-scheme-btn ${isMarkingSchemeMode ? 'active' : ''} ${isNegative ? 'disabled' : ''}`}
                          onClick={() => {
                            if (isNegative) {
                              handleNegativeCreditsRedirect('mode_toggle_blocked');
                              return;
                            }
                            const newVal = !isMarkingSchemeMode;
                            setIsMarkingSchemeMode(newVal);
                            if (newVal) setIsModelAnswerMode(false);
                          }}
                          disabled={isProcessing || isNegative}
                          title={isNegative ? "You have exhausted your credits. Please top up to continue." : (isMarkingSchemeMode ? "Switch to Normal Mode" : "Explain Mark Scheme")}
                        >
                          <span className="btn-icon"><BookOpen size={15} /></span>
                          <span className="btn-text">Explain Mark Scheme</span>
                        </button>
                      )}
                    </>
                  )}
                </div>
                <div className="followup-right-buttons">
                  {/* 👇 Disable model selection if session exists and has messages (model cannot be changed after session creation) */}
                  <ModelSelector
                    selectedModel={selectedModel}
                    onModelChange={handleModelSelection}
                    disabled={isProcessing || (currentSession && currentSession.messages && currentSession.messages.length > 0)}
                    size={mode === 'first-time' ? 'main' : 'small'}
                    dropdownDirection={mode === 'first-time' ? 'down' : 'up'}
                    onError={handleError}
                  />
                  {/* 👇 FIX 2: Added the required `onError` prop. */}
                  {/* 👇 SendButton disabled logic updated to check combinedInput */}
                  <SendButton
                    onClick={() => handleSendClick()}
                    disabled={!canSend || isNegative}
                    loading={isProcessing}
                    variant={(imageFile || imageFiles.length > 0) && !isInvalidPreInspect ? 'success' : 'primary'}
                    size={mode === 'first-time' ? 'main' : 'small'}
                    onError={handleError}
                  />
                </div>
              </div>
            </div>

            {mode === 'first-time' && matchedPaper && paperSuggestionDismissed && !(imageFile || imageFiles.length > 0) && !isModelAnswerMode && !isMarkingSchemeMode && (
              <div className="composer-bottom-action-strip">
                <button
                  type="button"
                  className="composer-strip-btn primary"
                  onClick={() => handlePaperSuggestionAction('upload')}
                  disabled={isProcessing || isNegative}
                >
                  <Paperclip size={14} />
                  <span>Upload Answers</span>
                </button>

                <button
                  type="button"
                  className="composer-strip-btn"
                  onClick={() => handlePaperSuggestionAction('scan')}
                  disabled={isProcessing || isNegative}
                >
                  <Smartphone size={14} />
                  <span>Scan</span>
                </button>

                <button
                  type="button"
                  className="composer-strip-btn"
                  onClick={() => handlePaperSuggestionAction('model_answer')}
                  disabled={isProcessing || isNegative}
                >
                  <Sparkles size={14} />
                  <span>Model Answer</span>
                </button>

                <button
                  type="button"
                  className="composer-strip-btn"
                  onClick={() => handlePaperSuggestionAction('marking_scheme')}
                  disabled={isProcessing || isNegative}
                >
                  <BookOpen size={14} />
                  <span>Explain Mark Scheme</span>
                </button>
              </div>
            )}
          </div>

          {mode === 'first-time' && !showAutocomplete && (
            <div className="composer-below-section">
              <p className="composer-capability-note">
                {matchedPaper && (isModelAnswerMode || isMarkingSchemeMode)
                  ? `Ready — press Enter or click ↑ to ${isModelAnswerMode ? 'generate model answer' : 'explain mark scheme'}`
                  : 'Official GCSE & A-Level Maths & English mark schemes built in · Any other subject supported'}
              </p>
            </div>
          )}
        </div>
      </div>

      <input ref={fileInputRef} id="unified-file-input" type="file" accept={FILE_CONSTRAINTS.ACCEPT_ATTR} multiple onChange={handleFileChange} style={{ display: 'none' }} disabled={isProcessing || isNegative} />

      <MobileUploadModal
        isOpen={isMobileUploadOpen}
        onClose={() => setIsMobileUploadOpen(false)}
        onImageReceived={handleMobileImages}
        sessionIdProp={mobileSessionId}
        onSessionCreated={setMobileSessionId}
      />

      {showHandoff && (
        <FileHandoff
          initialType={handoffType}
          onFilesSelected={(files) => processFiles(files)}
          onClose={() => {
            setShowHandoff(false);
            setHandoffType(null);
          }}
          onOpenCamera={handleOpenCameraHandoff}
        />
      )}

      {/* Enterprise Upgrade Modal */}
      <ConfirmationModal
        isOpen={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        onConfirm={() => {
          setShowUpgradeModal(false);
          navigate('/pricing', { state: { fromApp: true, source: 'model_picker_modal' } });
        }}
        title="Upgrade Plan"
        message="Custom model selection is available on Pro and Ultra plans. Would you like to upgrade now and unlock all powerful AI models?"
        confirmText="View Plans"
        cancelText="Maybe Later"
        variant="primary"
      />

      {/* Render Image Mode Modal */}
      {showImageMode && (
        <ImageModeModal
          isOpen={showImageMode}
          images={(isMultiImage ? previewImages : (previewImage ? [previewImage] : [])).map((src, idx) => ({
            id: `preview-${idx}`,
            src,
            filename: `preview-${idx}.jpg`,
            messageId: 'preview',
            messageRole: 'user',
            messageType: 'preview',
            alt: 'Preview Image'
          }))}
          initialImageIndex={activeImageIndex}
          onClose={() => setShowImageMode(false)}
        />
      )}

      {/* Model Answer / Marking Scheme Confirmation Modal */}
      {(() => {
        const isMarkScheme = pendingConfirmationMode === 'markingscheme' || isMarkingSchemeMode;
        return (
          <ConfirmationModal
            isOpen={showModelAnswerConfirmation}
            onClose={() => {
              setShowModelAnswerConfirmation(false);
              setPendingModelAnswerPaper(null);
              setPendingConfirmationMode?.(null);
            }}
            onConfirm={() => {
              if (pendingModelAnswerPaper) {
                if (isMarkScheme) {
                  onExplainMarkingScheme(pendingModelAnswerPaper);
                } else {
                  onGenerateModelAnswer(pendingModelAnswerPaper);
                }
              }
              setShowModelAnswerConfirmation(false);
              setPendingModelAnswerPaper(null);
              setPendingConfirmationMode?.(null);
            }}
            title={isMarkScheme ? "Explain Marking Scheme" : "Generate Model Answers"}
            message={isMarkScheme
              ? `Would you like to explain the marking scheme for "${pendingModelAnswerPaper}"? This will consume credits for AI processing.`
              : `Would you like to generate model answers for "${pendingModelAnswerPaper}"? This will consume credits for AI processing.`
            }
            confirmText={isMarkScheme ? "Explain" : "Generate"}
            cancelText="Cancel"
            variant="primary"
          />
        );
      })()}
    </>
  );
};

export default UnifiedChatInput;