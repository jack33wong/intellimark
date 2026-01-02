import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Zap, BarChart3, Lock, ArrowRight, Play } from 'lucide-react';
import './AboutPage.css';

const AboutPage: React.FC = () => {
    const navigate = useNavigate();

    return (
        <div className="about-page">
            <div className="about-hero">
                <div className="about-hero-content">
                    <h1 className="about-title">Welcome to <span className="brand-gradient">AI Marking</span></h1>
                    <p className="about-subtitle">
                        Your advanced AI-powered homework marking assistant.
                        Get fast, accurate, and detailed feedback instantly.
                    </p>
                    <div className="about-actions">
                        <button className="btn-primary" onClick={() => navigate('/mark-homework')}>
                            Start New Marking
                        </button>
                        <button className="btn-secondary">
                            Explore Features <Play size={14} fill="currentColor" />
                        </button>
                    </div>
                </div>
                <div className="about-hero-image">
                    <div className="hero-image-wrapper">
                        {/* Using the generated image once available, for now using a placeholder div with gradient */}
                        <img src="/images/ai-brain.png" alt="AI Brain Analytics" className="floating-ai-visual" />
                        <div className="hero-glow"></div>
                    </div>
                </div>
            </div>

            <div className="about-features">
                <div className="feature-card">
                    <div className="feature-icon-wrapper">
                        <Zap className="feature-icon" size={24} />
                    </div>
                    <h3>Instant Grading</h3>
                    <p>Submit your work and receive detailed marks and feedback in seconds, powered by state-of-the-art AI.</p>
                </div>

                <div className="feature-card">
                    <div className="feature-icon-wrapper">
                        <BarChart3 className="feature-icon" size={24} />
                    </div>
                    <h3>Detailed Analysis</h3>
                    <p>Get deep insights into your performance, identify strengths, and get actionable strategies for improvement.</p>
                </div>

                <div className="feature-card">
                    <div className="feature-icon-wrapper">
                        <Lock className="feature-icon" size={24} />
                    </div>
                    <h3>Secure & Private</h3>
                    <p>Your documents are encrypted and private. We ensure your data is safe and accessible only to you.</p>
                </div>
            </div>

            <div className="about-footer-cta">
                <div className="cta-content">
                    <h2>Ready to transform your learning?</h2>
                    <p>Join thousands of students and teachers using AI Marking to achieve better results.</p>
                    <button className="cta-btn" onClick={() => navigate('/mark-homework')}>
                        Get Started Free <ArrowRight size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AboutPage;
