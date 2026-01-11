import React, { useEffect } from 'react';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import LandingFooter from '../components/layout/LandingFooter';
import { Check, X, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import './CompareChatGPTPage.css';

const CompareChatGPTPage: React.FC = () => {
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    return (
        <div className="compare-page-wrapper light-mode-forced">
            <LandingPageHeader />

            <main className="compare-container">
                <section className="compare-hero">
                    <h1 className="features-h1">Is AI Marking better than ChatGPT?</h1>
                    <p>
                        ChatGPT is a brilliant conversationalist. AI Marking is a professional exam marker.
                        Understand the difference between general AI and specialized assessment technology.
                    </p>
                    <div className="compare-hero-visual-wrapper" style={{ marginTop: '60px', display: 'flex', justifyContent: 'center' }}>
                        <img
                            src="/images/compare/vs_sketch.png"
                            alt="AI Marking vs ChatGPT sketch"
                            style={{
                                width: '100%',
                                maxWidth: '800px',
                                height: 'auto',
                                borderRadius: '24px',
                                boxShadow: '0 20px 60px rgba(0, 0, 0, 0.1)',
                                border: '1px solid rgba(0, 0, 0, 0.03)',
                                mixBlendMode: 'multiply'
                            }}
                        />
                    </div>
                </section>

                <section className="compare-features">
                    <div className="compare-feature-row">
                        <div className="compare-feature-text">
                            <h2 className="features-h2">Handwriting vs. Text</h2>
                            <p>
                                ChatGPT struggles with the nuances of messy student handwriting and complex mathematical notation on paper.
                                Empowered by Mathpix—the industry gold standard for mathematical OCR—AI Marking achieves 100% recognition accuracy,
                                identifying every strike-through and formula with professional examiner-grade precision.
                            </p>
                        </div>
                        <div className="compare-feature-visual">
                            <img
                                src="/images/compare/handwriting_vs_text_v2.png"
                                alt="Handwriting vs Text sketch"
                                style={{ width: '100%', height: '100%', objectFit: 'contain', mixBlendMode: 'multiply' }}
                            />
                        </div>
                    </div>

                    <div className="compare-feature-row reversed">
                        <div className="compare-feature-text">
                            <h2 className="features-h2">Logic vs. Hallucination</h2>
                            <p>
                                General AI can often "hallucinate" mathematical steps or apply incorrect marking criteria.
                                AI Marking executes using a deterministic engine cross-referenced with official Edexcel, AQA, and OCR marking schemes.
                                We don't guess—we calculate.
                            </p>
                        </div>
                        <div className="compare-feature-visual">
                            <img
                                src="/images/compare/logic_vs_hallucination.jpg"
                                alt="Deterministic marking vs AI hallucination"
                                style={{ width: '100%', height: '100%', objectFit: 'contain', mixBlendMode: 'multiply' }}
                            />
                        </div>
                    </div>
                </section>

                <section className="compare-table-section">
                    <h2 className="features-h1">The Comparison</h2>
                    <div className="compare-table-card">
                        <table className="compare-table">
                            <thead>
                                <tr>
                                    <th>Feature</th>
                                    <th>ChatGPT-4o</th>
                                    <th>AI Marking</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td>Handwritten Math Recognition</td>
                                    <td className="cross-col">Limited / Prone to errors</td>
                                    <td className="check-col">100% precision (Mathpix OCR)</td>
                                </tr>
                                <tr>
                                    <td>Official Exam Board Logic</td>
                                    <td className="cross-col">None (General knowledge)</td>
                                    <td className="check-col">Edexcel, AQA, OCR trained</td>
                                </tr>
                                <tr>
                                    <td>Step-by-step mark extraction</td>
                                    <td className="cross-col">Inconsistent</td>
                                    <td className="check-col">Calculated per sub-question</td>
                                </tr>
                                <tr>
                                    <td>Feedback Depth</td>
                                    <td className="cross-col">Conversational summary</td>
                                    <td className="check-col">Actionable examiner hints</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </section>

                <section className="use-case-section">
                    <div className="use-case-card chatgpt">
                        <h3 className="features-h3">Use ChatGPT for</h3>
                        <ul>
                            <li><Check size={20} /> Brainstorming essay ideas</li>
                            <li><Check size={20} /> Summarizing textbook chapters</li>
                            <li><Check size={20} /> General homework help</li>
                            <li><Check size={20} /> Explaining concepts simply</li>
                        </ul>
                    </div>
                    <div className="use-case-card aimarking">
                        <h3 className="features-h3">Use AI Marking for</h3>
                        <ul>
                            <li><Check size={20} /> Marking real past papers</li>
                            <li><Check size={20} /> Getting exact mark predictions</li>
                            <li><Check size={20} /> Identifying board-specific weak spots</li>
                            <li><Check size={20} /> Reducing teacher marking time</li>
                        </ul>
                    </div>
                </section>

                <div style={{ textAlign: 'center', marginTop: '120px' }}>
                    <Link to="/app" className="feature-pill-btn">
                        Try AI Marking for free <ArrowRight size={18} style={{ marginLeft: '8px' }} />
                    </Link>
                </div>
            </main>

            <LandingFooter />
        </div>
    );
};

export default CompareChatGPTPage;
