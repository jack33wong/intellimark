import React from 'react';
import { Link } from 'react-router-dom';
import './LandingFooter.css';

const LandingFooter: React.FC = () => {
    return (
        <footer className="landing-footer-main">
            <div className="footer-container horizontal">
                <div className="footer-brand-side">
                    <span className="footer-logo">AI Marking</span>
                    <span className="footer-copyright">© 2026 • Join 15,000+ UK students mastering their exam technique.</span>
                </div>

                <div className="footer-nav-columns">
                    <div className="footer-column">
                        <span className="footer-label">Product</span>
                        <Link to="/pricing" state={{ fromLanding: true }} className="footer-link">Pricing</Link>
                        <Link to="/features" className="footer-link">AI Marking</Link>
                    </div>

                    <div className="footer-column">
                        <span className="footer-label">Compare</span>
                        <Link to="/compare/vs-chatgpt" className="footer-link">VS ChatGPT</Link>
                    </div>

                    <div className="footer-column">
                        <span className="footer-label">Company</span>
                        <Link to="/about" className="footer-link">About us</Link>
                        <Link to="/terms" className="footer-link">Terms of service</Link>
                        <Link to="/privacy" className="footer-link">Privacy policy</Link>
                    </div>
                </div>
            </div>
        </footer>
    );
};

export default LandingFooter;
