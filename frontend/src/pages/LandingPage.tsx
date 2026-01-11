import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import HeroAnimation from '../components/layout/HeroAnimation';
import TrustSignals from '../components/common/TrustSignals';
import Testimonials from '../components/landing/Testimonials';
import UserSegmentation from '../components/landing/UserSegmentation';
import SupportedPapers from '../components/landing/SupportedPapers';
import LandingFooter from '../components/layout/LandingFooter';
import SeoHeader from '../components/common/SeoHeader';
import './LandingPage.css';

const LandingPage: React.FC = () => {
    const [userSegment, setUserSegment] = useState<'student' | 'tutor'>('student');

    const SegmentedTabs = () => (
        <div className="segmented-cta-tabs">
            <button
                className={`cta-tab ${userSegment === 'student' ? 'active' : ''}`}
                onClick={() => setUserSegment('student')}
            >
                I am a Student
            </button>
            <button
                className={`cta-tab ${userSegment === 'tutor' ? 'active' : ''}`}
                onClick={() => setUserSegment('tutor')}
            >
                I am a Tutor
            </button>
        </div>
    );

    const handleCtaClick = () => {
        // We can pass the segment to the app if needed, e.g., via query param
        window.location.href = `/app?role=${userSegment}`;
    };

    return (
        <div className="light-mode-forced">
            <SeoHeader isHome={true} />
            <LandingPageHeader />

            <section className="landing-section landing-section-hero">
                <div className="landing-hero-content">
                    <h1 className="hero-main-title">Pixel-Perfect AI Marking for GCSE Maths Past Papers</h1>
                    <p className="hero-main-subtitle">
                        Stop guessing your grade. Our spatial AI reads your handwriting, analyzes your multi-step logic, and annotates your work exactly like a Senior Examiner—with 99.2% accuracy.
                    </p>
                    <div className="hero-cta-group">
                        <SegmentedTabs />
                        <button className="hero-primary-cta" onClick={handleCtaClick}>
                            {userSegment === 'student' ? 'Get My Instant Grade (Free)' : 'Mark My Class Mocks (Free)'}
                        </button>
                        <p className="hero-trust-microcopy">
                            Supports Edexcel (1MA1), AQA (8300), & OCR. No credit card required.
                        </p>
                    </div>
                </div>
                <div className="landing-intro-image-container">
                    <HeroAnimation />
                </div>
            </section>

            <section className="landing-section spatial-intelligence-section">
                <div className="spatial-container">
                    <div className="spatial-text">
                        <span className="spatial-badge">Spatial Handwriting Intelligence</span>
                        <h2 className="spatial-title">We Don't Just 'Read' Math. We Map It.</h2>
                        <p className="spatial-description">
                            Unlike generic AI that transcribes your work into flat text, <strong>AI Marking</strong> uses coordinate-accurate mapping. <strong>We don't just read your answer; we map your journey.</strong>
                            We track every stroke of your pen on the X/Y axis. This allows our AI to 'pick up the red pen' and provide feedback directly on your specific equations,
                            identifying exactly where a 'Method Mark' was lost or an 'Error Carried Forward' occurred.
                        </p>
                    </div>
                    <div className="spatial-visual">
                        {/* Placeholder for a graphic showing coordinate mapping */}
                        <div className="mapping-demo">
                            <img src="/images/spatial_mapping_demo.jpg" alt="Spatial Mapping Illustration" />
                        </div>
                    </div>
                </div>
            </section>

            <TrustSignals />

            {/* Dual-Action Entry Section */}
            <section className="dual-action-section">
                <div className="dual-action-card">
                    <div className="card-pattern"></div>
                    <div className="card-content-wrapper">
                        <h2 className="card-title">Start Your Marking Session</h2>
                        <p className="card-subtitle">
                            Get instant examiner-grade feedback using our spatial AI.
                            Select your board to begin.
                        </p>

                        <div className="dual-cta-row">
                            <button className="btn-scan" onClick={() => (window.location.href = '/app?action=scan')}>
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" width="24" height="24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path>
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path>
                                </svg>
                                Scan Handwritten Work
                            </button>

                            <button className="btn-file" onClick={() => (window.location.href = '/app?action=select')}>
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" width="24" height="24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                                </svg>
                                Select Paper (PDF/JPG)
                            </button>
                        </div>

                        <div className="card-badges">
                            <div className="badge-item">
                                <span className="dot green"></span>
                                2026 Mark Schemes Loaded
                            </div>
                            <div className="badge-item">
                                <span className="dot blue"></span>
                                Mathpix Spatial OCR
                            </div>
                            <div className="board-list">
                                <span className="label-tiny">SUPPORTED:</span>
                                <span className="board-tag">AQA</span>
                                <span className="board-tag">EDEXCEL</span>
                                <span className="board-tag">OCR</span>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            <UserSegmentation />
            <Testimonials />
            <SupportedPapers />

            {/* Final CTA Section */}
            <section className="landing-section final-cta-section">
                <div className="final-cta-container">
                    <h2 className="final-cta-title">Ready to master your GCSE Maths?</h2>
                    <p className="final-cta-subtitle">Join 15,000+ students and tutors using AI Marking to perfect their exam technique.</p>

                    <div className="hero-cta-group">
                        <SegmentedTabs />
                        <button className="hero-primary-cta" onClick={handleCtaClick}>
                            {userSegment === 'student' ? 'Get My Instant Grade (Free)' : 'Start Marking Now (Free)'}
                        </button>
                    </div>
                </div>
            </section>

            <LandingFooter />
        </div>
    );
};

export default LandingPage;
