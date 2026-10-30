import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, ArrowDown } from 'lucide-react';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import HeroAnimation from '../components/layout/HeroAnimation';
import Testimonials from '../components/landing/Testimonials';
import UserSegmentation from '../components/landing/UserSegmentation';
import SupportedPapers from '../components/landing/SupportedPapers';
import BenefitBlocks from '../components/landing/BenefitBlocks';
import LandingFooter from '../components/layout/LandingFooter';
import SeoHeader from '../components/common/SeoHeader';
import AntigravityTypewriter from '../components/common/AntigravityTypewriter';
import './LandingPage.css';
import './TutorChat.css';

/* --- Helper Component: Image Magnifier --- */
const ImageMagnifier = ({
    src,
    width,
    height,
    magnifierHeight = 150,
    magnifierWidth = 150,
    zoomLevel = 2.5
}: {
    src: string;
    width?: string;
    height?: string;
    magnifierHeight?: number;
    magnifierWidth?: number;
    zoomLevel?: number;
}) => {
    const [showMagnifier, setShowMagnifier] = useState(false);
    const [[x, y], setXY] = useState([0, 0]);
    const [[imgWidth, imgHeight], setSize] = useState([0, 0]);

    return (
        <div
            className="magnifier-container"
            style={{
                position: "relative",
                height: height,
                width: width
            }}
        >
            <img
                src={src}
                className="magnifier-image"
                onMouseEnter={(e) => {
                    if (window.matchMedia("(pointer: coarse)").matches) return;
                    const elem = e.currentTarget;
                    const { width, height } = elem.getBoundingClientRect();
                    setSize([width, height]);
                    setShowMagnifier(true);
                }}
                onMouseMove={(e) => {
                    if (!showMagnifier) return;
                    const elem = e.currentTarget;
                    const { top, left } = elem.getBoundingClientRect();
                    const x = e.clientX - left;
                    const y = e.clientY - top;
                    setXY([x, y]);
                }}
                onMouseLeave={() => setShowMagnifier(false)}
                alt={"magnifier"}
            />

            <div
                style={{
                    display: showMagnifier ? "" : "none",
                    position: "absolute",
                    pointerEvents: "none",
                    height: `${magnifierHeight}px`,
                    width: `${magnifierWidth}px`,
                    top: `${y - magnifierHeight / 2}px`,
                    left: `${x - magnifierWidth / 2}px`,
                    borderRadius: "50%",
                    border: "3px solid #fff",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.2), 0 0 0 1px rgba(0,0,0,0.05)",
                    backgroundColor: "white",
                    backgroundImage: `url('${src}')`,
                    backgroundRepeat: "no-repeat",
                    backgroundSize: `${imgWidth * zoomLevel}px ${imgHeight * zoomLevel}px`,
                    backgroundPositionX: `${-x * zoomLevel + magnifierWidth / 2}px`,
                    backgroundPositionY: `${-y * zoomLevel + magnifierHeight / 2}px`,
                    zIndex: 20
                }}
            />
        </div>
    );
};

/* --- Data --- */
const HERO_SEGMENTS = [
    { text: "Instantly Mark Your Maths & English Past Papers" },
    { text: "GCSE & A-Level", className: "hero-highlight-blue" }
];


// Safe fallbacks to prevent runtime crashes if a component is undefined during HMR / bundling
const SafeSeoHeader = SeoHeader || (() => null);
const SafeLandingPageHeader = LandingPageHeader || (() => null);
const SafeAntigravityTypewriter = AntigravityTypewriter || (() => null);
const SafeHeroAnimation = HeroAnimation || (() => null);
const SafeBenefitBlocks = BenefitBlocks || (() => null);
const SafeUserSegmentation = UserSegmentation || (() => null);
const SafeTestimonials = Testimonials || (() => null);
const SafeSupportedPapers = SupportedPapers || (() => null);
const SafeLandingFooter = LandingFooter || (() => null);
const SafeLock = Lock || (() => null);

/* --- Main Page Component --- */
export const LandingPage: React.FC = () => {
    const navigate = useNavigate();

    // Controls the staggered entrance of subtitle/CTA
    const [startAnimations, setStartAnimations] = useState(false);
    const [showcaseSubject, setShowcaseSubject] = useState<'maths' | 'english'>('maths');

    const handleCtaClick = () => {
        navigate('/app');
    };

    return (
        <div className="light-mode-forced">
            <SafeSeoHeader isHome={true} />
            <SafeLandingPageHeader />

            <section className="landing-section landing-section-hero">
                {/* [ANIMATION TRIGGER]
                  The 'trigger-anim' class activates the 'anim-item' children.
                */}
                <div className={`landing-hero-content ${startAnimations ? 'trigger-anim' : ''}`}>

                    <div className="hero-new-feature-pill" onClick={() => navigate('/app')}>
                        <span className="pill-badge">NEW</span>
                        <span className="pill-text">GCSE English Language (AQA, Edexcel &amp; OCR) AI Marking &amp; Model Answers</span>
                        <span className="pill-arrow">→</span>
                    </div>

                    <SafeAntigravityTypewriter
                        className="hero-main-title"
                        segments={HERO_SEGMENTS}
                        // Added cursorOffset to keep it tight to text
                        cursorOffset={-2}
                        onComplete={() => setTimeout(() => setStartAnimations(true), 150)}
                    />

                    {/* BLOCK 1: Subtitle (Immediate start after typing) */}
                    <p className="hero-main-subtitle anim-item delay-1">
                        Upload your handwritten Mathematics workings or typed/handwritten English Language essays. Receive instant, question-by-question marks aligned with official AQA, Edexcel & OCR mark schemes and Senior Examiner reports.
                    </p>

                    <div className="hero-cta-group">
                        <div className="anim-item delay-3">
                            <button className="hero-primary-cta" onClick={() => navigate('/app?action=scan')}>
                                <span>Scan Your Paper Now</span>
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
                                Supports GCSE & A-Level (Edexcel, AQA, OCR). No credit card required.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="landing-intro-image-container">
                    <SafeHeroAnimation />
                </div>
            </section>

            <section className="landing-section spatial-intelligence-section">
                <div className="spatial-container">
                    <div className="spatial-text">
                        <span className="spatial-badge">Dual-Engine Spatial & Text Understanding</span>
                        <h2 className="spatial-title">From Complex Geometry to Multi-Page Essays</h2>
                        <p className="spatial-description">
                            AI Marking pairs vision-based spatial geometry for intricate handwritten equations, angles, and graphs with advanced multi-page LoR (Levels of Response) rubrics to grade English Language analysis, synthesis, and creative writing.
                            <br /><br />
                            <strong>Beyond marking: Use Question Mode for examiner-perfect model answers and Context Chat for personalized feedback on every step.</strong>
                        </p>
                    </div>
                    <div className="spatial-visual">
                        <div className="spatial-subject-toggle-wrapper">
                            <div className="spatial-subject-toggle">
                                <button
                                    type="button"
                                    className={`spatial-toggle-pill ${showcaseSubject === 'maths' ? 'active' : ''}`}
                                    onClick={() => setShowcaseSubject('maths')}
                                >
                                    📐 Maths Step-by-Step Marking
                                </button>
                                <button
                                    type="button"
                                    className={`spatial-toggle-pill ${showcaseSubject === 'english' ? 'active' : ''}`}
                                    onClick={() => setShowcaseSubject('english')}
                                >
                                    ✍️ English Essay LoR Marking
                                </button>
                            </div>
                        </div>
                        <div className="mapping-demo-container">
                            <div className="mapping-demo-zoom-wrapper">
                                <ImageMagnifier
                                    src={showcaseSubject === 'english' ? '/images/english_spatial_marking_q2.jpg' : '/images/spatial_mapping_v3.png'}
                                    width="100%"
                                />
                            </div>
                            <p className="mapping-caption">
                                {showcaseSubject === 'english'
                                    ? "Actual AI English marking: Accurate Levels-of-Response (LoR) grading with margin badges and teacher commentary."
                                    : "Actual AI marking sample: Identifying Method Marks (M1) and specific prime factorisation errors."}
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            <SafeBenefitBlocks />

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
                            <button className="btn-scan" onClick={() => navigate('/app?action=scan')}>
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" width="24" height="24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path>
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path>
                                </svg>
                                Scan with Phone Camera
                            </button>

                            <button className="btn-file" onClick={() => navigate('/app?action=select')}>
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" width="24" height="24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                                </svg>
                                Select Paper (PDF/JPG)
                            </button>
                        </div>

                        <div className="card-badges">
                            <div className="badge-item">
                                <span className="dot green"></span>
                                2026 Maths & English Schemes Loaded
                            </div>
                            <div className="badge-item">
                                <span className="dot blue"></span>
                                Spatial OCR & AO Level Rubrics
                            </div>
                            <div className="board-list">
                                <span className="label-tiny">SUPPORTED:</span>
                                <span className="board-tag">AQA</span>
                                <span className="board-tag">EDEXCEL</span>
                                <span className="board-tag">OCR</span>
                            </div>
                        </div>

                        <div className="privacy-anchor">
                            <SafeLock size={12} className="lock-icon" />
                            <span>GDPR Compliant | Files are processed privately and not used for training.</span>
                        </div>
                    </div>
                </div>
            </section>


            <section className="universal-tutor-section" id="chat">
                {/* Centered Section Header */}
                <h2 className="section-title center">Interactive AI Maths & English Tutor</h2>

                <div className="tutor-feature-card">
                    <div className="tutor-grid">

                        {/* COLUMN 1: Visual Chat Mockup */}
                        <div className="tutor-visual">
                            <div className="chat-mockup">
                                <div className="chat-bubble user">Why did I lose marks for my working out?</div>
                                <div className="chat-bubble ai">
                                    You skipped the <strong>intermediate step</strong> where you isolate the variable.
                                    All major boards require this to award the full method mark.
                                </div>
                                <div className="chat-bubble user" style={{ marginTop: '12px' }}>
                                    How can I upgrade my Question 4 response from Level 3 to Level 4 on AQA 8700/1?
                                </div>
                                <div className="chat-bubble ai">
                                    To reach <strong>Level 4 (Perceptive &amp; Detailed)</strong>, go beyond explaining single quotes in isolation. Zoom in on the writer&apos;s word connotations and evaluate how the shift in tone shapes the reader&apos;s reaction.
                                </div>
                            </div>
                        </div>

                        {/* COLUMN 2: Descriptive Content */}
                        <div className="tutor-content">
                            <span className="pro-pill">PRO & ULTRA FEATURE</span>
                            <h3>24/7 Follow-up Support</h3>
                            <p className="section-body">
                                Don’t just see the mark—understand it. Get instant, board-specific
                                explanations for <strong>AQA, Edexcel, and OCR</strong>. Ask why you
                                missed a mark or get a personalized walkthrough of any model answer.
                            </p>
                            <button className="secondary-cta" onClick={() => navigate('/app')}>Explore All Features →</button>
                        </div>

                    </div>
                </div>
            </section>

            <SafeUserSegmentation />
            <SafeTestimonials />
            <div id="boards">
                <SafeSupportedPapers />
            </div>

            {/* Final CTA Section */}
            <section className="landing-section final-cta-section">
                <div className="final-cta-container">
                    <h2 className="final-cta-title">Ready to master your GCSE & A-Level Maths & English?</h2>
                    <p className="final-cta-subtitle">Join 15,000+ students using AI Marking to perfect their exam technique.</p>

                    <div className="hero-cta-group">
                        <button className="hero-primary-cta" onClick={handleCtaClick}>
                            Get My Instant Grade (Free)
                        </button>
                    </div>
                </div>
            </section>

            <SafeLandingFooter />
        </div>
    );
};

export default LandingPage;