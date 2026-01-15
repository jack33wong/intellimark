import { Helmet } from 'react-helmet-async';
import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import LandingFooter from '../components/layout/LandingFooter';
import SeoHeader from '../components/common/SeoHeader';
import './AqaLandingPage.css';

const AqaLandingPage: React.FC = () => {
    const navigate = useNavigate();

    const productSchema = {
        "@context": "https://schema.org/",
        "@type": "Product",
        "name": "AQA GCSE Maths AI Marking Service",
        "image": "https://aimarking.ai/og-image.png",
        "description": "Board-specific AI marking for AQA GCSE Maths (8300) papers. Includes spatial mapping for handwritten working and step-by-step logic analysis.",
        "brand": {
            "@type": "Brand",
            "name": "AI Marking"
        },
        "offers": {
            "@type": "Offer",
            "url": "https://aimarking.ai/mark-aqa-gcse-maths-past-papers",
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
        <div className="light-mode-forced aqa-landing-page">
            <Helmet>
                <script type="application/ld+json">
                    {JSON.stringify(productSchema)}
                </script>
            </Helmet>

            <SeoHeader
                title="AQA GCSE Maths AI Marking | Instant Feedback & Grades (8300)"
                description="Instantly mark your AQA GCSE Maths past papers with AI. Get board-specific feedback, M1 method marks, and instant grades based on the AQA 8300 specification."
                canonicalUrl="https://aimarking.ai/mark-aqa-gcse-maths-past-papers"
                ogTitle="AQA GCSE Maths AI Marking | Grade Your Past Papers Instantly"
                ogDescription="Stop waiting for a tutor. Upload your handwritten AQA maths papers and get an examiner-grade score in 30 seconds."
                ogUrl="https://aimarking.ai/mark-aqa-gcse-maths-past-papers"
            />

            <LandingPageHeader />

            {/* 1. Hero Section */}
            <section className="landing-section aqa-hero-section">
                <div className="aqa-hero-content">
                    <h1 className="aqa-hero-title">Instant AI Marking for <br /><span className="aqa-highlight-blue">AQA GCSE Maths</span></h1>
                    <p className="aqa-hero-subtitle">
                        Stop guessing your score. Our Spatial AI is specifically tuned to the <strong>AQA (8300) specification</strong>, providing instant grades and method-mark analysis for every past paper from 2022 to 2024.
                    </p>
                    <div className="aqa-hero-cta-box">
                        <button className="aqa-btn-file" onClick={handleUploadClick}>
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" width="24" height="24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                            </svg>
                            Select Paper (PDF/JPG)
                        </button>
                        <p className="aqa-microcopy">
                            ✓ Trained on official AQA marking standards and examiner reports.
                        </p>
                    </div>
                </div>
            </section>

            {/* 2. Logic Analysis (Visual Left, Text Right) */}
            <section className="landing-section aqa-feature-row">
                <div className="aqa-feature-container">
                    <div className="aqa-feature-visual">
                        <div className="aqa-mockup-frame">
                            <img src="/images/spatial_mapping_v3.png" alt="AQA Logic Analysis" style={{ width: '100%', borderRadius: '8px' }} />
                            <div className="aqa-badge-overlay">AQA 8300 Logic Check</div>
                        </div>
                    </div>
                    <div className="aqa-feature-text">
                        <h2 className="aqa-section-title">Mastering the AQA Mark Scheme</h2>
                        <p className="aqa-section-body">
                            AQA exams often require specific working out to secure method marks. Our Logic Chain Analysis traces your steps against official AQA standards, identifying exactly where you secured an M1 mark or where an Error Carried Forward (ECF) saved your grade.
                        </p>
                    </div>
                </div>
            </section>

            {/* 3. Question Mode (Text Left, Visual Right) */}
            <section className="landing-section aqa-feature-row">
                <div className="aqa-feature-container">
                    <div className="aqa-feature-text">
                        <h2 className="aqa-section-title">Question Mode: AQA Model Answers</h2>
                        <p className="aqa-section-body">
                            Stuck on a 3-mark AQA simultaneous equation? Use Question Mode to generate a perfect model answer. Unlike generic AI, our solutions use the exact terminology and layout expected by AQA examiners.
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

            {/* 4. Supported AQA Resources */}
            <section className="landing-section aqa-resources-section">
                <div className="aqa-resources-content">
                    <h2 className="aqa-section-title">Supported AQA Resources</h2>
                    <p className="aqa-section-body">Fully updated for the latest AQA examiner guidance.</p>

                    <div className="aqa-resources-grid">
                        <div className="aqa-resource-card">
                            <h3>AQA GCSE Maths 2024</h3>
                            <ul>
                                <li>November Series Added</li>
                                <li>June Series Added</li>
                            </ul>
                            <span className="aqa-pill aqa-pill-new">New</span>
                        </div>
                        <div className="aqa-resource-card">
                            <h3>AQA GCSE Maths 2023</h3>
                            <ul>
                                <li>Paper 1 (Non-Calc)</li>
                                <li>Paper 2 (Calculator)</li>
                                <li>Paper 3 (Calculator)</li>
                            </ul>
                            <span className="aqa-pill">Higher & Foundation</span>
                        </div>
                        <div className="aqa-resource-card">
                            <h3>AQA GCSE Maths 2022</h3>
                            <ul>
                                <li>Paper 1 (Non-Calc)</li>
                                <li>Paper 2 (Calculator)</li>
                                <li>Paper 3 (Calculator)</li>
                            </ul>
                            <span className="aqa-pill">Higher & Foundation</span>
                        </div>
                    </div>
                </div>
            </section>

            <LandingFooter />
        </div>
    );
};

export default AqaLandingPage;
