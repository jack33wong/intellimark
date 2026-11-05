import { useState, useEffect, useCallback, useMemo } from 'react';
import ConfigService from '../services/configService';

export interface LocalExamMetadata {
  boards: string[];
  qualifications: string[];
  tiers: string[];
  papers: string[];
  codes: string[];
}

export function usePaperSearch(initialSubject: 'maths' | 'english' | 'custom' | null = null, enabled: boolean = true) {
  const [metadata, setMetadata] = useState<LocalExamMetadata>({
    boards: [],
    qualifications: [],
    tiers: [],
    papers: [],
    codes: [],
  });
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<'maths' | 'english' | 'custom' | null>(initialSubject);

  useEffect(() => {
    let mounted = true;
    ConfigService.getExamMetadata()
      .then((data) => {
        if (mounted && data) setMetadata(data);
      })
      .catch((err) => console.error('Failed to fetch exam metadata:', err));
    return () => { mounted = false; };
  }, []);

  const isEnglishPaper = useCallback((paperStr: string) => {
    return /\b(8700|8702|1EN0|1ET0|J351|J352|C700|C720)\b|english/i.test(paperStr);
  }, []);

  const formatPaperDisplayLabel = useCallback((paperStr: string) => {
    if (/math|english/i.test(paperStr)) return paperStr;
    const isEng = isEnglishPaper(paperStr);
    const subjectLabel = isEng ? 'English Language' : 'Maths';
    if (paperStr.startsWith('GCSE ')) {
      return `GCSE ${subjectLabel} • ${paperStr.slice(5)}`;
    }
    if (paperStr.startsWith('A-Level ')) {
      return `A-Level ${subjectLabel} • ${paperStr.slice(8)}`;
    }
    return `${subjectLabel} • ${paperStr}`;
  }, [isEnglishPaper]);

  const toggleFilterTag = useCallback((tag: string, categoryTags: string[] = []) => {
    setSelectedTags(prev => {
      const isSelected = prev.some(t => t.toLowerCase() === tag.toLowerCase());
      if (isSelected) {
        return prev.filter(t => t.toLowerCase() !== tag.toLowerCase());
      } else {
        const filtered = prev.filter(t => !categoryTags.some(ct => ct.toLowerCase() === t.toLowerCase()));
        return [...filtered, tag];
      }
    });
  }, []);

  const filteredResults = useMemo(() => {
    if (!enabled) return [];
    if (searchQuery.trim().length === 0 && selectedTags.length === 0 && !selectedSubject) {
      return [];
    }

    let filtered = metadata.papers || [];

    if (selectedSubject === 'english') {
      filtered = filtered.filter(p => isEnglishPaper(p));
    } else if (selectedSubject === 'maths') {
      filtered = filtered.filter(p => !isEnglishPaper(p));
    }

    if (selectedTags.length > 0) {
      filtered = filtered.filter((paper: string) =>
        selectedTags.every((tag: string) => paper.toLowerCase().includes(tag.toLowerCase()))
      );
    }

    if (searchQuery.trim().length > 0) {
      const normalize = (t: string) => t.toLowerCase()
        .replace(/\bmathematics\b/g, 'maths')
        .replace(/\benglish language\b/g, 'englang')
        .replace(/\beng lang\b/g, 'englang')
        .replace(/\benglish\b/g, 'englang')
        .replace(/\b(june|may|summer)\b/g, 'summer')
        .replace(/\ba level\b/g, 'alevel')
        .replace(/[-,/]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      const vocabulary = new Set<string>();
      (metadata.boards || []).forEach(b => normalize(b).split(' ').forEach(w => w && vocabulary.add(w)));
      (metadata.qualifications || []).forEach(q => normalize(q).split(' ').forEach(w => w && vocabulary.add(w)));
      (metadata.tiers || []).forEach(t => normalize(t).split(' ').forEach(w => w && vocabulary.add(w)));
      (metadata.papers || []).forEach(p => normalize(p).split(' ').forEach(w => w && vocabulary.add(w)));

      const rawInputTokens = normalize(searchQuery.trim()).split(' ').filter(Boolean);
      const inputTokens = Array.from(new Set(rawInputTokens.filter(k => vocabulary.has(k))));

      if (inputTokens.length > 0) {
        filtered = filtered.filter(p => {
          const paperTokens = normalize(p).split(' ').filter(Boolean);
          return inputTokens.every(it =>
            paperTokens.some(pt => {
              if (pt === it) return true;
              if (/^\d+$/.test(pt) && /^\d+$/.test(it)) return parseInt(pt, 10) === parseInt(it, 10);
              return pt.includes(it);
            })
          );
        });
      }
    }

    const monthOrder: Record<string, number> = {
      january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
      july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
    };

    const parseDate = (s: string) => {
      const parts = s.toLowerCase().split(' - ');
      if (parts.length < 3) return { year: 0, month: 0 };
      const datePart = parts[2].split(',')[0].trim();
      const [month, year] = datePart.split(' ');
      return { year: parseInt(year, 10) || 0, month: monthOrder[month] || 0 };
    };

    return [...filtered].sort((a, b) => {
      const dateA = parseDate(a);
      const dateB = parseDate(b);
      if (dateA.year !== dateB.year) return dateB.year - dateA.year;
      if (dateA.month !== dateB.month) return dateB.month - dateA.month;
      return a.localeCompare(b);
    }).slice(0, 10);
  }, [metadata, searchQuery, selectedTags, selectedSubject, isEnglishPaper, enabled]);

  return {
    metadata,
    searchQuery,
    setSearchQuery,
    selectedTags,
    setSelectedTags,
    selectedSubject,
    setSelectedSubject,
    toggleFilterTag,
    filteredResults,
    formatPaperDisplayLabel,
    isEnglishPaper
  };
}
