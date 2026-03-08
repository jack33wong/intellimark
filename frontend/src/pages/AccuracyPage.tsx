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
                title="As Accurate as a Senior Examiner | AI Marking Accuracy"
                description="We’ve tested our AI against hundreds of thousands of real past papers so you can trust your grade."
            />
            <LandingPageHeader />

            <header className="accuracy-hero">
                <div className="lab-badge">
                    <FlaskConical size={14} /> <span>AI MARKING TECHNICAL REPORT</span>
                </div>
                <h1>As Accurate as a Senior Examiner</h1>
                <p>We’ve tested our AI against hundreds of thousands of real past papers so you can trust your grade.</p>
            </header>

            <main className="accuracy-grid">
                {/* Top Level Stats */}
                <section className="key-metrics">
                    <div className="metric-box">
                        <BarChart3 className="metric-icon" />
                        <div className="metric-val">98.2% Match</div>
                        <div className="metric-title">Examiner Accuracy</div>
                        <div className="metric-desc">Our AI gives the exact same grade as a human examiner 98.2% of the time.</div>
                    </div>
                    <div className="metric-box">
                        <Zap className="metric-icon" />
                        <div className="metric-val">Instant Results</div>
                        <div className="metric-title">Speed</div>
                        <div className="metric-desc">Get your fully marked paper back in under a second.</div>
                    </div>
                    <div className="metric-box">
                        <Shield className="metric-icon" />
                        <div className="metric-val">100% Consistent</div>
                        <div className="metric-title">Fairness</div>
                        <div className="metric-desc">Unlike humans, our AI never gets tired, moody, or marks harshly on a bad day.</div>
                    </div>
                </section>

                {/* Data Visualization */}
                <section className="viz-content">
                    <div className="report-card">
                        <h2>No More Unfair Marking</h2>
                        <p>
                            Human teachers disagree on grades all the time. Our AI is trained exclusively by top-tier senior examiners to perfectly follow the official mark schemes, meaning you always get the fairest, most accurate grade possible.
                        </p>
                        <DivergenceChart />
                    </div>
                </section>

                {/* Technical Sidebar */}
                <aside className="tech-specs">
                    <div className="spec-item">
                        <Binary size={20} />
                        <h4>Reads Your Working Out</h4>
                        <p>Our engine doesn't just scan for text. It actually understands mathematical structure, meaning it can follow your unique steps and working out.</p>
                    </div>
                    <div className="spec-item">
                        <CheckCircle2 size={20} />
                        <h4>100% Private & Secure</h4>
                        <p>Your data is anonymous and encrypted. Your papers are for your eyes only, and we never share your results with your school.</p>
                    </div>
                </aside>

                {/* Methodology */}
                <section className="methodology">
                    <h2>Tested on Real Student Exams</h2>
                    <div className="method-grid">
                        <div className="method-text">
                            <h3>Trusted by Thousands</h3>
                            <p>
                                In our latest blind study, our AI accurately identified 'follow-through' marks (points awarded even after an earlier mistake) in 94% of cases—matching or exceeding human performance on complex 5-mark questions.
                            </p>
                        </div>
                        <div className="method-stats">
                            <div className="sub-stat">
                                <span>Total Dataset</span>
                                <strong>524k Pages</strong>
                            </div>
                            <div className="sub-stat">
                                <span>Verified Quality</span>
                                <strong>Continuously Verified by Real Examiners</strong>
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
