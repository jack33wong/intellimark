import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ShieldCheck, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { trackPaperInteraction } from '../../utils/analytics';
import '../../pages/PastPaperShared.css';
import './SupportedPapers.css';

type PaperTab = 'gcse-maths' | 'gcse-english' | 'alevel-maths';

const isEnglishPaper = (codeOrTitle: string = '') =>
    /\b(8700|8702|1EN0|1ET0|J351|J352|C700|C720)\b|english/i.test(codeOrTitle);

const getPaperTypeLabel = (paper: any, isEnglish: boolean) => {
    if (!isEnglish) return paper.type || '';
    const code = (paper.code || paper.name || '').toUpperCase();
    if (code.includes('8700/1') || code.includes('8700-1')) return 'PAPER 1 • CREATIVE';
    if (code.includes('8700/2') || code.includes('8700-2')) return 'PAPER 2 • VIEWPOINTS';
    if (code.includes('1EN0/01') || code.includes('1EN0-01') || code.includes('1EN0/1') || code.includes('1EN0-1')) return 'PAPER 1 • FICTION';
    if (code.includes('1EN0/02') || code.includes('1EN0-02') || code.includes('1EN0/2') || code.includes('1EN0-2')) return 'PAPER 2 • NON-FICTION';
    if (code.includes('J351/01') || code.includes('J351-01') || code.includes('J351/1') || code.includes('J351-1')) return 'PAPER 1 • NON-FICTION';
    if (code.includes('J351/02') || code.includes('J351-02') || code.includes('J351/2') || code.includes('J351-2')) return 'PAPER 2 • LITERARY';
    return paper.type || '';
};

export const SupportedPapers: React.FC = () => {
    const navigate = useNavigate();
    const scrollRefs = React.useRef<(HTMLDivElement | null)[]>([]);

    const handleScroll = (index: number, direction: 'left' | 'right') => {
        const container = scrollRefs.current[index];
        if (container) {
            const scrollAmount = container.clientWidth;
            container.scrollBy({
                left: direction === 'left' ? -scrollAmount : scrollAmount,
                behavior: 'smooth'
            });
        }
    };
    const [activeTab, setActiveTab] = React.useState<PaperTab>('gcse-maths');
    const [examData, setExamData] = React.useState<any>(null);
    const [loading, setLoading] = React.useState(true);

    const isEnglish = activeTab === 'gcse-english';
    const isAlevel = activeTab === 'alevel-maths';

    React.useEffect(() => {
        const fetchData = async () => {
            try {
                const response = await fetch('/api/exams/public-list');
                const json = await response.json();
                if (json.success) {
                    setExamData(json.data);
                }
            } catch (error) {
                console.error('Error fetching exam data:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
    }, []);

    const boards = examData ? [
        {
            name: "Pearson Edexcel",
            displayName: "Edexcel",
            code: isEnglish ? "1EN0" : (isAlevel ? "9MA0" : "1MA1"),
            subjectTitle: isEnglish ? "GCSE Eng Lang" : (isAlevel ? "A-Level Mathematics" : "GCSE Mathematics"),
            toolUrl: isEnglish
                ? `/mark-edexcel-gcse-english-language-past-papers`
                : `/mark-edexcel-${isAlevel ? 'a-level' : 'gcse'}-maths-past-papers`,
            color: "#003057",
            data: examData["Pearson Edexcel"] || {}
        },
        {
            name: "AQA",
            displayName: "AQA",
            code: isEnglish ? "8700" : (isAlevel ? "7357" : "8300"),
            subjectTitle: isEnglish ? "GCSE Eng Lang" : (isAlevel ? "A-Level Mathematics" : "GCSE Mathematics"),
            toolUrl: isEnglish
                ? `/mark-aqa-gcse-english-language-past-papers`
                : `/mark-aqa-${isAlevel ? 'a-level' : 'gcse'}-maths-past-papers`,
            color: "#004B98",
            data: examData["AQA"] || {}
        },
        {
            name: "OCR",
            displayName: "OCR",
            code: isEnglish ? "J351" : (isAlevel ? "H240" : "J560"),
            subjectTitle: isEnglish ? "GCSE Eng Lang" : (isAlevel ? "A-Level Mathematics" : "GCSE Mathematics"),
            toolUrl: isEnglish
                ? `/mark-ocr-gcse-english-language-past-papers`
                : `/mark-ocr-${isAlevel ? 'a-level' : 'gcse'}-maths-past-papers`,
            color: "#002D3A",
            data: examData["OCR"] || {}
        }
    ] : [];

    const getSeriesForBoard = (boardData: any) => {
        if (isAlevel) {
            // Flatten Pure and Stats/Mech for horizontal scroll
            const pure = (boardData.alevel?.pure || []).map((s: any) => ({ ...s, category: 'Pure Mathematics' }));
            const stats = (boardData.alevel?.stats_mech || []).map((s: any) => ({ ...s, category: 'Stats & Mechanics' }));

            // Group by series (e.g. "June 2024") and merge papers
            const seriesGroup: Record<string, any> = {};
            [...pure, ...stats].forEach(s => {
                if (!seriesGroup[s.series]) {
                    seriesGroup[s.series] = { series: s.series, papers: [] };
                }
                seriesGroup[s.series].papers.push(...s.papers);
            });

            return Object.values(seriesGroup).sort((a, b) => {
                const parseDate = (s: string) => {
                    const parts = s.split(' ');
                    if (parts.length < 2) return new Date(0);
                    const months: any = { 'January': 0, 'June': 5, 'November': 10 };
                    return new Date(parseInt(parts[1]), months[parts[0]] || 0);
                };
                return parseDate(b.series).getTime() - parseDate(a.series).getTime();
            });
        }

        // For GCSE Maths vs GCSE English
        const rawSeries = boardData.gcse || [];
        return rawSeries
            .map((s: any) => {
                const filteredPapers = (s.papers || []).filter((p: any) => {
                    const targetStr = `${p.code || ''} ${p.name || ''} ${p.subject || ''}`;
                    const english = isEnglishPaper(targetStr);
                    return isEnglish ? english : !english;
                });
                return {
                    ...s,
                    papers: filteredPapers
                };
            })
            .filter((s: any) => s.papers.length > 0);
    };

    return (
        <section className="supported-papers">
            <div className="papers-container">
                <div className="badge-container center">
                    <span className="performance-badge">Syllabus Coverage</span>
                </div>
                <h2>Extensive Past Paper Support</h2>
                <div className="status-freshness">
                    <span className="live-dot"></span>
                    <span className="status-text">Mark Schemes Updated: October 2026</span>
                </div>

                <div className="supported-papers-tabs" role="tablist">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'gcse-maths'}
                        className={`supported-papers-tab-btn ${activeTab === 'gcse-maths' ? 'active' : ''}`}
                        onClick={() => setActiveTab('gcse-maths')}
                    >
                        <span className="tab-icon">📐</span>
                        <span className="tab-text">GCSE Maths (9-1)</span>
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'gcse-english'}
                        className={`supported-papers-tab-btn ${activeTab === 'gcse-english' ? 'active' : ''}`}
                        onClick={() => setActiveTab('gcse-english')}
                    >
                        <span className="tab-icon">✍️</span>
                        <span className="tab-text">GCSE English Language</span>
                        <span className="tab-badge-new">NEW</span>
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={activeTab === 'alevel-maths'}
                        className={`supported-papers-tab-btn ${activeTab === 'alevel-maths' ? 'active' : ''}`}
                        onClick={() => setActiveTab('alevel-maths')}
                    >
                        <span className="tab-icon">🎓</span>
                        <span className="tab-text">A-Level Maths</span>
                    </button>
                </div>

                <div className="papers-display">
                    {loading ? (
                        <div className="papers-loading">
                            <Loader2 className="spinner" size={40} />
                            <p>Fetching the latest past papers...</p>
                        </div>
                    ) : (
                        boards.map((board, i) => {
                            const seriesData = getSeriesForBoard(board.data);
                            return (
                                <div key={i} className="board-section">
                                    <div className="board-main-header">
                                        <div className="header-top">
                                            <span className="board-logo-pill">
                                                {board.name} ({board.code})
                                            </span>
                                        </div>
                                        <div className="header-bottom">
                                            <a
                                                href={board.toolUrl}
                                                className="board-tool-link"
                                            >
                                                Try the {board.displayName} {board.code} AI Marking Tool →
                                            </a>
                                        </div>
                                    </div>

                                    <div className="board-scroll-wrapper">
                                        <button
                                            className="mobile-pagination-btn left"
                                            onClick={() => handleScroll(i, 'left')}
                                            aria-label="Previous year"
                                        >
                                            <ChevronLeft size={20} />
                                        </button>

                                        <div
                                            className="board-content-scroll"
                                            ref={el => scrollRefs.current[i] = el}
                                        >
                                            {seriesData.length > 0 ? seriesData.map((s: any, si: number) => (
                                                <div key={si} className="series-group">
                                                    <div className="series-header">
                                                        <h4>
                                                            {board.subjectTitle} ({board.code}) {s.series}
                                                        </h4>
                                                        {s.category && (
                                                            <span className="series-category-tag">
                                                                {s.category}
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="series-papers-list">
                                                        {s.papers
                                                            .sort((a: any, b: any) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' }))
                                                            .map((paper: any, pi: number) => {
                                                                const typeLabel = getPaperTypeLabel(paper, isEnglish);
                                                                return (
                                                                <div key={pi} className="paper-row">
                                                                    <div className="paper-info">
                                                                        <span className="paper-count">{paper.name}:</span>
                                                                        <span className="paper-code-tag">{paper.code}</span>
                                                                        {typeLabel && (
                                                                            <span className="paper-type-label">
                                                                                {typeLabel}
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                    <div className="paper-actions">
                                                                        <button
                                                                            onClick={() => {
                                                                                const paperCode = paper.code.replace('/', '-');
                                                                                const parts = s.series.split(' ');
                                                                                const seriesYear = parts[0].substring(0, 3).toUpperCase() + parts[1];
                                                                                const finalCode = `${paperCode}-${seriesYear}`;
                                                                                trackPaperInteraction(finalCode, 'MODEL');
                                                                                navigate(`/app?code=${finalCode}&mode=model`);
                                                                            }}
                                                                            className="action-link model"
                                                                        >
                                                                            Model
                                                                        </button>
                                                                        <button
                                                                            onClick={() => {
                                                                                const paperCode = paper.code.replace('/', '-');
                                                                                const parts = s.series.split(' ');
                                                                                const seriesYear = parts[0].substring(0, 3).toUpperCase() + parts[1];
                                                                                const finalCode = `${paperCode}-${seriesYear}`;
                                                                                trackPaperInteraction(finalCode, 'MARK');
                                                                                navigate(`/app?code=${finalCode}&mode=markingscheme`);
                                                                            }}
                                                                            className="action-link mark"
                                                                        >
                                                                            Mark
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            )) : (
                                                <div className="no-papers-found">
                                                    <p>No {board.subjectTitle} papers found for {board.name}.</p>
                                                </div>
                                            )}
                                        </div>

                                        <button
                                            className="mobile-pagination-btn right"
                                            onClick={() => handleScroll(i, 'right')}
                                            aria-label="Next year"
                                        >
                                            <ChevronRight size={20} />
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                <p className="papers-note">
                    <ShieldCheck size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                    A-Level Further Maths support coming in Summer 2026.
                </p>
            </div>
        </section >
    );
};

export default SupportedPapers;
