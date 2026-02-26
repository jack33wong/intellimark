import React from 'react';
import './TrustSignals.css';

const TrustSignals: React.FC = () => {
    return (
        <div className="success-story-section">
            <div className="trust-grid-container">

                {/* 1. ORIGINAL: Marking Performance Table */}
                <div className="success-story-card benchmark-card">
                    <div className="content-container">
                        <div className="badge-container">
                            <span className="performance-badge">2026 EXAMINER BENCHMARK</span>
                        </div>
                        <h2 className="success-title">Marking Performance</h2>
                        <div className="benchmark-table-wrapper">
                            <table className="benchmark-table">
                                <thead>
                                    <tr>
                                        <th>Metric</th>
                                        <th>AI Marking</th>
                                        <th>Result</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td data-label="Metric">Spatial Accuracy</td>
                                        <td data-label="AI Marking" className="highlight">100% (Mathpix)</td>
                                        <td data-label="Result" className="outcome"><span className="outcome-badge">Critical Edge</span></td>
                                    </tr>
                                    <tr>
                                        <td data-label="Metric">ECF Logic</td>
                                        <td data-label="AI Marking" className="highlight">Applied</td>
                                        <td data-label="Result" className="outcome"><span className="outcome-badge">99.2% Match</span></td>
                                    </tr>
                                    <tr>
                                        <td data-label="Metric">Marking Speed</td>
                                        <td data-label="AI Marking" className="highlight">&lt; 1 Second</td>
                                        <td data-label="Result" className="outcome"><span className="outcome-badge">SaaS Edge</span></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

                {/* 2. NEW: Model Answer Quality Table */}
                <div className="success-story-card benchmark-card">
                    <div className="content-container">
                        <div className="badge-container">
                            <span className="performance-badge">2026 SOLUTION QUALITY AUDIT</span>
                        </div>
                        <h2 className="success-title">Model Answer Quality</h2>
                        <div className="benchmark-table-wrapper">
                            <table className="benchmark-table">
                                <thead>
                                    <tr>
                                        <th>Metric</th>
                                        <th>AI Model Answer</th>
                                        <th>Result</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td data-label="Metric">Spec Alignment</td>
                                        <td data-label="AI Model Answer" className="highlight">100% (8300/1MA1)</td>
                                        <td data-label="Result" className="outcome"><span className="outcome-badge">Perfect Match</span></td>
                                    </tr>
                                    <tr>
                                        <td data-label="Metric">Step-by-Step Logic</td>
                                        <td data-label="AI Model Answer" className="highlight">Full Chain Analysis</td>
                                        <td data-label="Result" className="outcome"><span className="outcome-badge">Educational Edge</span></td>
                                    </tr>
                                    <tr>
                                        <td data-label="Metric">Marking Clarity</td>
                                        <td data-label="AI Model Answer" className="highlight">M/P/A/B Breaks</td>
                                        <td data-label="Result" className="outcome"><span className="outcome-badge">Visual Edge</span></td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>

            </div>

            <p className="success-disclaimer center">
                * Data validated against 2026 AI Quality Protocol for secondary mathematics assessment.
            </p>
        </div>
    );
};

export default TrustSignals;