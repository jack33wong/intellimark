import { Helmet } from 'react-helmet-async';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowDown } from 'lucide-react';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import LandingFooter from '../components/layout/LandingFooter';
import SeoHeader from '../components/common/SeoHeader';
import { trackPaperInteraction } from '../utils/analytics';
import './AqaLandingPage.css';
import './PastPaperTable.css';

const AQA_PAST_PAPERS = [
    {
        year: "November 2024",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "8300/1F", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "8300/2F", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "8300/3F", tier: "F" },
            { name: "Paper 1", type: "Non-Calculator", code: "8300/1H", tier: "H" },
            { name: "Paper 2", type: "Calculator", code: "8300/2H", tier: "H" },
            { name: "Paper 3", type: "Calculator", code: "8300/3H", tier: "H" }
        ]
    },
    {
        year: "June 2024",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "8300/1F", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "8300/2F", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "8300/3F", tier: "F" },
            { name: "Paper 1", type: "Non-Calculator", code: "8300/1H", tier: "H" },
            { name: "Paper 2", type: "Calculator", code: "8300/2H", tier: "H" },
            { name: "Paper 3", type: "Calculator", code: "8300/3H", tier: "H" }
        ]
    },
    {
        year: "November 2023",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "8300/1F", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "8300/2F", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "8300/3F", tier: "F" },
            { name: "Paper 1", type: "Non-Calculator", code: "8300/1H", tier: "H" },
            { name: "Paper 2", type: "Calculator", code: "8300/2H", tier: "H" },
            { name: "Paper 3", type: "Calculator", code: "8300/3H", tier: "H" }
        ]
    },
    {
        year: "June 2023",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "8300/1F", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "8300/2F", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "8300/3F", tier: "F" },
            { name: "Paper 1", type: "Non-Calculator", code: "8300/1H", tier: "H" },
            { name: "Paper 2", type: "Calculator", code: "8300/2H", tier: "H" },
            { name: "Paper 3", type: "Calculator", code: "8300/3H", tier: "H" }
        ]
    },
    {
        year: "November 2022",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "8300/1F", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "8300/2F", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "8300/3F", tier: "F" },
            { name: "Paper 1", type: "Non-Calculator", code: "8300/1H", tier: "H" },
            { name: "Paper 2", type: "Calculator", code: "8300/2H", tier: "H" },
            { name: "Paper 3", type: "Calculator", code: "8300/3H", tier: "H" }
        ]
    },
    {
        year: "June 2022",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "8300/1F", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "8300/2F", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "8300/3F", tier: "F" },
            { name: "Paper 1", type: "Non-Calculator", code: "8300/1H", tier: "H" },
            { name: "Paper 2", type: "Calculator", code: "8300/2H", tier: "H" },
            { name: "Paper 3", type: "Calculator", code: "8300/3H", tier: "H" }
        ]
    },
    {
        year: "November 2021",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "8300/1F", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "8300/2F", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "8300/3F", tier: "F" },
            { name: "Paper 1", type: "Non-Calculator", code: "8300/1H", tier: "H" },
            { name: "Paper 2", type: "Calculator", code: "8300/2H", tier: "H" },
            { name: "Paper 3", type: "Calculator", code: "8300/3H", tier: "H" }
        ]
    },
    {
        year: "November 2020",
        papers: [
            { name: "Paper 1", type: "Non-Calculator", code: "8300/1F", tier: "F" },
            { name: "Paper 2", type: "Calculator", code: "8300/2F", tier: "F" },
            { name: "Paper 3", type: "Calculator", code: "8300/3F", tier: "F" },
            { name: "Paper 1", type: "Non-Calculator", code: "8300/1H", tier: "H" },
            { name: "Paper 2", type: "Calculator", code: "8300/2H", tier: "H" },
            { name: "Paper 3", type: "Calculator", code: "8300/3H", tier: "H" }
        ]
    }
];

const AqaLandingPage: React.FC = () => {
    const navigate = useNavigate();


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
                <div className="aqa-hero-content">
                    <h1 className="aqa-hero-title">Free <span className="aqa-highlight-blue">AQA</span> Past Papers & Model Answers</h1>
                    <p className="aqa-hero-subtitle">Stop staring at confusing AQA mark schemes. Find your exact AQA 8300 paper below, view step-by-step model answers, and let our AI instantly grade your work like a real examiner.</p>
                    <div className="aqa-hero-cta-box">
                        <button className="aqa-btn-file" onClick={() => document.getElementById('papers')?.scrollIntoView({ behavior: 'smooth' })}>
                            <span>View AQA Papers</span>
                            <ArrowDown className="cta-arrow-icon animate-bounce-soft" />
                        </button>
                    </div>
                </div>
            </section>

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

                    <div className="year-card-grid">
                        {AQA_PAST_PAPERS.map((year, index) => (
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