import { Helmet } from 'react-helmet-async';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown } from 'lucide-react';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import HeroAnimation from '../components/layout/HeroAnimation';
import LandingFooter from '../components/layout/LandingFooter';
import SeoHeader from '../components/common/SeoHeader';
import { trackPaperInteraction } from '../utils/analytics';
import './OcrLandingPage.css';
import './PastPaperTable.css';

const OCR_PAST_PAPERS = [
    {
        year: "November 2024",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "J560/01", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "J560/02", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "J560/03", tier: "F" },
            { name: "Paper 4", type: "Non-Calculator", code: "J560/04", tier: "H" },
            { name: "Paper 5", type: "Calculator", code: "J560/05", tier: "H" },
            { name: "Paper 6", type: "Calculator", code: "J560/06", tier: "H" }
        ]
    },
    {
        year: "June 2024",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "J560/01", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "J560/02", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "J560/03", tier: "F" },
            { name: "Paper 4", type: "Non-Calculator", code: "J560/04", tier: "H" },
            { name: "Paper 5", type: "Calculator", code: "J560/05", tier: "H" },
            { name: "Paper 6", type: "Calculator", code: "J560/06", tier: "H" }
        ]
    },
    {
        year: "November 2023",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "J560/01", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "J560/02", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "J560/03", tier: "F" },
            { name: "Paper 4", type: "Non-Calculator", code: "J560/04", tier: "H" },
            { name: "Paper 5", type: "Calculator", code: "J560/05", tier: "H" },
            { name: "Paper 6", type: "Calculator", code: "J560/06", tier: "H" }
        ]
    },
    {
        year: "June 2023",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "J560/01", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "J560/02", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "J560/03", tier: "F" },
            { name: "Paper 4", type: "Non-Calculator", code: "J560/04", tier: "H" },
            { name: "Paper 5", type: "Calculator", code: "J560/05", tier: "H" },
            { name: "Paper 6", type: "Calculator", code: "J560/06", tier: "H" }
        ]
    },
    {
        year: "November 2022",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "J560/01", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "J560/02", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "J560/03", tier: "F" },
            { name: "Paper 4", type: "Non-Calculator", code: "J560/04", tier: "H" },
            { name: "Paper 5", type: "Calculator", code: "J560/05", tier: "H" },
            { name: "Paper 6", type: "Calculator", code: "J560/06", tier: "H" }
        ]
    },
    {
        year: "June 2022",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "J560/01", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "J560/02", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "J560/03", tier: "F" },
            { name: "Paper 4", type: "Non-Calculator", code: "J560/04", tier: "H" },
            { name: "Paper 5", type: "Calculator", code: "J560/05", tier: "H" },
            { name: "Paper 6", type: "Calculator", code: "J560/06", tier: "H" }
        ]
    },
    {
        year: "November 2021",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "J560/01", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "J560/02", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "J560/03", tier: "F" },
            { name: "Paper 4", type: "Non-Calculator", code: "J560/04", tier: "H" },
            { name: "Paper 5", type: "Calculator", code: "J560/05", tier: "H" },
            { name: "Paper 6", type: "Calculator", code: "J560/06", tier: "H" }
        ]
    },
    {
        year: "November 2020",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "J560/01", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "J560/02", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "J560/03", tier: "F" },
            { name: "Paper 4", type: "Non-Calculator", code: "J560/04", tier: "H" },
            { name: "Paper 5", type: "Calculator", code: "J560/05", tier: "H" },
            { name: "Paper 6", type: "Calculator", code: "J560/06", tier: "H" }
        ]
    }
];

const OcrLandingPage: React.FC = () => {
    const navigate = useNavigate();
    const [startAnimations, setStartAnimations] = React.useState(false);

    React.useEffect(() => {
        const timer = setTimeout(() => setStartAnimations(true), 100);
        return () => clearTimeout(timer);
    }, []);


    return (
        <div className="light-mode-forced ocr-landing-page">
            <SeoHeader
                title="OCR GCSE Maths Model Answers & AI Marking | Spec J560"
                description="Get instant OCR GCSE Maths model answers and AI marking for J560 past papers. Detailed mark schemes and step-by-step solutions (2020-2024)."
                canonicalUrl="https://aimarking.ai/mark-ocr-gcse-maths-past-papers"
                ogTitle="OCR GCSE Maths Model Answers | Instant AI Marking"
                ogDescription="Stop searching for mark schemes. Get instant examiner-grade model answers and AI marking for all OCR J560 maths papers."
                ogUrl="https://aimarking.ai/mark-ocr-gcse-maths-past-papers"
            />

            <LandingPageHeader />

            <section className="landing-section ocr-hero-section">
                <div className={`ocr-hero-content ${startAnimations ? 'trigger-anim' : ''}`}>
                    <h1 className="ocr-hero-title">Instantly Mark Your <span className="ocr-highlight-green">OCR GCSE</span> Maths Paper</h1>
                    <p className="ocr-hero-subtitle">Stop staring at confusing OCR mark schemes. Scan your handwritten 2020-2024 GCSE past papers and let our AI instantly grade your work like a real examiner.</p>
                    <p className="ocr-hero-subtitle">(Note: OCR A-Level support is currently in training and launching soon!)</p>
                    <div className="hero-cta-group">
                        <div className="anim-item">
                            <button className="hero-primary-cta" onClick={() => navigate('/app?action=scan')}>
                                <span>Scan Your GCSE Paper</span>
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
                                Supports OCR GCSE (J560) 2020-2024 Higher & Foundation. No credit card required.
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            <HeroAnimation />

            <section className="landing-section ocr-feature-row">
                <div className="ocr-feature-container">
                    <div className="ocr-feature-visual">
                        <div className="ocr-mockup-frame">
                            <img src="/images/spatial_mapping_v3.png" alt="OCR Logic Analysis" style={{ width: '100%', borderRadius: '8px' }} />
                            <div className="ocr-badge-overlay">OCR J560 Logic Check</div>
                        </div>
                    </div>
                    <div className="ocr-feature-text">
                        <h2 className="ocr-section-title">OCR Examiner Logic</h2>
                        <p className="ocr-section-body">
                            OCR papers often test application of knowledge. Our AI is trained to recognize OCR-specific marking patterns, ensuring you get credit for every valid logical step, even in complex non-standard questions.
                        </p>
                    </div>
                </div>
            </section>

            <section className="landing-section ocr-feature-row">
                <div className="ocr-feature-container">
                    <div className="ocr-feature-text">
                        <h2 className="ocr-section-title">Crystal Clear Solutions</h2>
                        <p className="ocr-section-body">
                            Our model answers break down the most difficult OCR questions into manageable steps. Learn the exact terminology and layout required to secure full marks on every paper.
                        </p>
                    </div>
                    <div className="ocr-feature-visual">
                        <div className="ocr-mobile-frame">
                            <div className="ocr-mobile-screen">
                                <img src="/images/aqa_question_mode_v2.png" alt="OCR Question Mode" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <section id="papers" className="landing-section ocr-resources-section">
                <div className="ocr-resources-content">
                    <h2 className="ocr-section-title">OCR Past Papers & Model Answers</h2>

                    <div className="year-card-grid">
                        {OCR_PAST_PAPERS.map((year, index) => (
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
                            <div className="chat-bubble user">How do I get the 'special case' marks?</div>
                            <div className="chat-bubble ai">
                                For OCR, these are often **SC marks**. If you used the wrong perimeter but your method was consistent, our AI identifies this and awards the credit automatically.
                            </div>
                        </div>
                    </div>
                    <div className="tutor-card-text">
                        <h2 className="board-section-title">Your 24/7 Personal OCR Tutor</h2>
                        <p className="board-section-body">
                            Don't just look at a red 'X'. Chat directly with our AI to understand why you dropped a mark, get a simpler explanation of the OCR mark scheme, and confidently tackle the next paper.
                        </p>
                        <div className="feature-tag">Pro & Ultra Feature</div>
                    </div>
                </div>
            </section>

            <LandingFooter />
        </div>
    );
};

export default OcrLandingPage;
