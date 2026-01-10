import React from 'react';
import './TrustSignals.css';

const TrustSignals: React.FC = () => {
    return (
        <div className="success-story-section">
            <div className="success-story-card">
                <div className="sketch-container">
                    <img
                        src="/images/performance.png"
                        alt="Performance Visualization"
                        className="examiner-sketch"
                    />
                    <div className="metric-overlay">
                        <span className="overlay-value">99.2%</span>
                        <span className="overlay-label">Accuracy Rank</span>
                    </div>
                </div>

                <div className="content-container">
                    <div className="badge-container">
                        <span className="performance-badge">2026 Accuracy Benchmark</span>
                    </div>

                    <h2 className="success-title">Certified Marking Performance</h2>

                    <p className="success-quote">
                        "Validated against official AQA & Edexcel scripts to ensure senior examiner rigor."
                    </p>

                    <div className="success-metrics-grid">
                        <div className="success-metric">
                            <span className="metric-val">99.2%</span>
                            <span className="metric-desc">Marking Correlation</span>
                        </div>
                        <div className="success-metric">
                            <span className="metric-val">&lt; 1s</span>
                            <span className="metric-desc">Processing Speed</span>
                        </div>
                        <div className="success-metric">
                            <span className="metric-val">100%</span>
                            <span className="metric-desc">Syllabus Coverage</span>
                        </div>
                    </div>

                    <p className="success-disclaimer">
                        * Benchmarked using the 2026 AI Quality Protocol.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default TrustSignals;
