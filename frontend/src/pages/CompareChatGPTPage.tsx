import React, { useEffect } from 'react';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import LandingFooter from '../components/layout/LandingFooter';
import { Check, X, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import './CompareChatGPTPage.css';

const CompareChatGPTPage: React.FC = () => {
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    return (
        <div className="compare-page-wrapper light-mode-forced">
            <Helmet>
                <script type="application/ld+json">
                    {JSON.stringify({
                        "@context": "https://schema.org",
                        "@type": "FAQPage",
                        "mainEntity": [
                            {
                                "@type": "Question",
                                "name": "Why is aimarking.ai better than ChatGPT for GCSE Maths marking?",
                                "acceptedAnswer": {
                                    "@type": "Answer",
                                    "text": "Unlike ChatGPT, which is a text-based language model that often 'hallucinates' math steps, aimarking.ai uses spatial coordinate mapping to identify exactly where you earned marks on your handwritten paper. It provides 0.1mm precision and is 100% Mathpix powered for industry-leading accuracy."
                                }
                            },
                            {
                                "@type": "Question",
                                "name": "Does ChatGPT award Method Marks (M1) for handwritten maths?",
                                "acceptedAnswer": {
                                    "@type": "Answer",
                                    "text": "No. ChatGPT typically provides text-only, binary (Right/Wrong) feedback and often fails to recognize partial logic in handwriting. Our Spatial AI identifies specific steps—such as correct prime factorisation—to award M1 Method Marks even if the final answer is incorrect."
                                }
                            },
                            {
                                "@type": "Question",
                                "name": "How accurate is aimarking.ai compared to generic AI tools?",
                                "acceptedAnswer": {
                                    "@type": "Answer",
                                    "text": "aimarking.ai achieves a 99.2% match with senior human examiners by applying Error Carried Forward (ECF) logic that generic AI cannot replicate. While ChatGPT is 0.1mm 'Blind' to spatial data, our platform provides pixel-perfect annotations directly on your working."
                                }
                            }
                        ]
                    })}
                </script>
            </Helmet>
            <LandingPageHeader />

            <main className="compare-container">
                <section className="compare-hero">
                    <h1 className="features-h1">Why ChatGPT Fails at GCSE Maths (And Why Spatial AI Wins)</h1>
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
                            <h2 className="features-h2">ChatGPT predicts the next word. aimarking.ai maps the next coordinate.</h2>
                            <p>
                                ChatGPT struggles with the nuances of messy student handwriting and complex mathematical notation on paper.
                                Empowered by Mathpix—the industry gold standard for mathematical OCR—AI Marking achieves 100% recognition accuracy,
                                identifying every strike-through and formula with professional examiner-grade precision.
                            </p>
                        </div>
                        <div className="compare-feature-visual">
                            <img
                                src="/images/compare/circle_proof_v1.png"
                                alt="Circle Proof Spatial Marking Screenshot"
                                style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#fcfcfc', padding: '12px' }}
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
                                src="/images/compare/validated_marking_table.png"
                                alt="Validated Marking Performance Table"
                                style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#fcfcfc', padding: '12px' }}
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
                                    <td className="cross-col">0.1mm Blind</td>
                                    <td className="check-col">0.1mm Precision (Mathpix DCR)</td>
                                </tr>
                                <tr>
                                    <td>Official Exam Board Logic</td>
                                    <td className="cross-col">None (General knowledge)</td>
                                    <td className="check-col">Edexcel, AQA, OCR trained</td>
                                </tr>
                                <tr>
                                    <td>Step-by-step mark extraction</td>
                                    <td className="cross-col">Logic Hallucination</td>
                                    <td className="check-col">Applied ECF Logic (99.2% Match)</td>
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

                <section className="compare-faq-section">
                    <div className="faq-q-card">
                        <h3>Why is ChatGPT bad at maths?</h3>
                        <p>
                            ChatGPT is a language model that lacks spatial awareness. It cannot identify the X/Y coordinates of your handwriting to award Method Marks (M1) or follow Error Carried Forward (ECF) logic.
                        </p>
                    </div>
                </section>

                <div className="compare-footer-cta">
                    <Link to="/app" className="feature-pill-btn">
                        Try AI Marking for free <ArrowRight size={18} style={{ marginLeft: '8px' }} />
                    </Link>

                    <div className="qr-code-wrapper">
                        <img src="/images/qr-demo.png" alt="Scan to try" />
                        <p className="qr-caption">
                            Reading on Desktop? Scan to see how we mark your handwriting instantly.
                        </p>
                    </div>
                </div>
            </main>

            <LandingFooter />
        </div>
    );
};

export default CompareChatGPTPage;
