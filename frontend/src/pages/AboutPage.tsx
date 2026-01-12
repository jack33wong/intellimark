import React, { useEffect } from 'react';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import LandingFooter from '../components/layout/LandingFooter';
import './AboutPage.css';

const AboutPage: React.FC = () => {
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    return (
        <div className="about-page-wrapper light-mode-forced">
            <LandingPageHeader />

            <main className="about-content-container">
                <section className="about-hero">
                    <h1 className="features-h1">About Us</h1>
                    <div className="about-hero-image-container">
                        <img src="/images/about/hero_v5.png" alt="Mathematical checkmark with wide AI circuit illustration" />
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
                            By training our neural networks specifically on mathematical notations and messy human handwriting, we've created a tool that understands the "why" behind every step, not just the "what".
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
                        <div className="about-signature">
                            AI Marking — Empowering Accuracy.
                        </div>
                    </div>
                </section>
            </main>

            <LandingFooter />
        </div>
    );
};

export default AboutPage;
