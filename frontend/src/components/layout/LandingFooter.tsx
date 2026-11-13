import React from 'react';
import { Link } from 'react-router-dom';
import { getSupportMailto } from '../../config/support';
import './LandingFooter.css';

export const LandingFooter: React.FC = () => {
    return (
        <footer className="landing-footer-main">
            <div className="footer-container horizontal">
                <div className="footer-brand-side">
                    <span className="footer-logo">AI Marking</span>
                    <span className="footer-copyright">© 2026 AI Marking • Trusted by 15,000+ UK students.</span>
                </div>

                <div className="footer-nav-columns">
                    <div className="footer-column">
                        <span className="footer-label">Product</span>
                        <Link to="/pricing" className="footer-link">Pricing & Plans</Link>
                        <Link to="/features" className="footer-link">Advanced Features</Link>
                        <Link to="/accuracy" className="footer-link">Marking Accuracy</Link>
                    </div>

                    <div className="footer-column">
                        <span className="footer-label">Resources</span>
                        <Link to="/mark-aqa-gcse-maths-past-papers" className="footer-link">AQA Maths Marking</Link>
                        <Link to="/mark-edexcel-gcse-maths-past-papers" className="footer-link">Edexcel Maths Marking</Link>
                        <Link to="/mark-ocr-gcse-maths-past-papers" className="footer-link">OCR Maths Marking</Link>
                        <Link to="/mark-aqa-gcse-english-language-past-papers" className="footer-link">AQA English Marking</Link>
                        <Link to="/mark-edexcel-gcse-english-language-past-papers" className="footer-link">Edexcel English Marking</Link>
                        <Link to="/mark-ocr-gcse-english-language-past-papers" className="footer-link">OCR English Marking</Link>
                    </div>

                    <div className="footer-column">
                        <span className="footer-label">Compare</span>
                        <Link to="/compare/vs-chatgpt" className="footer-link">VS ChatGPT</Link>
                    </div>

                    <div className="footer-column">
                        <span className="footer-label">Company</span>
                        <Link to="/about" className="footer-link">About Us</Link>
                        <a href={getSupportMailto()} className="footer-link">Contact Support</a>
                        <Link to="/terms" className="footer-link">Terms</Link>
                        <Link to="/privacy" className="footer-link">Privacy</Link>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default LandingFooter;
