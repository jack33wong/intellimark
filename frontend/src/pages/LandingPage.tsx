import React from 'react';
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
                        <div className="segmented-cta-tabs">
                            <button className="cta-tab active">I am a Student</button>
                            <button className="cta-tab">I am a Tutor</button>
                        </div>
                        <button className="hero-primary-cta" onClick={() => (window.location.href = '/app')}>
                            Get My Instant Grade (Free)
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
            <UserSegmentation />
            <Testimonials />
            <SupportedPapers />

            {/* Final CTA Section */}
            <section className="landing-section final-cta-section">
                <div className="final-cta-container">
                    <h2 className="final-cta-title">Ready to master your GCSE Maths?</h2>
                    <p className="final-cta-subtitle">Join 15,000+ students and tutors using AI Marking to perfect their exam technique.</p>

                    <div className="hero-cta-group">
                        <div className="segmented-cta-tabs">
                            <button className="cta-tab active">I am a Student</button>
                            <button className="cta-tab">I am a Tutor</button>
                        </div>
                        <button className="hero-primary-cta" onClick={() => (window.location.href = '/app')}>
                            Get My Instant Grade (Free)
                        </button>
                    </div>
                </div>
            </section>

            <LandingFooter />
        </div>
    );
};

export default LandingPage;
