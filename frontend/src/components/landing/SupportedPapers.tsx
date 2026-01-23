import React from 'react';
import { BookOpen, ShieldCheck } from 'lucide-react';
import './SupportedPapers.css';

const SupportedPapers: React.FC = () => {
    const boards = [
        {
            name: "Pearson Edexcel",
            code: "1MA1",
            series: [
                {
                    year: "November 2024",
                    papers: [
                        { count: "Paper 1", type: "Non-Calc", code: "1MA1/1F", tier: "F" },
                        { count: "Paper 2", type: "Calc", code: "1MA1/2F", tier: "F" },
                        { count: "Paper 3", type: "Calc", code: "1MA1/3F", tier: "F" },
                        { count: "Paper 1", type: "Non-Calc", code: "1MA1/1H", tier: "H" },
                        { count: "Paper 2", type: "Calc", code: "1MA1/2H", tier: "H" },
                        { count: "Paper 3", type: "Calc", code: "1MA1/3H", tier: "H" }
                    ]
                },
                {
                    year: "June 2024",
                    papers: [
                        { count: "Paper 1", type: "Non-Calc", code: "1MA1/1F", tier: "F" },
                        { count: "Paper 2", type: "Calc", code: "1MA1/2F", tier: "F" },
                        { count: "Paper 3", type: "Calc", code: "1MA1/3F", tier: "F" },
                        { count: "Paper 1", type: "Non-Calc", code: "1MA1/1H", tier: "H" },
                        { count: "Paper 2", type: "Calc", code: "1MA1/2H", tier: "H" },
                        { count: "Paper 3", type: "Calc", code: "1MA1/3H", tier: "H" }
                    ]
                },
                {
                    year: "November 2023",
                    papers: [
                        { count: "Paper 1", type: "Non-Calc", code: "1MA1/1F", tier: "F" },
                        { count: "Paper 2", type: "Calc", code: "1MA1/2F", tier: "F" },
                        { count: "Paper 3", type: "Calc", code: "1MA1/3F", tier: "F" },
                        { count: "Paper 1", type: "Non-Calc", code: "1MA1/1H", tier: "H" },
                        { count: "Paper 2", type: "Calc", code: "1MA1/2H", tier: "H" },
                        { count: "Paper 3", type: "Calc", code: "1MA1/3H", tier: "H" }
                    ]
                },
                {
                    year: "June 2023",
                    papers: [
                        { count: "Paper 1", type: "Non-Calc", code: "1MA1/1F", tier: "F" },
                        { count: "Paper 2", type: "Calc", code: "1MA1/2F", tier: "F" },
                        { count: "Paper 3", type: "Calc", code: "1MA1/3F", tier: "F" },
                        { count: "Paper 1", type: "Non-Calc", code: "1MA1/1H", tier: "H" },
                        { count: "Paper 2", type: "Calc", code: "1MA1/2H", tier: "H" },
                        { count: "Paper 3", type: "Calc", code: "1MA1/3H", tier: "H" }
                    ]
                },
                {
                    year: "November 2022",
                    papers: [
                        { count: "Paper 1", type: "Non-Calc", code: "1MA1/1F", tier: "F" },
                        { count: "Paper 2", type: "Calc", code: "1MA1/2F", tier: "F" },
                        { count: "Paper 3", type: "Calc", code: "1MA1/3F", tier: "F" },
                        { count: "Paper 1", type: "Non-Calc", code: "1MA1/1H", tier: "H" },
                        { count: "Paper 2", type: "Calc", code: "1MA1/2H", tier: "H" },
                        { count: "Paper 3", type: "Calc", code: "1MA1/3H", tier: "H" }
                    ]
                },
                {
                    year: "June 2022",
                    papers: [
                        { count: "Paper 1", type: "Non-Calc", code: "1MA1/1F", tier: "F" },
                        { count: "Paper 2", type: "Calc", code: "1MA1/2F", tier: "F" },
                        { count: "Paper 3", type: "Calc", code: "1MA1/3F", tier: "F" },
                        { count: "Paper 1", type: "Non-Calc", code: "1MA1/1H", tier: "H" },
                        { count: "Paper 2", type: "Calc", code: "1MA1/2H", tier: "H" },
                        { count: "Paper 3", type: "Calc", code: "1MA1/3H", tier: "H" }
                    ]
                }
            ]
        },
        {
            name: "AQA",
            code: "8300",
            series: [
                {
                    year: "November 2024",
                    papers: [
                        { count: "Paper 1", type: "Non-Calc", code: "8300/1F", tier: "F" },
                        { count: "Paper 2", type: "Calc", code: "8300/2F", tier: "F" },
                        { count: "Paper 3", type: "Calc", code: "8300/3F", tier: "F" },
                        { count: "Paper 1", type: "Non-Calc", code: "8300/1H", tier: "H" },
                        { count: "Paper 2", type: "Calc", code: "8300/2H", tier: "H" },
                        { count: "Paper 3", type: "Calc", code: "8300/3H", tier: "H" }
                    ]
                },
                {
                    year: "June 2024",
                    papers: [
                        { count: "Paper 1", type: "Non-Calc", code: "8300/1F", tier: "F" },
                        { count: "Paper 2", type: "Calc", code: "8300/2F", tier: "F" },
                        { count: "Paper 3", type: "Calc", code: "8300/3F", tier: "F" },
                        { count: "Paper 1", type: "Non-Calc", code: "8300/1H", tier: "H" },
                        { count: "Paper 2", type: "Calc", code: "8300/2H", tier: "H" },
                        { count: "Paper 3", type: "Calc", code: "8300/3H", tier: "H" }
                    ]
                },
                {
                    year: "November 2023",
                    papers: [
                        { count: "Paper 1", type: "Non-Calc", code: "8300/1F", tier: "F" },
                        { count: "Paper 2", type: "Calc", code: "8300/2F", tier: "F" },
                        { count: "Paper 3", type: "Calc", code: "8300/3F", tier: "F" },
                        { count: "Paper 1", type: "Non-Calc", code: "8300/1H", tier: "H" },
                        { count: "Paper 2", type: "Calc", code: "8300/2H", tier: "H" },
                        { count: "Paper 3", type: "Calc", code: "8300/3H", tier: "H" }
                    ]
                },
                {
                    year: "June 2023",
                    papers: [
                        { count: "Paper 1", type: "Non-Calc", code: "8300/1F", tier: "F" },
                        { count: "Paper 2", type: "Calc", code: "8300/2F", tier: "F" },
                        { count: "Paper 3", type: "Calc", code: "8300/3F", tier: "F" },
                        { count: "Paper 1", type: "Non-Calc", code: "8300/1H", tier: "H" },
                        { count: "Paper 2", type: "Calc", code: "8300/2H", tier: "H" },
                        { count: "Paper 3", type: "Calc", code: "8300/3H", tier: "H" }
                    ]
                },
                {
                    year: "November 2022",
                    papers: [
                        { count: "Paper 1", type: "Non-Calc", code: "8300/1F", tier: "F" },
                        { count: "Paper 2", type: "Calc", code: "8300/2F", tier: "F" },
                        { count: "Paper 3", type: "Calc", code: "8300/3F", tier: "F" },
                        { count: "Paper 1", type: "Non-Calc", code: "8300/1H", tier: "H" },
                        { count: "Paper 2", type: "Calc", code: "8300/2H", tier: "H" },
                        { count: "Paper 3", type: "Calc", code: "8300/3H", tier: "H" }
                    ]
                },
                {
                    year: "June 2022",
                    papers: [
                        { count: "Paper 1", type: "Non-Calc", code: "8300/1F", tier: "F" },
                        { count: "Paper 2", type: "Calc", code: "8300/2F", tier: "F" },
                        { count: "Paper 3", type: "Calc", code: "8300/3F", tier: "F" },
                        { count: "Paper 1", type: "Non-Calc", code: "8300/1H", tier: "H" },
                        { count: "Paper 2", type: "Calc", code: "8300/2H", tier: "H" },
                        { count: "Paper 3", type: "Calc", code: "8300/3H", tier: "H" }
                    ]
                }
            ]
        },
        {
            name: "OCR",
            code: "J560",
            series: [
                {
                    year: "November 2024",
                    papers: [
                        { count: "Paper 1", type: "Calc", code: "J560/01", tier: "F" },
                        { count: "Paper 2", type: "Calc", code: "J560/02", tier: "F" },
                        { count: "Paper 3", type: "Calc", code: "J560/03", tier: "F" },
                        { count: "Paper 4", type: "Calc", code: "J560/04", tier: "H" },
                        { count: "Paper 5", type: "Calc", code: "J560/05", tier: "H" },
                        { count: "Paper 6", type: "Calc", code: "J560/06", tier: "H" }
                    ]
                },
                {
                    year: "June 2024",
                    papers: [
                        { count: "Paper 1", type: "Calc", code: "J560/01", tier: "F" },
                        { count: "Paper 2", type: "Calc", code: "J560/02", tier: "F" },
                        { count: "Paper 3", type: "Calc", code: "J560/03", tier: "F" },
                        { count: "Paper 4", type: "Calc", code: "J560/04", tier: "H" },
                        { count: "Paper 5", type: "Calc", code: "J560/05", tier: "H" },
                        { count: "Paper 6", type: "Calc", code: "J560/06", tier: "H" }
                    ]
                },
                {
                    year: "November 2023",
                    papers: [
                        { count: "Paper 1", type: "Calc", code: "J560/01", tier: "F" },
                        { count: "Paper 2", type: "Calc", code: "J560/02", tier: "F" },
                        { count: "Paper 3", type: "Calc", code: "J560/03", tier: "F" },
                        { count: "Paper 4", type: "Calc", code: "J560/04", tier: "H" },
                        { count: "Paper 5", type: "Calc", code: "J560/05", tier: "H" },
                        { count: "Paper 6", type: "Calc", code: "J560/06", tier: "H" }
                    ]
                },
                {
                    year: "June 2023",
                    papers: [
                        { count: "Paper 1", type: "Calc", code: "J560/01", tier: "F" },
                        { count: "Paper 2", type: "Calc", code: "J560/02", tier: "F" },
                        { count: "Paper 3", type: "Calc", code: "J560/03", tier: "F" },
                        { count: "Paper 4", type: "Calc", code: "J560/04", tier: "H" },
                        { count: "Paper 5", type: "Calc", code: "J560/05", tier: "H" },
                        { count: "Paper 6", type: "Calc", code: "J560/06", tier: "H" }
                    ]
                },
                {
                    year: "November 2022",
                    papers: [
                        { count: "Paper 1", type: "Calc", code: "J560/01", tier: "F" },
                        { count: "Paper 2", type: "Calc", code: "J560/02", tier: "F" },
                        { count: "Paper 3", type: "Calc", code: "J560/03", tier: "F" },
                        { count: "Paper 4", type: "Calc", code: "J560/04", tier: "H" },
                        { count: "Paper 5", type: "Calc", code: "J560/05", tier: "H" },
                        { count: "Paper 6", type: "Calc", code: "J560/06", tier: "H" }
                    ]
                },
                {
                    year: "June 2022",
                    papers: [
                        { count: "Paper 1", type: "Calc", code: "J560/01", tier: "F" },
                        { count: "Paper 2", type: "Calc", code: "J560/02", tier: "F" },
                        { count: "Paper 3", type: "Calc", code: "J560/03", tier: "F" },
                        { count: "Paper 4", type: "Calc", code: "J560/04", tier: "H" },
                        { count: "Paper 5", type: "Calc", code: "J560/05", tier: "H" },
                        { count: "Paper 6", type: "Calc", code: "J560/06", tier: "H" }
                    ]
                }
            ]
        }
    ];

    return (
        <section className="supported-papers">
            <div className="papers-container">
                <div className="badge-container center">
                    <span className="performance-badge">Syllabus Coverage</span>
                </div>
                <h2>Extensive Past Paper Support</h2>
                <div className="status-freshness">
                    <span className="live-dot"></span>
                    <span className="status-text">Mark Schemes Updated: Jan 2026</span>
                </div>

                <div className="papers-display">
                    {boards.map((board, i) => (
                        <div key={i} className="board-section">
                            <div className="board-main-header" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', width: '100%', textAlign: 'center' }}>
                                <span className="board-logo-pill">{board.name} ({board.code})</span>
                                <a
                                    href={`/mark-${board.name.toLowerCase().includes('edexcel') ? 'edexcel' : board.name.toLowerCase()}-gcse-maths-past-papers`}
                                    style={{ color: '#7f00ff', fontWeight: 600, fontSize: '0.9rem', textDecoration: 'none' }}
                                >
                                    Try the {board.name.toLowerCase().includes('edexcel') ? 'Edexcel' : board.name} {board.code} AI Marking Tool →
                                </a>
                            </div>

                            <div className="board-content-scroll">
                                {board.series.map((s, si) => (
                                    <div key={si} className="series-group">
                                        <div className="series-header">
                                            <h4>GCSE Mathematics ({board.code}) {s.year}</h4>
                                        </div>
                                        <div className="series-papers-list">
                                            {s.papers.map((paper, pi) => (
                                                <div key={pi} className="paper-row">
                                                    <div className="paper-info">
                                                        <span className="paper-count">{paper.count}:</span>
                                                        <span className="paper-type">{paper.type}</span>
                                                    </div>
                                                    <div className="paper-meta">
                                                        <span className="paper-code-tag">{paper.code}</span>
                                                        <span className="paper-tier-tag">- {paper.tier}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                <p className="papers-note">
                    <ShieldCheck size={14} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                    A-Level Further Maths support coming in Summer 2026.
                </p>
            </div>
        </section >
    );
};

export default SupportedPapers;
