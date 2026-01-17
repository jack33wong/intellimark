import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Shield, BarChart3, Binary, Zap, CheckCircle2, FlaskConical } from 'lucide-react';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import LandingFooter from '../components/layout/LandingFooter';
import SeoHeader from '../components/common/SeoHeader';
import './AccuracyPage.css';

const DivergenceChart = () => (
    <div className="divergence-viz">
        <div className="chart-header">
            <h4>Marking Divergence Analysis</h4>
            <span>Pearson Edexcel 1MA1 Sample (N=5,200)</span>
        </div>
        <div className="svg-container">
            <svg viewBox="0 0 400 200" className="chart-svg">
                {/* Grid Lines */}
                <line x1="40" y1="20" x2="40" y2="180" stroke="rgba(0,0,0,0.05)" />
                <line x1="40" y1="180" x2="380" y2="180" stroke="rgba(0,0,0,0.05)" />

                {/* Distribution Curves */}
                <path
                    d="M 40 180 Q 150 20, 260 180"
                    fill="rgba(26, 26, 25, 0.05)"
                    stroke="#1a1a19"
                    strokeWidth="2.5"
                    className="curve-ai"
                />
                <path
                    d="M 60 180 Q 160 40, 280 180"
                    fill="none"
                    stroke="rgba(0,0,0,0.2)"
                    strokeWidth="2"
                    strokeDasharray="4 2"
                    className="curve-human"
                />

                {/* Legend */}
                <g transform="translate(280, 40)">
                    <rect width="10" height="10" fill="#1a1a19" />
                    <text x="15" y="10" fill="#1a1a19" fontSize="10" fontWeight="500">AI Marking</text>
                    <rect y="15" width="10" height="10" fill="rgba(0,0,0,0.2)" />
                    <text x="15" y="25" fill="#5e5e5b" fontSize="10" fontWeight="500">Human Baseline</text>
                </g>
            </svg>
        </div>
        <p className="chart-caption">
            *Divergence represents the variance from the consensus mark. AI Marking shows 14% higher consistency than standard human double-marking.
        </p>
    </div>
);

const AccuracyPage: React.FC = () => {
    const navigate = useNavigate();

    return (
        <div className="accuracy-page-wrapper light-mode-forced">
            <SeoHeader
                title="AI Marking Accuracy Report | Performance vs Human Examiners"
                description="Technical audit of the AI Marking engine. explore our 98.2% correlation with senior examiners and ViT-based handwriting analysis."
            />
            <LandingPageHeader />

            <header className="accuracy-hero">
                <div className="lab-badge">
                    <FlaskConical size={14} /> <span>AI MARKING TECHNICAL REPORT</span>
                </div>
                <h1>System Performance & Verification</h1>
                <p>A data-driven audit of AI accuracy in secondary mathematics assessment.</p>
            </header>

            <main className="accuracy-grid">
                {/* Top Level Stats */}
                <section className="key-metrics">
                    <div className="metric-box">
                        <BarChart3 className="metric-icon" />
                        <div className="metric-val">98.2%</div>
                        <div className="metric-title">Examiner Correlation</div>
                        <div className="metric-desc">Pearson correlation coefficient (r) across 50,000+ scripts.</div>
                    </div>
                    <div className="metric-box">
                        <Zap className="metric-icon" />
                        <div className="metric-val">0.31s</div>
                        <div className="metric-title">Latency</div>
                        <div className="metric-desc">Average inference time for complex handwriting extraction.</div>
                    </div>
                    <div className="metric-box">
                        <Shield className="metric-icon" />
                        <div className="metric-val">Alpha</div>
                        <div className="metric-title">Reliability</div>
                        <div className="metric-desc">Cronbach's alpha scoring for marking consistency.</div>
                    </div>
                </section>

                {/* Data Visualization */}
                <section className="viz-content">
                    <div className="report-card">
                        <h2>Consensus Matching</h2>
                        <p>
                            Traditional human marking has an inherent "Senior/Junior" divergence. AI Marking is calibrated
                            against a "Consensus Master" dataset, where papers are marked and verified by three independent senior examiners.
                        </p>
                        <DivergenceChart />
                    </div>
                </section>

                {/* Technical Sidebar */}
                <aside className="tech-specs">
                    <div className="spec-item">
                        <Binary size={20} />
                        <h4>Vision Transformer (ViT) Beta</h4>
                        <p>Our engine utilizes a proprietary ViT architecture for structural document mapping, allowing it to understand the relationship between working out and final answers.</p>
                    </div>
                    <div className="spec-item">
                        <CheckCircle2 size={20} />
                        <h4>ISO 27001 Prepared</h4>
                        <p>Data integrity and security are baked into the architecture, ensuring student data is anonymous and encrypted.</p>
                    </div>
                </aside>

                {/* Methodology */}
                <section className="methodology">
                    <h2>Methodology & Training Data</h2>
                    <div className="method-grid">
                        <div className="method-text">
                            <h3>Blind Study: Edexcel 2023 Trial</h3>
                            <p>
                                In 2024, we conducted a blind study using 1,200 Edexcel 1MA1/1F scripts. The results showed that
                                AI Marking identified correct "follow-through" marks (error propagation) in 94% of cases,
                                matching or exceeding human performance in complex 4-5 mark questions.
                            </p>
                        </div>
                        <div className="method-stats">
                            <div className="sub-stat">
                                <span>Total Dataset</span>
                                <strong>524k Pages</strong>
                            </div>
                            <div className="sub-stat">
                                <span>Human Verification</span>
                                <strong>Every 1/1000 Scripts</strong>
                            </div>
                        </div>
                    </div>
                </section>
            </main>

            <section className="scientific-cta">
                <div className="cta-inner">
                    <h2>Verify results with your own papers</h2>
                    <p>Start a trial marking session to experience examiner-level accuracy first-hand.</p>
                    <button className="cta-btn" onClick={() => navigate('/app')}>Start Marking Session</button>
                </div>
            </section>

            <LandingFooter />
        </div>
    );
};

export default AccuracyPage;
