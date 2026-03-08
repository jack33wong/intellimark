import { Helmet } from 'react-helmet-async';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import LandingFooter from '../components/layout/LandingFooter';
import SeoHeader from '../components/common/SeoHeader';
import { trackPaperInteraction } from '../utils/analytics';
import './OcrLandingPage.css';
import './TutorChat.css';

const OcrLandingPage: React.FC = () => {
    const navigate = useNavigate();

    const productSchema = {
        "@context": "https://schema.org/",
        "@type": "Product",
        "name": "OCR GCSE Maths AI Marking Service",
        "image": "https://aimarking.ai/og-image.png",
        "description": "Board-specific AI marking for OCR GCSE Maths (J560) papers. Includes independent B marks, M marks, and Follow-Through (FT) logic analysis.",
        "brand": {
            "@type": "Brand",
            "name": "AI Marking"
        },
        "offers": {
            "@type": "Offer",
            "url": "https://aimarking.ai/mark-ocr-gcse-maths-past-papers",
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
        <div className="light-mode-forced ocr-landing-page">
            <Helmet>
                <script type="application/ld+json">
                    {JSON.stringify(productSchema)}
                </script>
            </Helmet>

            <SeoHeader
                title="OCR GCSE Maths Model Answers & AI Marking | J560 Spec"
                description="Get instant OCR GCSE Maths model answers and AI marking for J560 past papers. Accurate marking schemes, B marks, and FT logic for 2020-2024 Higher & Foundation tiers."
                canonicalUrl="https://aimarking.ai/mark-ocr-gcse-maths-past-papers"
                ogTitle="OCR GCSE Maths Model Answers | Instant AI Marking & Grades"
                ogDescription="Stop searching for mark schemes. Get instant examiner-grade model answers and AI marking for OCR J560 maths papers (2020-2024)."
                ogUrl="https://aimarking.ai/mark-ocr-gcse-maths-past-papers"
            />

            <LandingPageHeader />

            {/* 1. Hero Section: The J560 Conceptual Standard */}
            <section className="landing-section ocr-hero-section">
                <div className="ocr-hero-content">
                    <h1 className="ocr-hero-title">Instant AI Marking for <br /><span className="ocr-highlight-green">OCR GCSE Maths</span></h1>
                    <p className="ocr-hero-subtitle">
                        Practicing for your OCR GCSE Maths exams? Upload your past papers and get an instant, accurate grade based exactly on the OCR mark scheme.
                    </p>
                    <div className="ocr-hero-cta-box">
                        <button className="ocr-btn-file" onClick={handleUploadClick}>
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" width="24" height="24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                            </svg>
                            Select Paper (PDF/JPG)
                        </button>
                        <p className="ocr-microcopy">
                            ✓ Get instant feedback that matches the exact standard of an OCR Senior Examiner.
                        </p>
                    </div>
                </div>
            </section>

            {/* 2. Feature Focus: Independent & Follow-Through Logic */}
            <section className="landing-section ocr-feature-row">
                <div className="ocr-feature-container">
                    <div className="ocr-feature-visual">
                        <div className="ocr-mockup-frame">
                            <img src="/images/ocr_b_marks_v1.png" alt="OCR Logic Analysis" style={{ width: '100%', borderRadius: '8px' }} />
                            <div className="ocr-badge-overlay">OCR J560 Logic Check</div>
                        </div>
                    </div>
                    <div className="ocr-feature-text">
                        <h2 className="ocr-section-title">Stop Losing Marks Twice</h2>
                        <p className="ocr-section-body">
                            Made a silly mistake on step one? OCR examiners won't punish you twice. Our AI tracks your working out and automatically applies 'follow through' marks, ensuring you still get points for using the right method later in the question.
                        </p>
                    </div>
                </div>
            </section>

            {/* 3. Strategic "Contextual" Feedback */}
            <section className="landing-section ocr-feature-row">
                <div className="ocr-feature-container">
                    <div className="ocr-feature-text">
                        <h2 className="ocr-section-title">Crack Tricky Word Problems</h2>
                        <p className="ocr-section-body">
                            OCR emphasizes applying math to daily life, often using descriptive notation instead of abstract symbols.
                        </p>
                        <ul className="ocr-strategy-list">
                            <li><strong>Word-Heavy Questions:</strong> OCR loves hiding math inside real-world stories. Our AI breaks down complex paragraphs into simple math steps so you know exactly what to calculate.</li>
                            <li><strong>Perfect Precision:</strong> Learn exactly when OCR wants you to round your answers, so you never throw away an easy accuracy mark.</li>
                        </ul>
                    </div>
                    <div className="ocr-feature-visual">
                        <div className="ocr-mockup-frame">
                            <img src="/images/ocr_strategic_feedback.png" alt="OCR Strategic Feedback" style={{ width: '100%', borderRadius: '8px' }} />
                            <div className="ocr-badge-overlay">OCR Strategic Audit</div>
                        </div>
                    </div>
                </div>
            </section>

            {/* 4. OCR Resource Library */}
            <section className="landing-section ocr-resources-section">
                <div className="ocr-resources-content">
                    <h2 className="ocr-section-title">OCR Past Papers & Model Answers</h2>
                    <p className="ocr-section-body">Fully updated for the latest OCR examiner guidance and J560 series.</p>

                    <div className="ocr-year-card-grid">
                        {[
                            {
                                year: "November 2024",
                                papers: [
                                    { count: "Paper 1", type: "Calculator", code: "J560/01", tier: "F" },
                                    { count: "Paper 2", type: "Non-Calc", code: "J560/02", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "J560/03", tier: "F" },
                                    { count: "Paper 4", type: "Calculator", code: "J560/04", tier: "H" },
                                    { count: "Paper 5", type: "Non-Calc", code: "J560/05", tier: "H" },
                                    { count: "Paper 6", type: "Calculator", code: "J560/06", tier: "H" }
                                ]
                            },
                            {
                                year: "June 2024",
                                papers: [
                                    { count: "Paper 1", type: "Calculator", code: "J560/01", tier: "F" },
                                    { count: "Paper 2", type: "Non-Calc", code: "J560/02", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "J560/03", tier: "F" },
                                    { count: "Paper 4", type: "Calculator", code: "J560/04", tier: "H" },
                                    { count: "Paper 5", type: "Non-Calc", code: "J560/05", tier: "H" },
                                    { count: "Paper 6", type: "Calculator", code: "J560/06", tier: "H" }
                                ]
                            },
                            {
                                year: "November 2023",
                                papers: [
                                    { count: "Paper 1", type: "Calculator", code: "J560/01", tier: "F" },
                                    { count: "Paper 2", type: "Non-Calc", code: "J560/02", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "J560/03", tier: "F" },
                                    { count: "Paper 4", type: "Calculator", code: "J560/04", tier: "H" },
                                    { count: "Paper 5", type: "Non-Calc", code: "J560/05", tier: "H" },
                                    { count: "Paper 6", type: "Calculator", code: "J560/06", tier: "H" }
                                ]
                            },
                            {
                                year: "June 2023",
                                papers: [
                                    { count: "Paper 1", type: "Calculator", code: "J560/01", tier: "F" },
                                    { count: "Paper 2", type: "Non-Calc", code: "J560/02", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "J560/03", tier: "F" },
                                    { count: "Paper 4", type: "Calculator", code: "J560/04", tier: "H" },
                                    { count: "Paper 5", type: "Non-Calc", code: "J560/05", tier: "H" },
                                    { count: "Paper 6", type: "Calculator", code: "J560/06", tier: "H" }
                                ]
                            },
                            {
                                year: "November 2022",
                                papers: [
                                    { count: "Paper 1", type: "Calculator", code: "J560/01", tier: "F" },
                                    { count: "Paper 2", type: "Non-Calc", code: "J560/02", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "J560/03", tier: "F" },
                                    { count: "Paper 4", type: "Calculator", code: "J560/04", tier: "H" },
                                    { count: "Paper 5", type: "Non-Calc", code: "J560/05", tier: "H" },
                                    { count: "Paper 6", type: "Calculator", code: "J560/06", tier: "H" }
                                ]
                            },
                            {
                                year: "June 2022",
                                papers: [
                                    { count: "Paper 1", type: "Calculator", code: "J560/01", tier: "F" },
                                    { count: "Paper 2", type: "Non-Calc", code: "J560/02", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "J560/03", tier: "F" },
                                    { count: "Paper 4", type: "Calculator", code: "J560/04", tier: "H" },
                                    { count: "Paper 5", type: "Non-Calc", code: "J560/05", tier: "H" },
                                    { count: "Paper 6", type: "Calculator", code: "J560/06", tier: "H" }
                                ]
                            },
                            {
                                year: "November 2021",
                                papers: [
                                    { count: "Paper 1", type: "Calculator", code: "J560/01", tier: "F" },
                                    { count: "Paper 2", type: "Non-Calc", code: "J560/02", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "J560/03", tier: "F" },
                                    { count: "Paper 4", type: "Calculator", code: "J560/04", tier: "H" },
                                    { count: "Paper 5", type: "Non-Calc", code: "J560/05", tier: "H" },
                                    { count: "Paper 6", type: "Calculator", code: "J560/06", tier: "H" }
                                ]
                            },
                            {
                                year: "November 2020",
                                papers: [
                                    { count: "Paper 1", type: "Calculator", code: "J560/01", tier: "F" },
                                    { count: "Paper 2", type: "Non-Calc", code: "J560/02", tier: "F" },
                                    { count: "Paper 3", type: "Calculator", code: "J560/03", tier: "F" },
                                    { count: "Paper 4", type: "Calculator", code: "J560/04", tier: "H" },
                                    { count: "Paper 5", type: "Non-Calc", code: "J560/05", tier: "H" },
                                    { count: "Paper 6", type: "Calculator", code: "J560/06", tier: "H" }
                                ]
                            }
                        ].map((series, index) => (
                            <div key={index} className="ocr-year-card static">
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
                <h2 className="section-title center">Your 24/7 Personal OCR Tutor</h2>
                <div className="tutor-feature-card">
                    <div className="tutor-card-visual">
                        <div className="board-chat-mockup">
                            {/* OCR-Specific Mockup Text */}
                            <div className="chat-bubble user">Why is this only 2 marks?</div>
                            <div className="chat-bubble ai">
                                You missed the **B Mark** for the independent stage. For OCR, you must
                                explicitly show the correct intermediate calculation to get this mark.
                            </div>
                        </div>
                    </div>
                    <div className="tutor-card-text">
                        <h2 className="board-section-title">Your 24/7 Personal OCR Tutor</h2>
                        <p className="board-section-body">
                            Don't just look at a red 'X'. Chat directly with our AI to understand why you dropped a mark, get a simple explanation of the OCR mark scheme, and confidently tackle the next paper.
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
