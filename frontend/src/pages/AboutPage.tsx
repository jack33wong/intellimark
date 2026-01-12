import React, { useEffect } from 'react';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import LandingFooter from '../components/layout/LandingFooter';
import './AboutPage.css';

const AboutPage: React.FC = () => {
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    return (
        <div className="about-page-wrapper">
            <LandingPageHeader />

            <main className="about-content-container">
                <section className="about-hero">
                    <h1 className="features-h1">About Us</h1>
                    <div className="about-hero-image-container">
                        <img src="/images/about/hero_v6.png" alt="AI Marking Logo with circuit connections illustration" />
                    </div>
                </section>

                <section className="about-section">
                    <div className="about-label">Our Mission</div>
                    <div className="about-manifesto">
                        <p>
                            We believe that every student deserves immediate, expert-level feedback. Not hours later, and not just a final grade.
                        </p>
                        <p>
                            AI Marking was built to bridge the gap between human expertise and machine precision, using Spatial Handwriting Intelligence to give everyone the tools to leverage their academic potential.
                        </p>
                    </div>
                </section>

                <section className="about-section">
                    <div className="about-label">Our Product</div>
                    <div className="about-manifesto">
                        <p>
                            Traditional AI transcribes. Our Spatial AI maps your journey.
                        </p>
                        <p>
                            By training our Spatial AI on 0.1mm coordinate data, we've created a tool that understands the "why" behind every step, not just the "what".
                        </p>
                    </div>
                </section>

                <section className="about-section">
                    <div className="about-label">Our Story</div>
                    <div className="about-manifesto">
                        <p>
                            Founded by a team of examiners and engineers who were tired of the "black box" of automated marking.
                        </p>
                        <p>
                            We set out to build a platform that doesn't just grade papers, but empowers students to understand their mistakes and teachers to save hundreds of hours every year.
                        </p>
                        <p>
                            This is the future of assessment. Hands on AI.
                        </p>
                        <p>
                            Our logic is manually calibrated against the latest 2025/2026 specifications for AQA, Edexcel, and OCR.
                        </p>
                        <div className="about-signature">
                            AI Marking — Empowering Accuracy.
                        </div>
                    </div>
                </section>

                <section className="about-section">
                    <div className="about-label">Our Standards</div>
                    <div className="about-manifesto">
                        <p>
                            <strong>99.2% Match:</strong> Our AI matches senior human examiners on Method Mark (M1) and Accuracy Mark (A0) awarding.
                        </p>
                        <p>
                            <strong>Quality Protocol:</strong> Validated against the 2026 AI Quality Protocol for secondary education.
                        </p>
                        <p>
                            <strong>Data Privacy:</strong> Fully GDPR compliant. Student papers are processed privately and never used for public model training.
                        </p>
                    </div>
                </section>

                <div className="about-safety-anchor">
                    Fully GDPR Compliant. Validated against the 2026 AI Quality Protocol for secondary mathematics assessment.
                </div>
            </main>

            <LandingFooter />
        </div>
    );
};

export default AboutPage;
