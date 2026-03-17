import { Helmet } from 'react-helmet-async';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown } from 'lucide-react';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import HeroAnimation from '../components/layout/HeroAnimation';
import LandingFooter from '../components/layout/LandingFooter';
import SeoHeader from '../components/common/SeoHeader';
import { trackPaperInteraction } from '../utils/analytics';
import './EdexcelLandingPage.css';
import './PastPaperTable.css';

const EDEXCEL_PAST_PAPERS = [
    {
        year: "November 2024",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "1MA1/1F", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "1MA1/2F", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "1MA1/3F", tier: "F" },
            { name: "Paper 1", type: "Non-Calculator", code: "1MA1/1H", tier: "H" },
            { name: "Paper 2", type: "Calculator", code: "1MA1/2H", tier: "H" },
            { name: "Paper 3", type: "Calculator", code: "1MA1/3H", tier: "H" }
        ]
    },
    {
        year: "June 2024",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "1MA1/1F", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "1MA1/2F", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "1MA1/3F", tier: "F" },
            { name: "Paper 1", type: "Non-Calculator", code: "1MA1/1H", tier: "H" },
            { name: "Paper 2", type: "Calculator", code: "1MA1/2H", tier: "H" },
            { name: "Paper 3", type: "Calculator", code: "1MA1/3H", tier: "H" }
        ]
    },
    {
        year: "November 2023",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "1MA1/1F", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "1MA1/2F", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "1MA1/3F", tier: "F" },
            { name: "Paper 1", type: "Non-Calculator", code: "1MA1/1H", tier: "H" },
            { name: "Paper 2", type: "Calculator", code: "1MA1/2H", tier: "H" },
            { name: "Paper 3", type: "Calculator", code: "1MA1/3H", tier: "H" }
        ]
    },
    {
        year: "June 2023",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "1MA1/1F", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "1MA1/2F", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "1MA1/3F", tier: "F" },
            { name: "Paper 1", type: "Non-Calculator", code: "1MA1/1H", tier: "H" },
            { name: "Paper 2", type: "Calculator", code: "1MA1/2H", tier: "H" },
            { name: "Paper 3", type: "Calculator", code: "1MA1/3H", tier: "H" }
        ]
    },
    {
        year: "November 2022",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "1MA1/1F", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "1MA1/2F", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "1MA1/3F", tier: "F" },
            { name: "Paper 1", type: "Non-Calculator", code: "1MA1/1H", tier: "H" },
            { name: "Paper 2", type: "Calculator", code: "1MA1/2H", tier: "H" },
            { name: "Paper 3", type: "Calculator", code: "1MA1/3H", tier: "H" }
        ]
    },
    {
        year: "June 2022",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "1MA1/1F", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "1MA1/2F", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "1MA1/3F", tier: "F" },
            { name: "Paper 1", type: "Non-Calculator", code: "1MA1/1H", tier: "H" },
            { name: "Paper 2", type: "Calculator", code: "1MA1/2H", tier: "H" },
            { name: "Paper 3", type: "Calculator", code: "1MA1/3H", tier: "H" }
        ]
    },
    {
        year: "November 2021",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "1MA1/1F", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "1MA1/2F", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "1MA1/3F", tier: "F" },
            { name: "Paper 1", type: "Non-Calculator", code: "1MA1/1H", tier: "H" },
            { name: "Paper 2", type: "Calculator", code: "1MA1/2H", tier: "H" },
            { name: "Paper 3", type: "Calculator", code: "1MA1/3H", tier: "H" }
        ]
    },
    {
        year: "November 2020",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "1MA1/1F", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "1MA1/2F", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "1MA1/3F", tier: "F" },
            { name: "Paper 1", type: "Non-Calculator", code: "1MA1/1H", tier: "H" },
            { name: "Paper 2", type: "Calculator", code: "1MA1/2H", tier: "H" },
            { name: "Paper 3", type: "Calculator", code: "1MA1/3H", tier: "H" }
        ]
    }
];

const EdexcelLandingPage: React.FC = () => {
    const navigate = useNavigate();
    const [startAnimations, setStartAnimations] = React.useState(false);

    React.useEffect(() => {
        const timer = setTimeout(() => setStartAnimations(true), 100);
        return () => clearTimeout(timer);
    }, []);


    return (
        <div className="light-mode-forced edexcel-landing-page">
            <SeoHeader
                title="Edexcel GCSE Maths Model Answers & AI Marking | Spec 1MA1"
                description="Get instant Pearson Edexcel GCSE Maths model answers and AI marking for 1MA1 past papers. Step-by-step solutions for Higher & Foundation (2020-2024)."
                canonicalUrl="https://aimarking.ai/mark-edexcel-gcse-maths-past-papers"
                ogTitle="Edexcel GCSE Maths Model Answers | Instant AI Marking"
                ogDescription="Stop searching for mark schemes. Get instant examiner-grade model answers and AI marking for all Edexcel 1MA1 maths papers."
                ogUrl="https://aimarking.ai/mark-edexcel-gcse-maths-past-papers"
            />

            <LandingPageHeader />

            <section className="landing-section edexcel-hero-section">
                <div className={`edexcel-hero-content ${startAnimations ? 'trigger-anim' : ''}`}>
                    <h1 className="edexcel-hero-title">Instantly Mark Your <span className="edexcel-highlight-navy">Edexcel</span> Maths Paper</h1>
                    <p className="edexcel-hero-subtitle">Stop staring at confusing Pearson mark schemes. Scan your handwritten 2020-2024 past papers and let our AI instantly grade your work like a real examiner. Supports both GCSE (1MA1) and A-Level (9MA0).</p>

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
                                Supports Edexcel 2020-2024 (GCSE Higher/Foundation & A-Level). No credit card required.
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
                            <div className="edexcel-badge-overlay">Edexcel 1MA1 Logic Check</div>
                        </div>
                    </div>
                    <div className="edexcel-feature-text">
                        <h2 className="edexcel-section-title">Master the Edexcel Mark Scheme</h2>
                        <p className="edexcel-section-body">
                            Edexcel exams are known for their challenging multi-step problems. Our AI doesn't just check the answer; it verifies your entire logical path, ensuring you pick up the M and A marks that traditional mark schemes often make hard to understand.
                        </p>
                        <ul className="edexcel-strategy-list">
                            <li>Instant Step-by-Step Verification</li>
                            <li>Precise Follow-through Marking</li>
                            <li>Examiner-Style Feedback</li>
                        </ul>
                    </div>
                </div>
            </section>

            <section className="landing-section edexcel-feature-row">
                <div className="edexcel-feature-container">
                    <div className="edexcel-feature-text">
                        <h2 className="edexcel-section-title">Model Answers You'll Actually Understand</h2>
                        <p className="edexcel-section-body">
                            Tired of cryptic mark schemes? Generate perfect, step-by-step model answers that explain not just WHAT the answer is, but WHY. Perfect for mastering those tricky Grade 8/9 questions.
                        </p>
                        <ul className="edexcel-strategy-list">
                            <li>Higher & Foundation Coverage</li>
                            <li>Clear Mathematical Notation</li>
                            <li>Alternative Method Support</li>
                        </ul>
                    </div>
                    <div className="edexcel-feature-visual">
                        <div className="edexcel-mobile-frame">
                            <div className="edexcel-mobile-screen">
                                <img src="/images/aqa_question_mode_v2.png" alt="Edexcel Question Mode" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section id="papers" className="landing-section edexcel-resources-section">
                <div className="edexcel-resources-content">
                    <h2 className="edexcel-section-title">Edexcel Past Papers & Model Answers</h2>

                    <div className="year-card-grid">
                        {EDEXCEL_PAST_PAPERS.map((year, index) => (
                            <div key={year.year} className="year-card-static">
                                <div className="year-card-header">
                                    <span className="year-title">{year.year} Series</span>
                                    {index === 0 && <span className="new-tag">Latest</span>}
                                </div>

                                <div className="tier-groups-stack">
                                    {['F', 'H'].map(tierCode => {
                                        const tierPapers = year.papers.filter(p => p.tier === tierCode);
                                        if (tierPapers.length === 0) return null;

                                        return (
                                            <div key={tierCode} className="internal-tier-group">
                                                <div className="tier-sublabel">
                                                    {tierCode === 'H' ? 'Higher Tier' : 'Foundation Tier'}
                                                </div>
                                                <div className="paper-list-container">
                                                    {tierPapers.map((paper) => {
                                                        const paperCode = paper.code.replace('/', '-');
                                                        const seriesParts = year.year.split(' ');
                                                        const seriesYear = seriesParts[0].substring(0, 3).toUpperCase() + seriesParts[1];
                                                        const finalCode = `${paperCode}-${seriesYear}`;

                                                        return (
                                                            <div key={paper.code} className="paper-item-row">
                                                                <div className="paper-meta">
                                                                    <span className="paper-name">{paper.name}:</span>
                                                                    <span className="paper-code-tag">{paper.code}</span>
                                                                    <span className="paper-type">
                                                                        {paper.type.includes('Non-Calculator') ? 'Non-Calc' : 'Calculator'}
                                                                    </span>
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
                        ))}
                    </div>
                </div>
            </section>

            <section className="tutor-feature-section">
                <h2 className="section-title center">Stop Guessing Why You Lost Marks</h2>
                <div className="tutor-feature-card">
                    <div className="tutor-card-visual">
                        <div className="board-chat-mockup">
                            <div className="chat-bubble user">Why is this mark scheme so confusing?</div>
                            <div className="chat-bubble ai">
                                Pearson mark schemes use specific codes. For this question, the **M1 mark** is for the process of using the sine rule, while the **A1 mark** is for the accuracy of your final decimal.
                            </div>
                        </div>
                    </div>
                    <div className="tutor-card-text">
                        <h2 className="board-section-title">Your 24/7 Personal Edexcel Tutor</h2>
                        <p className="board-section-body">
                            Don't just look at a red 'X'. Chat directly with our AI to understand why you dropped a mark, get a simpler explanation of the Edexcel mark scheme, and confidently tackle the next paper.
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
