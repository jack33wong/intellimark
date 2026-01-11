import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './LandingPageHeader.css';

const LandingPageHeader: React.FC = () => {
    const navigate = useNavigate();

    return (
        <header className="landing-page-header">
            <div className="landing-header-container">
                <div className="landing-header-left">
                    <Link to="/" className="landing-header-logo">
                        <img src="/images/logo.png" alt="AI Marking" className="logo-img" />
                        <span className="logo-text">AI Marking</span>
                    </Link>
                </div>

                <nav className="landing-header-center">
                    <Link to="/features" className="nav-link">Features</Link>
                    <Link to="/about" className="nav-link">About</Link>
                    <Link to="/upgrade" state={{ fromLanding: true }} className="nav-link">Pricing</Link>
                </nav>

                <div className="landing-header-right">
                    <Link to="/login" state={{ fromLanding: true }} className="nav-link">Sign in</Link>
                    <Link to="/login" state={{ fromLanding: true, mode: 'signup' }} className="nav-btn-black">Sign up</Link>
                </div>
            </div>
        </header>
    );
};

export default LandingPageHeader;
