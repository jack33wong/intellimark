import { Helmet } from 'react-helmet-async';
import React from 'react';
import { useNavigate } from 'react-router-dom';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import LandingFooter from '../components/layout/LandingFooter';
import SeoHeader from '../components/common/SeoHeader';
import './AqaLandingPage.css';

const AqaLandingPage: React.FC = () => {
    const navigate = useNavigate();
    const examYears = [2024, 2023, 2022];

    // Defined tiers for internal grouping
    const tiers = [
        { label: 'Higher Tier', suffix: 'H' },
        { label: 'Foundation Tier', suffix: 'F' }
    ];

    const paperTypes = [
        { id: '1', name: 'Paper 1', desc: 'Non-Calc' },
        { id: '2', name: 'Paper 2', desc: 'Calculator' },
        { id: '3', name: 'Paper 3', desc: 'Calculator' }
    ];

    const handleAction = (code: string, mode: 'mark' | 'model') => {
        navigate(`/app?code=${code}&mode=${mode}`);
    };

    return (
        <div className="light-mode-forced aqa-landing-page">
            <SeoHeader
                title="AQA GCSE Maths Model Answers & AI Marking | Spec 8300"
                description="Instant AQA GCSE Maths model answers and AI marking for 8300 papers (2024-2033). Step-by-step solutions for Higher and Foundation tiers."
                canonicalUrl="https://aimarking.ai/mark-aqa-gcse-maths-past-papers"
            />

            <LandingPageHeader />

            {/* Hero, Logic, and Question Sections remain unchanged to preserve your layout */}
            <section className="landing-section aqa-hero-section">
                <div className="aqa-hero-content">
                    <h1 className="aqa-hero-title">Instant AI Marking & <br /><span className="aqa-highlight-blue">AQA Model Answers</span></h1>
                    <p className="aqa-hero-subtitle">Specifically tuned to the <strong>AQA (8300) specification</strong> for instant grades and model answers.</p>
                    <div className="aqa-hero-cta-box">
                        <button className="aqa-btn-file" onClick={() => navigate('/app?action=select')}>
                            <svg style={{ width: '24px', height: '24px', flexShrink: 0, marginRight: '8px' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                            </svg>
                            <span>Select Paper (PDF/JPG)</span>
                        </button>
                    </div>
                </div>
            </section>

            {/* 2. Logic Analysis */}
            <section className="landing-section aqa-feature-row">
                <div className="aqa-feature-container">
                    <div className="aqa-feature-visual">
                        <div className="aqa-mockup-frame">
                            <img src="/images/spatial_mapping_v3.png" alt="AQA Logic Analysis" style={{ width: '100%', borderRadius: '8px' }} />
                            <div className="aqa-badge-overlay">AQA 8300 Logic Check</div>
                        </div>
                    </div>
                    <div className="aqa-feature-text">
                        <h2 className="aqa-section-title">Mastering the AQA Mark Scheme</h2>
                        <p className="aqa-section-body">
                            Our Logic Chain Analysis identifies exactly where you secured an M1 mark or an Error Carried Forward (ECF) saved your grade.
                        </p>
                    </div>
                </div>
            </section>

            {/* 3. Question Mode */}
            <section className="landing-section aqa-feature-row">
                <div className="aqa-feature-container">
                    <div className="aqa-feature-text">
                        <h2 className="aqa-section-title">Question Mode: AQA Model Answers</h2>
                        <p className="aqa-section-body">
                            Generate perfect model answers using the exact terminology and layout expected by AQA examiners.
                        </p>
                    </div>
                    <div className="aqa-feature-visual">
                        <div className="aqa-mobile-frame">
                            <div className="aqa-mobile-screen">
                                <img src="/images/aqa_question_mode_v2.png" alt="AQA Question Mode" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                            </div>
                        </div>
                    </div>
                </div>
            </section>


            {/* 4. Tidy 3-Column Grid with Internal Tier Grouping */}
            <section className="landing-section aqa-resources-section">
                <div className="aqa-resources-content">
                    <h2 className="aqa-section-title">AQA 8300 Official Resource Archive</h2>

                    <div className="aqa-year-card-grid">
                        {examYears.map(year => (
                            <div key={year} className="aqa-year-card static">
                                <div className="year-card-header">
                                    <span className="year-title">{year} Series</span>
                                    {year === 2024 && <span className="new-tag">Latest</span>}
                                </div>

                                <div className="tier-groups-stack">
                                    {tiers.map(tier => (
                                        <div key={tier.suffix} className="internal-tier-group">
                                            <div className="tier-sublabel">{tier.label}</div>
                                            <div className="paper-list-container">
                                                {paperTypes.map(paper => (
                                                    <div key={`${tier.suffix}-${paper.id}`} className="paper-item-row interactive">
                                                        <div className="paper-meta">
                                                            <span className="paper-name">{paper.name}</span>
                                                            <span className="paper-type">{paper.desc}</span>
                                                        </div>
                                                        <div className="paper-actions">
                                                            <button onClick={() => handleAction(`8300-${paper.id}${tier.suffix}-JUN${year}`, 'model')} className="action-link model">Model</button>
                                                            <button onClick={() => handleAction(`8300-${paper.id}${tier.suffix}-JUN${year}`, 'mark')} className="action-link mark">Mark</button>
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
                </div>
            </section>

            <LandingFooter />
        </div>
    );
};

export default AqaLandingPage;