import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import './LandingPageHeader.css';

const LandingPageHeader: React.FC = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const isPricingPage = location.pathname === '/pricing';
    const [isMenuOpen, setIsMenuOpen] = useState(false);

    const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

    return (
        <header className={`landing-page-header ${isMenuOpen ? 'menu-open' : ''}`}>
            <div className="landing-header-container">
                <div className="landing-header-left">
                    <Link to="/" className="landing-header-logo">
                        <img src="/images/logo.png" alt="AI Marking" className="logo-img" />
                        <span className="logo-text">AI Marking</span>
                    </Link>
                </div>

                <nav className={`landing-header-center ${isMenuOpen ? 'show' : ''}`}>
                    <Link to="/features" className="nav-link" onClick={() => setIsMenuOpen(false)}>Features</Link>
                    {!isPricingPage && (
                        <div className="nav-item-dropdown">
                            <button className="dropdown-trigger">
                                Exam Boards
                                <svg className="chevron" width="12" height="12" viewBox="0 0 12 12"><path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="2" fill="none" /></svg>
                            </button>
                            <div className="dropdown-menu">
                                <Link to="/mark-aqa-gcse-maths-past-papers" onClick={() => setIsMenuOpen(false)}>AQA Maths Marking</Link>
                                <Link to="/mark-edexcel-gcse-maths-past-papers" onClick={() => setIsMenuOpen(false)}>Edexcel Maths Marking</Link>
                                <Link to="/mark-ocr-gcse-maths-past-papers" onClick={() => setIsMenuOpen(false)}>OCR Maths Marking</Link>
                            </div>
                        </div>
                    )}
                    <Link to="/about" className="nav-link" onClick={() => setIsMenuOpen(false)}>About</Link>
                    <Link to="/pricing" state={{ fromLanding: true }} className="nav-link" onClick={() => setIsMenuOpen(false)}>Pricing</Link>

                    <div className="mobile-only-actions">
                        <Link to="/login" state={{ fromLanding: true }} className="nav-link" onClick={() => setIsMenuOpen(false)}>Sign in</Link>
                        <Link to="/login" state={{ fromLanding: true, mode: 'signup' }} className="nav-btn-black" onClick={() => setIsMenuOpen(false)}>Sign up</Link>
                    </div>
                </nav>

                <div className="landing-header-right">
                    <Link to="/login" state={{ fromLanding: true }} className="nav-link">Sign in</Link>
                    <Link to="/login" state={{ fromLanding: true, mode: 'signup' }} className="nav-btn-black">Sign up</Link>

                    <button className="mobile-menu-toggle" onClick={toggleMenu} aria-label="Toggle Menu">
                        <div className="hamburger-icon">
                            <span></span>
                            <span></span>
                            <span></span>
                        </div>
                    </button>
                </div>
            </div>
        </header>
    );
};

export default LandingPageHeader;
