import { Helmet } from 'react-helmet-async';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import LandingFooter from '../components/layout/LandingFooter';
import SeoHeader from '../components/common/SeoHeader';
import { trackPaperInteraction } from '../utils/analytics';
import './AqaLandingPage.css';
import './TutorChat.css';

const AqaLandingPage: React.FC = () => {
    const navigate = useNavigate();
    const examYears = [2024, 2023, 2022];

    // Defined tiers for internal grouping
    const tiers = [
        { label: 'Higher Tier', suffix: 'H' },
        { label: 'Foundation Tier', suffix: 'F' }
    ];

    const paperTypes = [
        { id: '1', name: 'Paper 1', desc: 'Non-Calc 8300/1' },
        { id: '2', name: 'Paper 2', desc: 'Calculator 8300/2' },
        { id: '3', name: 'Paper 3', desc: 'Calculator 8300/3' }
    ];

    const handleAction = (code: string, mode: 'mark' | 'model') => {
        const trackerMode = mode === 'mark' ? 'MARK' : 'MODEL';
        trackPaperInteraction(code, trackerMode);
        navigate(`/app?code=${code}&mode=${mode === 'mark' ? 'markingscheme' : 'model'}`);
    };

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

            {/* Hero, Logic, and Question Sections remain unchanged to preserve your layout */}
            <section className="landing-section aqa-hero-section">
                <div className="aqa-hero-content">
                    <h1 className="aqa-hero-title">Instant AI Marking & <br /><span className="aqa-highlight-blue">AQA Model Answers</span></h1>
                    <p className="aqa-hero-subtitle">Practicing for your AQA GCSE Maths exams? Upload your past papers and get an instant, accurate grade based exactly on the AQA mark scheme.</p>
                    <div className="aqa-hero-cta-box">
                        <button className="aqa-btn-file" onClick={() => navigate('/app?action=select')}>
                            <svg style={{ width: '24px', height: '24px', flexShrink: 0, marginRight: '8px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                            </svg>
                            <span>Select Paper (PDF/JPG)</span>
                        </button>
                    </div>
                </div>
            </section>

            {/* 2. Logic Analysis */}
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
            {/* 3. Question Mode */}
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


            {/* 4. Tidy 3-Column Grid with Internal Tier Grouping */}
            <section className="landing-section aqa-resources-section">
                <div className="aqa-resources-content">
                    <h2 className="aqa-section-title">AQA Past Papers & Model Answers</h2>

                    <div className="aqa-year-card-grid">
                        {[
                            {
                                year: "November 2024",
                                papers: [
                                    { count: "Paper 1", type: "Non-Calc", code: "8300/1F", tier: "F" },
                                    { count: "Paper 2", type: "Calculator", code: "8300/2F", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "8300/3F", tier: "F" },
                                    { count: "Paper 1", type: "Non-Calc", code: "8300/1H", tier: "H" },
                                    { count: "Paper 2", type: "Calculator", code: "8300/2H", tier: "H" },
                                    { count: "Paper 3", type: "Calculator", code: "8300/3H", tier: "H" }
                                ]
                            },
                            {
                                year: "June 2024",
                                papers: [
                                    { count: "Paper 1", type: "Non-Calc", code: "8300/1F", tier: "F" },
                                    { count: "Paper 2", type: "Calculator", code: "8300/2F", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "8300/3F", tier: "F" },
                                    { count: "Paper 1", type: "Non-Calc", code: "8300/1H", tier: "H" },
                                    { count: "Paper 2", type: "Calculator", code: "8300/2H", tier: "H" },
                                    { count: "Paper 3", type: "Calculator", code: "8300/3H", tier: "H" }
                                ]
                            },
                            {
                                year: "November 2023",
                                papers: [
                                    { count: "Paper 1", type: "Non-Calc", code: "8300/1F", tier: "F" },
                                    { count: "Paper 2", type: "Calculator", code: "8300/2F", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "8300/3F", tier: "F" },
                                    { count: "Paper 1", type: "Non-Calc", code: "8300/1H", tier: "H" },
                                    { count: "Paper 2", type: "Calculator", code: "8300/2H", tier: "H" },
                                    { count: "Paper 3", type: "Calculator", code: "8300/3H", tier: "H" }
                                ]
                            },
                            {
                                year: "June 2023",
                                papers: [
                                    { count: "Paper 1", type: "Non-Calc", code: "8300/1F", tier: "F" },
                                    { count: "Paper 2", type: "Calculator", code: "8300/2F", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "8300/3F", tier: "F" },
                                    { count: "Paper 1", type: "Non-Calc", code: "8300/1H", tier: "H" },
                                    { count: "Paper 2", type: "Calculator", code: "8300/2H", tier: "H" },
                                    { count: "Paper 3", type: "Calculator", code: "8300/3H", tier: "H" }
                                ]
                            },
                            {
                                year: "November 2022",
                                papers: [
                                    { count: "Paper 1", type: "Non-Calc", code: "8300/1F", tier: "F" },
                                    { count: "Paper 2", type: "Calculator", code: "8300/2F", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "8300/3F", tier: "F" },
                                    { count: "Paper 1", type: "Non-Calc", code: "8300/1H", tier: "H" },
                                    { count: "Paper 2", type: "Calculator", code: "8300/2H", tier: "H" },
                                    { count: "Paper 3", type: "Calculator", code: "8300/3H", tier: "H" }
                                ]
                            },
                            {
                                year: "June 2022",
                                papers: [
                                    { count: "Paper 1", type: "Non-Calc", code: "8300/1F", tier: "F" },
                                    { count: "Paper 2", type: "Calculator", code: "8300/2F", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "8300/3F", tier: "F" },
                                    { count: "Paper 1", type: "Non-Calc", code: "8300/1H", tier: "H" },
                                    { count: "Paper 2", type: "Calculator", code: "8300/2H", tier: "H" },
                                    { count: "Paper 3", type: "Calculator", code: "8300/3H", tier: "H" }
                                ]
                            },
                            {
                                year: "November 2021",
                                papers: [
                                    { count: "Paper 1", type: "Non-Calc", code: "8300/1F", tier: "F" },
                                    { count: "Paper 2", type: "Calculator", code: "8300/2F", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "8300/3F", tier: "F" },
                                    { count: "Paper 1", type: "Non-Calc", code: "8300/1H", tier: "H" },
                                    { count: "Paper 2", type: "Calculator", code: "8300/2H", tier: "H" },
                                    { count: "Paper 3", type: "Calculator", code: "8300/3H", tier: "H" }
                                ]
                            },
                            {
                                year: "November 2020",
                                papers: [
                                    { count: "Paper 1", type: "Non-Calc", code: "8300/1F", tier: "F" },
                                    { count: "Paper 2", type: "Calculator", code: "8300/2F", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "8300/3F", tier: "F" },
                                    { count: "Paper 1", type: "Non-Calc", code: "8300/1H", tier: "H" },
                                    { count: "Paper 2", type: "Calculator", code: "8300/2H", tier: "H" },
                                    { count: "Paper 3", type: "Calculator", code: "8300/3H", tier: "H" }
                                ]
                            }
                        ].map((series, index) => (
                            <div key={index} className="aqa-year-card static">
                                <div className="year-card-header">
                                    <span className="year-title">{series.year} Series</span>
                                    {index === 0 && <span className="new-tag">Latest</span>}
                                </div>

                                <div className="tier-groups-stack">
                                    {['F', 'H'].map(tierCode => {
                                        const tierPapers = series.papers.filter(p => p.tier === tierCode);
                                        if (tierPapers.length === 0) return null;

                                        return (
                                            <div key={tierCode} className="internal-tier-group">
                                                <div className="tier-sublabel">
                                                    {tierCode === 'H' ? 'Higher Tier' : 'Foundation Tier'}
                                                </div>
                                                <div className="paper-list-container">
                                                    {tierPapers.map((paper, pIndex) => (
                                                        <div key={pIndex} className="paper-item-row interactive">
                                                            <div className="paper-meta">
                                                                <span className="paper-name">{paper.count}</span>
                                                                <span className="paper-type">{paper.type} {paper.code}</span>
                                                            </div>
                                                            <div className="paper-actions">
                                                                <button onClick={() => navigate(`/app?code=${paper.code.replace('/', '-')}-${series.year.split(' ')[0].substring(0, 3).toUpperCase()}${series.year.split(' ')[1]}&mode=model`)} className="action-link model">Model</button>
                                                                <button onClick={() => navigate(`/app?code=${paper.code.replace('/', '-')}-${series.year.split(' ')[0].substring(0, 3).toUpperCase()}${series.year.split(' ')[1]}&mode=markingscheme`)} className="action-link mark">Mark</button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            <section className="tutor-feature-section">
                <h2 className="section-title center">Your 24/7 Personal AQA Tutor</h2>
                <div className="tutor-feature-card">
                    <div className="tutor-card-visual">
                        <div className="board-chat-mockup">
                            {/* AQA-Specific Mockup Text */}
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