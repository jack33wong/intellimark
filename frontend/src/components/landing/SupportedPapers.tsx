import React from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ShieldCheck, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { trackPaperInteraction } from '../../utils/analytics';
import LevelToggle from './LevelToggle';
import '../../pages/PastPaperShared.css';
import './SupportedPapers.css';

const SupportedPapers: React.FC = () => {
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
    const [level, setLevel] = React.useState<'GCSE' | 'A-Level'>('GCSE');
    const [examData, setExamData] = React.useState<any>(null);
    const [loading, setLoading] = React.useState(true);

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
            code: level === 'GCSE' ? "1MA1" : "9MA0",
            color: "#003057",
            data: examData["Pearson Edexcel"] || {}
        },
        {
            name: "AQA",
            displayName: "AQA",
            code: level === 'GCSE' ? "8300" : "7357",
            color: "#004B98",
            data: examData["AQA"] || {}
        },
        {
            name: "OCR",
            displayName: "OCR",
            code: level === 'GCSE' ? "J560" : "H240",
            color: "#002D3A",
            data: examData["OCR"] || {}
        }
    ] : [];

    const getSeriesForBoard = (boardData: any) => {
        if (level === 'GCSE') {
            return boardData.gcse || [];
        } else {
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
                    <span className="status-text">Mark Schemes Updated: Jan 2026</span>
                </div>

                <LevelToggle level={level} onChange={setLevel} />

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
                                                href={`/mark-${board.displayName.toLowerCase()}-${level.toLowerCase()}-maths-past-papers`}
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
                                                            {level} Mathematics ({board.code}) {s.series}
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
                                                                return (
                                                                <div key={pi} className="paper-row">
                                                                    <div className="paper-info">
                                                                        <span className="paper-count">{paper.name}:</span>
                                                                        <span className="paper-code-tag">{paper.code}</span>
                                                                        {paper.type && (
                                                                            <span className="paper-type-label">
                                                                                {paper.type}
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
                                                    <p>No {level} papers found for {board.name}.</p>
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
