import { Helmet } from 'react-helmet-async';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import LandingFooter from '../components/layout/LandingFooter';
import SeoHeader from '../components/common/SeoHeader';
import { trackPaperInteraction } from '../utils/analytics';
import './EdexcelLandingPage.css';
import './TutorChat.css';

const EdexcelLandingPage: React.FC = () => {
    const navigate = useNavigate();

    const productSchema = {
        "@context": "https://schema.org/",
        "@type": "Product",
        "name": "Edexcel GCSE Maths AI Marking Service",
        "image": "https://aimarking.ai/og-image.png",
        "description": "Board-specific AI marking for Pearson Edexcel GCSE Maths (1MA1) papers. Includes method marks (M), process marks (P), and step-by-step logic analysis.",
        "brand": {
            "@type": "Brand",
            "name": "AI Marking"
        },
        "offers": {
            "@type": "Offer",
            "url": "https://aimarking.ai/mark-edexcel-gcse-maths-past-papers",
            "priceCurrency": "GBP",
            "price": "0.00",
            "priceValidUntil": "2027-01-01",
            "availability": "https://schema.org/InStock"
        }
    };

    const handleUploadClick = () => {
        navigate('/app?action=select');
    };

    const handleAction = (code: string, mode: 'mark' | 'model') => {
        const trackerMode = mode === 'mark' ? 'MARK' : 'MODEL';
        trackPaperInteraction(code, trackerMode);
        navigate(`/app?code=${code}&mode=${mode === 'mark' ? 'markingscheme' : 'model'}`);
    };

    return (
        <div className="light-mode-forced edexcel-landing-page">
            <Helmet>
                <script type="application/ld+json">
                    {JSON.stringify(productSchema)}
                </script>
            </Helmet>

            <SeoHeader
                title="Edexcel GCSE Maths Model Answers & AI Marking | 1MA1 Spec"
                description="Get instant Edexcel GCSE Maths model answers and AI marking for 1MA1 past papers. Features accurate marking schemes, M/P/A marks, and step-by-step solutions for 2020-2024 Higher & Foundation."
                canonicalUrl="https://aimarking.ai/mark-edexcel-gcse-maths-past-papers"
                ogTitle="Edexcel GCSE Maths Model Answers | Instant AI Marking & Grades"
                ogDescription="Stop searching for mark schemes. Get instant examiner-grade model answers and AI marking for Edexcel 1MA1 maths papers (2020-2024)."
                ogUrl="https://aimarking.ai/mark-edexcel-gcse-maths-past-papers"
            />

            <LandingPageHeader />

            {/* 1. Hero Section: The Edexcel 1MA1 Standard */}
            <section className="landing-section edexcel-hero-section">
                <div className="edexcel-hero-content">
                    <h1 className="edexcel-hero-title">Instant AI Marking for <br /><span className="edexcel-highlight-navy">Edexcel GCSE Maths</span></h1>
                    <p className="edexcel-hero-subtitle">
                        Practicing for your Edexcel GCSE Maths exams? Upload your Foundation or Higher past papers and get an instant, accurate grade based exactly on the Edexcel mark scheme.
                    </p>
                    <div className="edexcel-hero-cta-box">
                        <button className="edexcel-btn-file" onClick={handleUploadClick}>
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" width="24" height="24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                            </svg>
                            Select Paper (PDF/JPG)
                        </button>
                    </div>
                </div>
            </section>

            {/* 2. Feature Focus: "Method vs. Process" Marking */}
            <section className="landing-section edexcel-feature-row">
                <div className="edexcel-feature-container">
                    <div className="edexcel-feature-visual">
                        <div className="edexcel-mockup-frame">
                            <img src="/images/edexcel_marking_logic_v1.png" alt="Edexcel Logic Analysis" style={{ width: '100%', borderRadius: '8px' }} />
                            <div className="edexcel-badge-overlay">Edexcel 1MA1 Logic Check</div>
                        </div>
                    </div>
                    <div className="edexcel-feature-text">
                        <h2 className="edexcel-section-title">Get Every Mark You Deserve</h2>
                        <p className="edexcel-section-body">
                            Edexcel examiners reward you for showing your method, even if your final answer is wrong. Our AI reads your handwriting step-by-step to find every hidden mark you deserve, showing you exactly how to boost your score.
                        </p>
                    </div>
                </div>
            </section>

            {/* 3. The Three-Paper Strategy Hub */}
            <section className="landing-section edexcel-feature-row">
                <div className="edexcel-feature-container edexcel-strategy-hub-row">
                    <div className="edexcel-feature-text">
                        <h2 className="edexcel-section-title">Master All Three Edexcel Papers</h2>
                        <p className="edexcel-section-body">
                            Because Edexcel uses one non-calculator and two calculator papers, our AI provides specialized support for each:
                        </p>
                        <ul className="edexcel-strategy-list">
                            <li><strong>Paper 1 (Non-Calculator):</strong> Learn how to show your working clearly so you don't lose silly marks when mental math fails.</li>
                            <li><strong>Papers 2 & 3 (Calculator):</strong> Master multi-step questions and learn exactly how Edexcel wants you to round your final answers.</li>
                        </ul>
                    </div>
                    <div className="edexcel-feature-visual edexcel-visual-large">
                        <div className="edexcel-mockup-frame">
                            <img src="/images/edexcel_strategy_hub.png" alt="Edexcel Strategy" style={{ width: '100%', borderRadius: '8px' }} />
                            <div className="edexcel-badge-overlay">Examiner-Level Marking</div>
                        </div>
                    </div>
                </div>
            </section>

            {/* 4. Edexcel Resource Library */}
            <section className="landing-section edexcel-resources-section">
                <div className="edexcel-resources-content">
                    <h2 className="edexcel-section-title">Edexcel Past Papers & Model Answers</h2>
                    <p className="edexcel-section-body">Fully updated for the latest Pearson Edexcel examiner guidance and 1MA1 series.</p>

                    <div className="edexcel-year-card-grid">
                        {[
                            {
                                year: "November 2024",
                                papers: [
                                    { count: "Paper 1", type: "Non-Calc", code: "1MA1/1F", tier: "F" },
                                    { count: "Paper 2", type: "Calculator", code: "1MA1/2F", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "1MA1/3F", tier: "F" },
                                    { count: "Paper 1", type: "Non-Calc", code: "1MA1/1H", tier: "H" },
                                    { count: "Paper 2", type: "Calculator", code: "1MA1/2H", tier: "H" },
                                    { count: "Paper 3", type: "Calculator", code: "1MA1/3H", tier: "H" }
                                ]
                            },
                            {
                                year: "June 2024",
                                papers: [
                                    { count: "Paper 1", type: "Non-Calc", code: "1MA1/1F", tier: "F" },
                                    { count: "Paper 2", type: "Calculator", code: "1MA1/2F", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "1MA1/3F", tier: "F" },
                                    { count: "Paper 1", type: "Non-Calc", code: "1MA1/1H", tier: "H" },
                                    { count: "Paper 2", type: "Calculator", code: "1MA1/2H", tier: "H" },
                                    { count: "Paper 3", type: "Calculator", code: "1MA1/3H", tier: "H" }
                                ]
                            },
                            {
                                year: "November 2023",
                                papers: [
                                    { count: "Paper 1", type: "Non-Calc", code: "1MA1/1F", tier: "F" },
                                    { count: "Paper 2", type: "Calculator", code: "1MA1/2F", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "1MA1/3F", tier: "F" },
                                    { count: "Paper 1", type: "Non-Calc", code: "1MA1/1H", tier: "H" },
                                    { count: "Paper 2", type: "Calculator", code: "1MA1/2H", tier: "H" },
                                    { count: "Paper 3", type: "Calculator", code: "1MA1/3H", tier: "H" }
                                ]
                            },
                            {
                                year: "June 2023",
                                papers: [
                                    { count: "Paper 1", type: "Non-Calc", code: "1MA1/1F", tier: "F" },
                                    { count: "Paper 2", type: "Calculator", code: "1MA1/2F", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "1MA1/3F", tier: "F" },
                                    { count: "Paper 1", type: "Non-Calc", code: "1MA1/1H", tier: "H" },
                                    { count: "Paper 2", type: "Calculator", code: "1MA1/2H", tier: "H" },
                                    { count: "Paper 3", type: "Calculator", code: "1MA1/3H", tier: "H" }
                                ]
                            },
                            {
                                year: "November 2022",
                                papers: [
                                    { count: "Paper 1", type: "Non-Calc", code: "1MA1/1F", tier: "F" },
                                    { count: "Paper 2", type: "Calculator", code: "1MA1/2F", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "1MA1/3F", tier: "F" },
                                    { count: "Paper 1", type: "Non-Calc", code: "1MA1/1H", tier: "H" },
                                    { count: "Paper 2", type: "Calculator", code: "1MA1/2H", tier: "H" },
                                    { count: "Paper 3", type: "Calculator", code: "1MA1/3H", tier: "H" }
                                ]
                            },
                            {
                                year: "June 2022",
                                papers: [
                                    { count: "Paper 1", type: "Non-Calc", code: "1MA1/1F", tier: "F" },
                                    { count: "Paper 2", type: "Calculator", code: "1MA1/2F", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "1MA1/3F", tier: "F" },
                                    { count: "Paper 1", type: "Non-Calc", code: "1MA1/1H", tier: "H" },
                                    { count: "Paper 2", type: "Calculator", code: "1MA1/2H", tier: "H" },
                                    { count: "Paper 3", type: "Calculator", code: "1MA1/3H", tier: "H" }
                                ]
                            },
                            {
                                year: "November 2021",
                                papers: [
                                    { count: "Paper 1", type: "Non-Calc", code: "1MA1/1F", tier: "F" },
                                    { count: "Paper 2", type: "Calculator", code: "1MA1/2F", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "1MA1/3F", tier: "F" },
                                    { count: "Paper 1", type: "Non-Calc", code: "1MA1/1H", tier: "H" },
                                    { count: "Paper 2", type: "Calculator", code: "1MA1/2H", tier: "H" },
                                    { count: "Paper 3", type: "Calculator", code: "1MA1/3H", tier: "H" }
                                ]
                            },
                            {
                                year: "November 2020",
                                papers: [
                                    { count: "Paper 1", type: "Non-Calc", code: "1MA1/1F", tier: "F" },
                                    { count: "Paper 2", type: "Calculator", code: "1MA1/2F", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "1MA1/3F", tier: "F" },
                                    { count: "Paper 1", type: "Non-Calc", code: "1MA1/1H", tier: "H" },
                                    { count: "Paper 2", type: "Calculator", code: "1MA1/2H", tier: "H" },
                                    { count: "Paper 3", type: "Calculator", code: "1MA1/3H", tier: "H" }
                                ]
                            }
                        ].map((series, index) => (
                            <div key={index} className="edexcel-year-card static">
                                <div className="year-card-header">
                                    <span className="year-title">{series.year} Series</span>
                                    {index === 0 && <span className="new-tag">Latest</span>}
                                </div>

                                <div className="tier-groups-stack">
                                    {['H', 'F'].map(tierCode => {
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
                                                                <button onClick={() => handleAction(`${paper.code.replace('/', '-')}-${series.year.split(' ')[0].substring(0, 3).toUpperCase()}${series.year.split(' ')[1]}`, 'model')} className="action-link model">Model</button>
                                                                <button onClick={() => handleAction(`${paper.code.replace('/', '-')}-${series.year.split(' ')[0].substring(0, 3).toUpperCase()}${series.year.split(' ')[1]}`, 'mark')} className="action-link mark">Mark</button>
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
                <h2 className="section-title center">Your 24/7 Personal Edexcel Tutor</h2>
                <div className="tutor-feature-card">
                    <div className="tutor-card-visual">
                        <div className="board-chat-mockup">
                            {/* Edexcel-Specific Mockup Text */}
                            <div className="chat-bubble user">Why is this only 2 marks?</div>
                            <div className="chat-bubble ai">
                                You missed the **Communication Mark**. For Edexcel, you must
                                explicitly state the units in your final conclusion to get full marks.
                            </div>
                        </div>
                    </div>
                    <div className="tutor-card-text">
                        <h2 className="board-section-title">Your 24/7 Personal Edexcel Tutor</h2>
                        <p className="board-section-body">
                            Don't just look at a red 'X'. Chat directly with our AI to understand why you dropped a mark, get a simple explanation of the Edexcel mark scheme, and learn how to ace the next paper.
                        </p>
                        <div className="feature-tag">Pro & Ultra Feature</div>
                    </div>
                </div>
            </section>

            <LandingFooter />
        </div>
    );
};

export default EdexcelLandingPage;
