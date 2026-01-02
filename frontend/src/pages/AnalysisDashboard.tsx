import React from 'react';
import {
    TrendingUp,
    Target,
    Award,
    Calendar,
    ArrowUpRight,
    CheckCircle2,
    AlertCircle,
    BrainCircuit
} from 'lucide-react';
import './AnalysisDashboard.css';

const AnalysisDashboard: React.FC = () => {
    // Mock data inspired by the user's provided screenshot
    const stats = [
        { label: 'Total Attempts', value: '18', icon: <Calendar size={20} />, change: '+3 this month' },
        { label: 'Average Score', value: '75.6%', icon: <Target size={20} />, change: '+5.2% trend' },
        { label: 'Highest Grade', value: '9', icon: <Award size={20} />, change: 'Top 5% user' },
        { label: 'Average Grade', value: '7.8', icon: <TrendingUp size={20} />, change: 'Steadily rising' },
    ];

    const gradeProgressData = [
        { month: 'Jan', grade: 5 },
        { month: 'Feb', grade: 6 },
        { month: 'Mar', grade: 6 },
        { month: 'Apr', grade: 7 },
        { month: 'May', grade: 8 },
        { month: 'Jun', grade: 9 },
    ];

    return (
        <div className="analysis-dashboard">
            <header className="dashboard-header">
                <div className="header-titles">
                    <h1 className="dashboard-title">Performance Analysis</h1>
                    <p className="dashboard-subtitle">Mathematics • GCSE • Pearson Edexcel</p>
                </div>
                <div className="dashboard-header-actions">
                    <button className="btn-outline-glow">Export Report</button>
                </div>
            </header>

            <section className="kpi-grid">
                {stats.map((stat, i) => (
                    <div key={i} className="kpi-card">
                        <div className="kpi-icon-row">
                            <div className="kpi-icon-box">{stat.icon}</div>
                            <span className="kpi-trend positive">{stat.change}</span>
                        </div>
                        <div className="kpi-value-row">
                            <span className="kpi-value">{stat.value}</span>
                            <span className="kpi-label">{stat.label}</span>
                        </div>
                    </div>
                ))}
            </section>

            <section className="dashboard-main-grid">
                <div className="dashboard-col-left">
                    <div className="dashboard-card summary-card">
                        <div className="card-header">
                            <BrainCircuit size={20} className="text-purple-400" />
                            <h3>AI Performance Summary</h3>
                        </div>
                        <div className="card-body">
                            <p>
                                The student has shown improvement, achieving a score of 62/84 (74%), equivalent to grade 9.
                                This demonstrates progression and structured achievement. While strengths exist, some minor errors in arithmetic
                                suggest room for advancement to a higher grade.
                            </p>
                        </div>
                    </div>

                    <div className="dashboard-card strategy-card">
                        <div className="card-header">
                            <Target size={20} className="text-yellow-400" />
                            <h3>Grade Improvement Strategy</h3>
                        </div>
                        <div className="card-body">
                            <div className="strategy-alert">
                                <AlertCircle size={18} />
                                <span>The student is 2 marks away from a solid 9+.</span>
                            </div>
                            <p>
                                To improve, focus on areas where marks were dropped, such as Q1, Q5, Q9, Q12, Q19, Q19a and Q22.
                                In these questions marks were dropped in each. These questions indicate potential for improvement through
                                careful review of methods and attention to detail to avoid losing marks on application.
                            </p>
                        </div>
                    </div>

                    <div className="dashboard-split-box">
                        <div className="dashboard-card small-card">
                            <div className="card-header">
                                <CheckCircle2 size={18} className="text-green-400" />
                                <h3>Strengths</h3>
                            </div>
                            <ul className="dashboard-list">
                                <li>Strong understanding of algebra</li>
                                <li>Excellent problem-solving skills</li>
                                <li>Good grasp of fundamental mathematical concepts</li>
                                <li>Consistent performance across various question types</li>
                            </ul>
                        </div>
                        <div className="dashboard-card small-card">
                            <div className="card-header">
                                <TrendingUp size={18} className="text-blue-400" />
                                <h3>Areas for Improvement</h3>
                            </div>
                            <ul className="dashboard-list">
                                <li>Losing marks on questions requiring detailed application of knowledge</li>
                                <li>Potential for improvement in accuracy and attention to detail</li>
                                <li>Consistent application of arithmetic leading to marks loss</li>
                            </ul>
                        </div>
                    </div>
                </div>

                <div className="dashboard-col-right">
                    <div className="dashboard-card chart-card">
                        <div className="card-header">
                            <TrendingUp size={20} />
                            <h3>Grade Progress</h3>
                        </div>
                        <div className="chart-placeholder">
                            {/* Complex SVG Chart based on user screenshot */}
                            <svg width="100%" height="240" viewBox="0 0 400 200">
                                <defs>
                                    <linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor="var(--about-accent)" stopOpacity="0.3" />
                                        <stop offset="100%" stopColor="var(--about-accent)" stopOpacity="0" />
                                    </linearGradient>
                                </defs>
                                <path
                                    d="M 20 180 Q 80 160 140 160 Q 200 130 260 100 Q 320 80 380 40"
                                    stroke="var(--about-accent)"
                                    fill="none"
                                    strokeWidth="3"
                                    className="chart-path"
                                />
                                <circle cx="20" cy="180" r="4" fill="var(--about-accent)" />
                                <circle cx="140" cy="160" r="4" fill="var(--about-accent)" />
                                <circle cx="260" cy="100" r="4" fill="var(--about-accent)" />
                                <circle cx="380" cy="40" r="4" fill="var(--about-accent)" />

                                {/* Horizontal grid lines */}
                                <line x1="0" y1="40" x2="400" y2="40" stroke="rgba(255,255,255,0.05)" />
                                <line x1="0" y1="80" x2="400" y2="80" stroke="rgba(255,255,255,0.05)" />
                                <line x1="0" y1="120" x2="400" y2="120" stroke="rgba(255,255,255,0.05)" />
                                <line x1="0" y1="160" x2="400" y2="160" stroke="rgba(255,255,255,0.05)" />
                            </svg>
                            <div className="chart-labels">
                                <span>Jan</span>
                                <span>Mar</span>
                                <span>May</span>
                                <span>Jun</span>
                            </div>
                        </div>
                    </div>

                    <div className="dashboard-card session-history-card">
                        <div className="card-header">
                            <Calendar size={20} />
                            <h3>Recent Sessions</h3>
                        </div>
                        <div className="session-list">
                            {[1, 2, 3].map(i => (
                                <div key={i} className="session-item">
                                    <div className="session-info">
                                        <span className="session-date">June 2024 • Paper 1H</span>
                                        <span className="session-score">Score: 62/84</span>
                                    </div>
                                    <div className="session-grade">9</div>
                                    <ArrowUpRight size={16} className="session-link-icon" />
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
};

export default AnalysisDashboard;
