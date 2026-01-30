import { Helmet } from 'react-helmet-async';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import LandingFooter from '../components/layout/LandingFooter';
import SeoHeader from '../components/common/SeoHeader';
import './OcrLandingPage.css';

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

    return (
        <div className="light-mode-forced ocr-landing-page">
            <Helmet>
                <script type="application/ld+json">
                    {JSON.stringify(productSchema)}
                </script>
            </Helmet>

            <SeoHeader
                title="OCR GCSE Maths AI Marking | Instant Feedback (J560 Specification)"
                description="Instantly mark your OCR GCSE Maths past papers. Get board-specific J560 feedback, B marks for independent stages, and Follow-Through (FT) logic for Higher and Foundation tiers."
                canonicalUrl="https://aimarking.ai/mark-ocr-gcse-maths-past-papers"
                ogTitle="OCR GCSE Maths AI Marking | Grade Your Past Papers Instantly"
                ogDescription="Stop waiting for a tutor. Upload your handwritten OCR J560 papers and get an examiner-grade score in 30 seconds."
                ogUrl="https://aimarking.ai/mark-ocr-gcse-maths-past-papers"
            />

            <LandingPageHeader />

            {/* 1. Hero Section: The J560 Conceptual Standard */}
            <section className="landing-section ocr-hero-section">
                <div className="ocr-hero-content">
                    <h1 className="ocr-hero-title">Instant AI Marking for <br /><span className="ocr-highlight-green">OCR GCSE Maths</span></h1>
                    <p className="ocr-hero-subtitle">
                        Specifically tuned for the <strong>OCR J560 specification</strong>. Move beyond rote memorization with AI that understands OCR's focus on authentic contexts, reasoning, and problem-solving.
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
                        <h2 className="ocr-section-title">Mastering OCR's Independent "B" Marks</h2>
                        <p className="ocr-section-body">
                            Unlike other boards, OCR frequently uses B marks, which are independent of your method and awarded for specific correct intermediate stages. Our AI identifies these "B" opportunities and applies Follow Through (FT) logic, ensuring that one early slip doesn't cost you marks on the rest of the question.
                        </p>
                    </div>
                </div>
            </section>

            {/* 3. Strategic "Contextual" Feedback */}
            <section className="landing-section ocr-feature-row">
                <div className="ocr-feature-container">
                    <div className="ocr-feature-text">
                        <h2 className="ocr-section-title">Strategic Contextual Feedback</h2>
                        <p className="ocr-section-body">
                            OCR emphasizes applying math to daily life, often using descriptive notation instead of abstract symbols.
                        </p>
                        <ul className="ocr-strategy-list">
                            <li><strong>Word-Based Problems:</strong> Our AI is trained to interpret "authentic context" questions where words replace standard mathematical notation.</li>
                            <li><strong>Accuracy Standards:</strong> Our AI checks your work against the specific precision and significant figure requirements of the J560 scheme.</li>
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
                    <h2 className="ocr-section-title">OCR Resource Library</h2>
                    <p className="ocr-section-body">Fully updated for the latest OCR examiner guidance and J560 series.</p>

                    <div className="ocr-resources-grid">
                        <div className="ocr-resource-card">
                            <h3>OCR GCSE Maths 2024</h3>
                            <ul>
                                <li>Summer Series Added</li>
                                <li>November Series Added</li>
                            </ul>
                            <span className="ocr-pill ocr-pill-new">New</span>
                        </div>
                        <div className="ocr-resource-card">
                            <h3>OCR GCSE Maths 2023</h3>
                            <ul>
                                <li>Full Analysis of J560/01-06</li>
                                <li>Higher & Foundation Tiers</li>
                            </ul>
                            <span className="ocr-pill">Indexed</span>
                        </div>
                        <div className="ocr-resource-card">
                            <h3>OCR GCSE Maths 2022</h3>
                            <ul>
                                <li>Calibrated J560 Series</li>
                                <li>Follow-Through Logic Check</li>
                            </ul>
                            <span className="ocr-pill">Indexed</span>
                        </div>
                    </div>
                </div>
            </section>

            <LandingFooter />
        </div>
    );
};

export default OcrLandingPage;
