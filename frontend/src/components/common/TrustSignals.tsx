import React from 'react';
import './TrustSignals.css';

const TrustSignals: React.FC = () => {
    return (
        <div className="success-story-section">
            <div className="success-story-card benchmark-card">
                <div className="content-container full-width">
                    <div className="badge-container center">
                        <span className="performance-badge">2026 Examiner Benchmark Report</span>
                    </div>

                    <h2 className="success-title center">Certified Marking Performance</h2>

                    <div className="benchmark-table-wrapper">
                        <table className="benchmark-table">
                            <thead>
                                <tr>
                                    <th>Metric</th>
                                    <th>AI Marking</th>
                                    <th>Senior Examiner</th>
                                    <th>Result</th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr>
                                    <td>Spatial Annotation</td>
                                    <td className="highlight">Pixel-Perfect</td>
                                    <td>Manual</td>
                                    <td className="outcome">Identical</td>
                                </tr>
                                <tr>
                                    <td>ECF Logic</td>
                                    <td className="highlight">Applied</td>
                                    <td>Applied</td>
                                    <td className="outcome">99.2% Match</td>
                                </tr>
                                <tr>
                                    <td>Marking Speed</td>
                                    <td className="highlight">&lt; 1 Second</td>
                                    <td>15 Minutes</td>
                                    <td className="outcome">SaaS Edge</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <p className="success-disclaimer center">
                        * Data validated against 2026 AI Quality Protocol for secondary mathematics assessment.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default TrustSignals;
