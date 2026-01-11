import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import SeoHeader from '../components/common/SeoHeader';
import LandingPageUploadWidget from '../components/common/LandingPageUploadWidget';
import './ProgrammaticLandingPage.css';

const ProgrammaticLandingPage: React.FC = () => {
    const { examBoard, year } = useParams<{ examBoard: string; year?: string }>();
    const navigate = useNavigate();

    const boardDisplay = examBoard?.toUpperCase() || 'GCSE';
    const yearDisplay = year || '2024';

    const handleStartMarking = (files?: FileList | File[]) => {
        if (files && files.length > 0) {
            // Convert FileList to Array if necessary
            const fileArray = Array.from(files);
            navigate('/app', { state: { pendingFiles: fileArray } });
        } else {
            navigate('/app');
        }
    };

    return (
        <div className="landing-page">
            <SeoHeader examBoard={boardDisplay} year={yearDisplay} />

            <header className="landing-hero">
                <div className="hero-content">
                    <h1>AI {boardDisplay} Maths Marking</h1>
                    <p className="hero-subtitle">
                        Get instant, examiner-level feedback for your {boardDisplay} {yearDisplay} past papers.
                    </p>

                    {/* NEW: Upload Widget directly on landing page */}
                    <div className="landing-upload-container">
                        <LandingPageUploadWidget
                            onUpload={handleStartMarking}
                            examBoard={boardDisplay}
                        />
                    </div>

                    <div className="hero-badges">
                        <span className="badge">✓ Supporting {boardDisplay}</span>
                        <span className="badge">✓ Handwriting Recognition</span>
                        <span className="badge">✓ Step-by-Step Feedback</span>
                    </div>
                </div>
            </header>

            <section className="landing-features">
                <div className="feature-grid">
                    <div className="feature-card">
                        <h3>Accurate {boardDisplay} Grading</h3>
                        <p>Our AI is trained on thousands of {boardDisplay} scripts to ensure consistent, accurate results.</p>
                    </div>
                    <div className="feature-card">
                        <h3>Instant Feedback</h3>
                        <p>No more waiting for days. Get your marks and reasoning in seconds.</p>
                    </div>
                    <div className="feature-card">
                        <h3>Improve Your Grade</h3>
                        <p>Understand exactly where you lost marks with detailed AI commentary.</p>
                    </div>
                </div>
            </section>

            <section className="landing-cta-bottom">
                <h2>Ready to boost your {boardDisplay} Maths grade?</h2>
                <div className="bottom-cta-container">
                    <LandingPageUploadWidget
                        onUpload={handleStartMarking}
                        examBoard={boardDisplay}
                        compact
                    />
                </div>
            </section>

            <footer className="landing-footer">
                <p>© 2026 AI Marking • AI-Powered Education</p>
            </footer>
        </div>
    );
};

export default ProgrammaticLandingPage;
