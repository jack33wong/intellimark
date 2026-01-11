import React from 'react';
import { useNavigate } from 'react-router-dom';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import HeroAnimation from '../components/layout/HeroAnimation';
import TrustSignals from '../components/common/TrustSignals';
import Testimonials from '../components/landing/Testimonials';
import SupportedPapers from '../components/landing/SupportedPapers';
import LandingFooter from '../components/layout/LandingFooter';
import SeoHeader from '../components/common/SeoHeader';
import './LandingPage.css';

const LandingPage: React.FC = () => {

    return (
        <div className="light-mode-forced">
            <SeoHeader isHome={true} />
            <LandingPageHeader />

            <section className="landing-section landing-section-hero">
                <div className="landing-intro-image-container">
                    <HeroAnimation />
                </div>
            </section>

            <TrustSignals />
            <Testimonials />
            <SupportedPapers />
            <LandingFooter />
        </div>
    );
};

export default LandingPage;
