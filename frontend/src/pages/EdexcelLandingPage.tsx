import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import HeroAnimation from '../components/layout/HeroAnimation';
import LandingFooter from '../components/layout/LandingFooter';
import SeoHeader from '../components/common/SeoHeader';
import { trackPaperInteraction } from '../utils/analytics';
import LevelToggle, { LevelToggleOption } from '../components/landing/LevelToggle';
import './EdexcelLandingPage.css';
import './PastPaperTable.css';

const isEnglishPaper = (codeOrTitle: string = '') =>
    /\b(8700|8702|1EN0|1ET0|J351|J352|C700|C720)\b|english/i.test(codeOrTitle);

const getEnglishPaperTypeLabel = (code: string = '') => {
    const uc = code.toUpperCase();
    if (uc.includes('1EN0/01') || uc.includes('1EN0-01') || uc.includes('1EN0/1') || uc.includes('1EN0-1')) return 'PAPER 1 • FICTION';
    if (uc.includes('1EN0/02') || uc.includes('1EN0-02') || uc.includes('1EN0/2') || uc.includes('1EN0-2')) return 'PAPER 2 • NON-FICTION';
    return 'UNTIERED';
};

export const EdexcelLandingPage: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const isEnglishRoute = location.pathname.includes('english') ||
        new URLSearchParams(location.search).get('subject') === 'english' ||
        new URLSearchParams(location.search).get('tab') === 'english';

    const [startAnimations, setStartAnimations] = React.useState(false);
    const [activeTab, setActiveTab] = React.useState<LevelToggleOption>(
        isEnglishRoute ? 'gcse-english' : 'gcse-maths'
    );
    const [modelPreviewTab, setModelPreviewTab] = React.useState<'maths' | 'english' | null>(null);
    const isEnglishActive = (modelPreviewTab ?? (activeTab === 'gcse-english' ? 'english' : 'maths')) === 'english';
    const [examData, setExamData] = React.useState<any>(null);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        if (isEnglishRoute) {
            setActiveTab('gcse-english');
        }
    }, [isEnglishRoute]);

    React.useEffect(() => {
        const timer = setTimeout(() => setStartAnimations(true), 100);
        
        const fetchData = async () => {
            try {
                const response = await fetch('/api/exams/public-list');
                const json = await response.json();
                if (json.success) {
                    setExamData(json.data["Pearson Edexcel"] || {});
                }
            } catch (error) {
                console.error('Error fetching exam data:', error);
            } finally {
                setLoading(false);
            }
        };
        fetchData();
        return () => clearTimeout(timer);
    }, []);

    const getSeriesList = () => {
        if (!examData) return [];
        if (activeTab === 'alevel-maths') {
            // Group A-Level by series (merging pure and stats_mech)
            const seriesMap = new Map<string, any>();
            
            const processGroup = (papers: any[]) => {
                papers.forEach((s: any) => {
                    if (!seriesMap.has(s.series)) {
                        seriesMap.set(s.series, { series: s.series, papers: [] });
                    }
                    seriesMap.get(s.series).papers.push(...(s.papers || []));
                });
            };

            if (examData.alevel?.pure) processGroup(examData.alevel.pure);
            if (examData.alevel?.stats_mech) processGroup(examData.alevel.stats_mech);

            return Array.from(seriesMap.values()).sort((a, b) => {
                const parseDate = (s: string) => {
                    const parts = s.split(' ');
                    if (parts.length < 2) return new Date(0);
                    const months: any = { 'January': 0, 'Summer': 5, 'June': 5, 'November': 10 };
                    return new Date(parseInt(parts[1]), months[parts[0]] || 0);
                };
                return parseDate(b.series).getTime() - parseDate(a.series).getTime();
            });
        }
        
        // For GCSE Maths vs GCSE English
        const rawGcse = examData.gcse || [];
        const isEnglish = activeTab === 'gcse-english';
        
        return rawGcse
            .map((s: any) => {
                const filtered = (s.papers || []).filter((p: any) => {
                    const str = `${p.code || ''} ${p.name || ''} ${p.subject || ''}`;
                    const eng = isEnglishPaper(str);
                    return isEnglish ? eng : !eng;
                });
                return {
                    ...s,
                    papers: filtered
                };
            })
            .filter((s: any) => s.papers.length > 0);
    };

    const seriesList = getSeriesList();

    return (
        <div className="light-mode-forced edexcel-landing-page">
            <SeoHeader
                title={isEnglishRoute
                    ? "Edexcel GCSE English Language Model Answers & AI Marking | Spec 1EN0"
                    : "Edexcel GCSE Maths & English Language Model Answers & AI Marking | Spec 1MA1 & 1EN0"}
                description={isEnglishRoute
                    ? "Get instant Pearson Edexcel GCSE English Language (1EN0/01 & 1EN0/02) model answers and AI marking for past papers. Fiction & Non-Fiction (2020-2025)."
                    : "Get instant Pearson Edexcel GCSE Maths & English Language model answers and AI marking for 1MA1 and 1EN0 past papers. Step-by-step solutions for Higher & Foundation (2020-2025)."}
                canonicalUrl={isEnglishRoute
                    ? "https://aimarking.ai/mark-edexcel-gcse-english-language-past-papers"
                    : "https://aimarking.ai/mark-edexcel-gcse-maths-past-papers"}
                ogTitle={isEnglishRoute
                    ? "Edexcel GCSE English Language Model Answers | Instant AI Marking"
                    : "Edexcel GCSE Maths & English Model Answers | Instant AI Marking"}
                ogDescription={isEnglishRoute
                    ? "Stop searching for mark schemes. Get instant examiner-grade model answers and AI marking for Edexcel 1EN0 English Language (2020-2025)."
                    : "Stop searching for mark schemes. Get instant examiner-grade model answers and AI marking for all Edexcel 1MA1 maths and 1EN0 English papers (2020-2025)."}
                ogUrl={isEnglishRoute
                    ? "https://aimarking.ai/mark-edexcel-gcse-english-language-past-papers"
                    : "https://aimarking.ai/mark-edexcel-gcse-maths-past-papers"}
            />

            <LandingPageHeader />

            <section className="landing-section edexcel-hero-section">
                <div className={`edexcel-hero-content ${startAnimations ? 'trigger-anim' : ''}`}>
                    <h1 className="edexcel-hero-title">Instantly Mark Your <span className="edexcel-highlight-navy">Edexcel</span> Maths &amp; English Papers</h1>
                    <p className="edexcel-hero-subtitle">Stop staring at confusing Pearson mark schemes. Scan your handwritten 2020-2025 past papers and let our AI instantly grade your work like a real examiner. Supports GCSE Maths (1MA1), English Language (1EN0), and A-Level Maths (9MA0).</p>

                    <div className="hero-cta-group">
                        <div className="anim-item">
                            <button className="hero-primary-cta" onClick={() => navigate('/app?action=scan')}>
                                <span>Scan Your Edexcel Paper</span>
                                <svg className="w-6 h-6 cta-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" width="24" height="24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path>
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path>
                                </svg>
                            </button>

                            <button className="hero-secondary-cta" onClick={() => navigate('/app?action=select')}>
                                <span>Upload PDF / Image</span>
                                <svg className="w-6 h-6 cta-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" width="24" height="24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                                </svg>
                            </button>

                            <p className="hero-trust-microcopy">
                                Supports Edexcel 2020-2025 (GCSE Higher/Foundation Maths, English Language &amp; A-Level Maths). No credit card required.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            <HeroAnimation />

            <section className="landing-section edexcel-feature-row">
                <div className="edexcel-feature-container">
                    <div className="edexcel-feature-visual">
                        <div className="edexcel-mockup-frame">
                            <img src="/images/spatial_mapping_v3.png" alt="Edexcel Logic Analysis" style={{ width: '100%', borderRadius: '8px' }} />
                            <div className="edexcel-badge-overlay">Edexcel 1MA1 &amp; 1EN0 Check</div>
                        </div>
                    </div>
                    <div className="edexcel-feature-text">
                        <h2 className="edexcel-section-title">Master the Edexcel Mark Scheme</h2>
                        <p className="edexcel-section-body">
                            Edexcel exams are known for challenging multi-step math problems and detailed non-fiction essay comparisons. Our AI verifies your entire logical path and comparative structure, ensuring you pick up the method and level marks traditional schemes make hard to understand.
                        </p>
                        <ul className="edexcel-strategy-list">
                            <li>Instant Step-by-Step Verification</li>
                            <li>Precise Follow-through Marking</li>
                            <li>Examiner-Style Feedback &amp; Rubrics</li>
                        </ul>
                    </div>
                </div>
            </section>

            <section className="landing-section edexcel-feature-row">
                <div className="edexcel-feature-container">
                    <div className="edexcel-feature-text">
                        <h2 className="edexcel-section-title">Model Answers You'll Actually Understand</h2>
                        <p className="edexcel-section-body">
                            Tired of cryptic mark schemes? Generate perfect, step-by-step model answers that explain not just WHAT the answer is, but WHY. Perfect for mastering both Grade 8/9 math questions and Level 4 English non-fiction responses.
                        </p>
                        <ul className="edexcel-strategy-list">
                            <li>Higher &amp; Foundation Math Coverage</li>
                            <li>Untiered English Language Exemplars</li>
                            <li>Alternative Method &amp; Comparative Support</li>
                        </ul>
                    </div>
                    <div className="edexcel-feature-visual">
                        <div className="exemplar-preview-container">
                            <div className="exemplar-toggle-wrapper">
                                <div className="exemplar-toggle-pills">
                                    <button
                                        type="button"
                                        className={`exemplar-toggle-btn ${!isEnglishActive ? 'active' : ''}`}
                                        onClick={() => {
                                            setModelPreviewTab('maths');
                                            if (activeTab === 'gcse-english') setActiveTab('gcse-maths');
                                        }}
                                    >
                                        📐 Maths M1/A1 Solution
                                    </button>
                                    <button
                                        type="button"
                                        className={`exemplar-toggle-btn ${isEnglishActive ? 'active' : ''}`}
                                        onClick={() => {
                                            setModelPreviewTab('english');
                                            setActiveTab('gcse-english');
                                        }}
                                    >
                                        ✍️ English L4 Exemplar
                                    </button>
                                </div>
                            </div>
                            <div className="edexcel-mobile-frame">
                                <div className="edexcel-mobile-screen">
                                    <img
                                        src={isEnglishActive ? '/images/english_model_answer_exemplar.jpg?v=3' : '/images/aqa_question_mode_v2.png'}
                                        alt={isEnglishActive ? 'GCSE English Language Grade 9 Model Exemplar with AO2 Level 4 Annotations' : 'GCSE Maths Step-by-Step Model Answer'}
                                        style={{
                                            width: '100%',
                                            height: '100%',
                                            objectFit: isEnglishActive ? 'contain' : 'cover',
                                            objectPosition: 'top center',
                                            padding: isEnglishActive ? '10px 8px 0 8px' : '0',
                                            boxSizing: 'border-box',
                                            backgroundColor: '#ffffff'
                                        }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section id="papers" className="landing-section edexcel-resources-section">
                <div className="edexcel-resources-content">
                    <h2 className="edexcel-section-title">Edexcel Past Papers &amp; Model Answers</h2>

                    <LevelToggle level={activeTab} onChange={setActiveTab} primaryColor="#003057" />

                    {loading ? (
                        <div className="papers-loading">
                            <Loader2 className="spinner" size={40} />
                            <p>Loading Edexcel papers...</p>
                        </div>
                    ) : (
                        <div className="year-card-grid">
                            {seriesList.length > 0 ? seriesList.map((series: any, index: number) => (
                                <div key={`${series.series}-${series.category || 'gcse'}`} className="year-card-static">
                                    <div className="year-card-header">
                                        <span className="year-title">{series.series} Series</span>
                                        {index === 0 && <span className="new-tag">Latest</span>}
                                        {series.category && <div className="category-pill-small">{series.category}</div>}
                                    </div>

                                    <div className="tier-groups-stack">
                                        {activeTab === 'gcse-english' ? (
                                            <div className="internal-tier-group">
                                                <div className="tier-sublabel">
                                                    Edexcel 1EN0 • GCSE English Language (Untiered)
                                                </div>
                                                <div className="paper-list-container">
                                                    {series.papers.map((paper: any) => {
                                                        const paperCode = paper.code.replace('/', '-');
                                                        const seriesParts = series.series.split(' ');
                                                        const seriesYear = seriesParts[0].substring(0, 3).toUpperCase() + seriesParts[1];
                                                        const finalCode = `${paperCode}-${seriesYear}`;
                                                        const typeLabel = getEnglishPaperTypeLabel(paper.code);

                                                        return (
                                                            <div key={paper.code} className="paper-item-row">
                                                                <div className="paper-meta">
                                                                    <span className="paper-name">{paper.name}:</span>
                                                                    <span className="paper-code-tag">{paper.code}</span>
                                                                    {typeLabel && (
                                                                        <span className="paper-type-label">
                                                                            {typeLabel}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className="paper-actions">
                                                                    <button
                                                                        className="action-link model"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            trackPaperInteraction(finalCode, 'MODEL');
                                                                            navigate(`/app?code=${finalCode}&mode=model`);
                                                                        }}
                                                                    >
                                                                        Model
                                                                    </button>
                                                                    <button
                                                                        className="action-link mark"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            trackPaperInteraction(finalCode, 'MARK');
                                                                            navigate(`/app?code=${finalCode}&mode=markingscheme`);
                                                                        }}
                                                                    >
                                                                        Mark
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        ) : (
                                            (activeTab === 'gcse-maths' ? ['F', 'H'] : ['Pure', 'Applied']).map(groupKey => {
                                                const tierPapers = activeTab === 'gcse-maths' 
                                                    ? series.papers.filter((p: any) => p.tierCode === groupKey)
                                                    : series.papers.filter((p: any) => p.category === groupKey);
                                                
                                                if (tierPapers.length === 0) return null;

                                                return (
                                                    <div key={groupKey} className="internal-tier-group">
                                                        <div className="tier-sublabel">
                                                            {activeTab === 'gcse-maths' 
                                                                ? (groupKey === 'H' ? 'Higher Tier' : 'Foundation Tier')
                                                                : (groupKey === 'Pure' ? 'Pure Mathematics' : 'Statistics & Mechanics')
                                                            }
                                                        </div>
                                                        <div className="paper-list-container">
                                                            {tierPapers.map((paper: any) => {
                                                                const paperCode = paper.code.replace('/', '-');
                                                                const seriesParts = series.series.split(' ');
                                                                const seriesYear = seriesParts[0].substring(0, 3).toUpperCase() + seriesParts[1];
                                                                const finalCode = `${paperCode}-${seriesYear}`;

                                                                return (
                                                                    <div key={paper.code} className="paper-item-row">
                                                                        <div className="paper-meta">
                                                                            <span className="paper-name">{paper.name}:</span>
                                                                            <span className="paper-code-tag">{paper.code}</span>
                                                                            {paper.type && (
                                                                                <span className="paper-type-label">
                                                                                    {paper.type}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                        <div className="paper-actions">
                                                                            <button
                                                                                className="action-link model"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    trackPaperInteraction(finalCode, 'MODEL');
                                                                                    navigate(`/app?code=${finalCode}&mode=model`);
                                                                                }}
                                                                            >
                                                                                Model
                                                                            </button>
                                                                            <button
                                                                                className="action-link mark"
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    trackPaperInteraction(finalCode, 'MARK');
                                                                                    navigate(`/app?code=${finalCode}&mode=markingscheme`);
                                                                                }}
                                                                            >
                                                                                Mark
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            )) : (
                                <div className="no-papers-found">
                                    <p>No {activeTab === 'gcse-english' ? 'English Language' : (activeTab === 'alevel-maths' ? 'A-Level Maths' : 'GCSE Maths')} papers found for Edexcel.</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </section>

            <section className="tutor-feature-section">
                <h2 className="section-title center">Stop Guessing Why You Lost Marks</h2>
                <div className="tutor-feature-card">
                    <div className="tutor-card-visual">
                        <div className="board-chat-mockup">
                            <div className="chat-bubble user">Why is this mark scheme so confusing?</div>
                            <div className="chat-bubble ai">
                                Pearson mark schemes use specific codes. For this question, the <strong>M1 mark</strong> is for the process of using the sine rule, while the <strong>A1 mark</strong> is for the accuracy of your final decimal.
                            </div>
                            <div className="chat-bubble user" style={{ marginTop: '12px' }}>
                                How do I score full marks on Edexcel 1EN0/02 Question 4?
                            </div>
                            <div className="chat-bubble ai">
                                For <strong>Edexcel 1EN0/02 Q4 comparison</strong>, synthesize both texts paragraph-by-paragraph with integrated comparative connectives, directly comparing the writers&apos; differing perspectives.
                            </div>
                        </div>
                    </div>
                    <div className="tutor-card-text">
                        <h2 className="board-section-title">Your 24/7 Personal Edexcel Tutor</h2>
                        <p className="board-section-body">
                            Don't just look at a red 'X'. Chat directly with our AI to understand why you dropped a mark, get a simpler explanation of the Edexcel mark scheme, and confidently tackle the next paper.
                        </p>
                        <div className="feature-tag">Pro &amp; Ultra Feature</div>
                    </div>
                </div>
            </section>

            <LandingFooter />
        </div>
    );
};

export default EdexcelLandingPage;
