import React, { useEffect } from 'react';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import LandingFooter from '../components/layout/LandingFooter';
import SEO from '../components/common/SEO';
import './AboutPage.css';

const AboutPage: React.FC = () => {
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    const orgSchema = {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "AI Marking",
        "url": "https://aimarking.ai",
        "logo": "https://aimarking.ai/logo.png",
        "description": "AI Marking provides spatial logic assessment for GCSE and A-Level mathematics, using 0.1mm precision coordinate mapping to award method marks.",
        "sameAs": [
            "https://twitter.com/aimarking",
            "https://github.com/aimarking"
        ]
    };

    return (
        <div className="about-page-wrapper light-mode-forced">
            <SEO
                title="About Us"
                description="Learn about our mission to combine mathematical precision with automated examiner-grade marking logic."
                schemaData={orgSchema}
            />
            <LandingPageHeader />

            <main className="about-content-container">
                <section className="about-hero">
                    <h1 className="features-h1">About Us</h1>
                    <div className="about-hero-image-container">
                        <img src="/images/about/hero_v7.png" alt="Spatial AI marking illustration with paper connections" />
                    </div>
                </section>

                <section className="about-section">
                    <div className="about-label">Our Mission</div>
                    <div className="about-manifesto">
                        <p>
                            We believe that every student deserves immediate, expert-level feedback. Not weeks later, and not just a final grade. AI Marking was built to give every student a 24/7 examiner in their pocket, helping them walk into their GCSEs with absolute confidence.
                        </p>
                    </div>
                </section>

                <section className="about-section">
                    <div className="about-label">Our Product</div>
                    <div className="about-manifesto">
                        <p>
                            Traditional AI just reads text. Our AI understands math. We've built a tool that can read messy handwriting, follow your unique working out, and understand the 'why' behind every step you take, not just the final answer.
                        </p>
                    </div>
                </section>

                <section className="about-section">
                    <div className="about-label">Our Story</div>
                    <div className="about-manifesto">
                        <p>
                            Founded by a team of former examiners and engineers who hated seeing students fail just because they couldn't afford a private tutor. We set out to build a platform that doesn't just grade papers, but actually teaches you how to improve.
                        </p>
                        <p>
                            Our system is continuously updated against the latest AQA, Edexcel, and OCR specifications.
                        </p>
                        <div className="about-signature">
                            AI Marking — Your Best Exam Result.
                        </div>
                    </div>
                </section>

                <section className="about-section">
                    <div className="about-label">Our Standards</div>
                    <div className="about-manifesto">
                        <p>
                            <strong>99.2% Accuracy:</strong> Our AI grades your working out and final answers with the exact same strictness as a senior human examiner.
                        </p>
                        <p>
                            <strong>Quality Protocol:</strong> Validated against the 2026 AI Quality Protocol for secondary education.
                        </p>
                        <p>
                            <strong>Data Privacy:</strong> Fully GDPR compliant. Student papers are processed privately and never used for public model training.
                        </p>
                    </div>
                </section>

                <div className="trust-anchor-footer">
                    <div className="trust-anchor-content">
                        <span className="trust-anchor-item">
                            <svg width="16" height="16" fill="currentColor" viewBox="0 0 16 16">
                                <path d="M8 1a2 2 0 0 1 2 2v4H6V3a2 2 0 0 1 2-2zm3 6V3a3 3 0 0 0-6 0v4a2 2 0 0 0-2 2v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" />
                            </svg>
                            <strong>GDPR Compliant</strong>
                        </span>

                        <span>Validated against <strong>2026 AI Quality Protocol</strong></span>

                        <span>Papers are processed privately and not used for training</span>

                    </div>
                </div>
            </main>

            <LandingFooter />
        </div>
    );
};

export default AboutPage;
