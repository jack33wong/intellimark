import { Helmet } from 'react-helmet-async';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown } from 'lucide-react';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import HeroAnimation from '../components/layout/HeroAnimation';
import LandingFooter from '../components/layout/LandingFooter';
import SeoHeader from '../components/common/SeoHeader';
import { trackPaperInteraction } from '../utils/analytics';
import LevelToggle from '../components/landing/LevelToggle';
import { Loader2 } from 'lucide-react';
import './AqaLandingPage.css';
import './PastPaperTable.css';

// Dynamic data handled by state

const AqaLandingPage: React.FC = () => {
    const navigate = useNavigate();
    const [startAnimations, setStartAnimations] = React.useState(false);
    const [level, setLevel] = React.useState<'GCSE' | 'A-Level'>('GCSE');
    const [examData, setExamData] = React.useState<any>(null);
    const [loading, setLoading] = React.useState(true);

    React.useEffect(() => {
        const timer = setTimeout(() => setStartAnimations(true), 100);
        
        const fetchData = async () => {
            try {
                const response = await fetch('/api/exams/public-list');
                const json = await response.json();
                if (json.success) {
                    setExamData(json.data["AQA"] || {});
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
        if (level === 'GCSE') return examData.gcse || [];
        
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
                const months: any = { 'January': 0, 'June': 5, 'November': 10 };
                return new Date(parseInt(parts[1]), months[parts[0]] || 0);
            };
            return parseDate(b.series).getTime() - parseDate(a.series).getTime();
        });
    };

    const seriesList = getSeriesList();


    return (
        <div className="light-mode-forced aqa-landing-page">
            <SeoHeader
                title="AQA GCSE Maths Model Answers & AI Marking | Spec 8300"
                description="Get instant AQA GCSE Maths model answers and AI marking for 8300 past papers. Accurate marking schemes and step-by-step solutions for Higher & Foundation (2020-2024)."
                canonicalUrl="https://aimarking.ai/mark-aqa-gcse-maths-past-papers"
                ogTitle="AQA GCSE Maths Model Answers | Instant AI Marking & Grades"
                ogDescription="Stop searching for mark schemes. Get instant examiner-grade model answers and AI marking for all AQA 8300 maths papers (2020-2024)."
                ogUrl="https://aimarking.ai/mark-aqa-gcse-maths-past-papers"
            />

            <LandingPageHeader />

            <section className="landing-section aqa-hero-section">
                <div className={`aqa-hero-content ${startAnimations ? 'trigger-anim' : ''}`}>
                    <h1 className="aqa-hero-title">Instantly Mark Your <span className="aqa-highlight-blue">AQA</span> Maths Paper</h1>
                    <p className="aqa-hero-subtitle">Stop staring at confusing AQA mark schemes. Scan your handwritten 2020-2024 past papers and let our AI instantly grade your work like a real examiner. Supports both GCSE (8300) and A-Level (7357).</p>

                    <div className="hero-cta-group">
                        <div className="anim-item">
                            <button className="hero-primary-cta" onClick={() => navigate('/app?action=scan')}>
                                <span>Scan Your AQA Paper</span>
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
                                Supports AQA 2020-2024 (GCSE Higher/Foundation & A-Level). No credit card required.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            <HeroAnimation />

            <section className="landing-section aqa-feature-row">
                <div className="aqa-feature-container">
                    <div className="aqa-feature-visual">
                        <div className="aqa-mockup-frame">
                            <img src="/images/spatial_mapping_v3.png" alt="AQA Logic Analysis" style={{ width: '100%', borderRadius: '8px' }} />
                            <div className="aqa-badge-overlay">AQA 8300 Logic Check</div>
                        </div>
                    </div>
                    <div className="aqa-feature-text">
                        <h2 className="aqa-section-title">Get Every Method Mark</h2>
                        <p className="aqa-section-body">
                            AQA examiners reward your working out, even if your final answer is wrong. Our AI reads your handwriting step-by-step to find every hidden method mark you deserve, showing you exactly how to boost your grade.
                        </p>
                    </div>
                </div>
            </section>

            <section className="landing-section aqa-feature-row">
                <div className="aqa-feature-container">
                    <div className="aqa-feature-text">
                        <h2 className="aqa-section-title">Stuck on a Hard Question?</h2>
                        <p className="aqa-section-body">
                            Generate perfect, step-by-step model answers using the exact layout and terminology that AQA examiners look for. Learn how to structure your answers for maximum marks.
                        </p>
                    </div>
                    <div className="aqa-feature-visual">
                        <div className="aqa-mobile-frame">
                            <div className="aqa-mobile-screen">
                                <img src="/images/aqa_question_mode_v2.png" alt="AQA Question Mode" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section id="papers" className="landing-section aqa-resources-section">
                <div className="aqa-resources-content">
                    <h2 className="aqa-section-title">AQA Past Papers & Model Answers</h2>

                    <LevelToggle level={level} onChange={setLevel} primaryColor="#004B98" />

                    {loading ? (
                        <div className="papers-loading">
                            <Loader2 className="spinner" size={40} />
                            <p>Loading AQA papers...</p>
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
                                        {(level === 'GCSE' ? ['F', 'H'] : ['Pure', 'Applied']).map(groupKey => {
                                            const tierPapers = level === 'GCSE' 
                                                ? series.papers.filter((p: any) => p.tierCode === groupKey)
                                                : series.papers.filter((p: any) => p.category === groupKey);
                                            
                                            if (tierPapers.length === 0) return null;

                                            return (
                                                <div key={groupKey} className="internal-tier-group">
                                                    <div className="tier-sublabel">
                                                        {level === 'GCSE' 
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
                                        })}
                                    </div>
                                </div>
                            )) : (
                                <div className="no-papers-found">
                                    <p>No {level} papers found for AQA.</p>
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
                            <div className="chat-bubble user">Why is this only 2 marks?</div>
                            <div className="chat-bubble ai">
                                You missed the **A1 Accuracy Mark**. For {`AQA`}, you must
                                explicitly state the value of the rearrangement to get full marks.
                            </div>
                        </div>
                    </div>
                    <div className="tutor-card-text">
                        <h2 className="board-section-title">Your 24/7 Personal AQA Tutor</h2>
                        <p className="board-section-body">
                            Don't just look at a red 'X'. Chat directly with our AI to understand why you dropped a mark, get a simpler explanation of the AQA mark scheme, and confidently tackle the next paper.
                        </p>
                        <div className="feature-tag">Pro & Ultra Feature</div>
                    </div>
                </div>
            </section>

            <LandingFooter />
        </div>
    );
};

export default AqaLandingPage;