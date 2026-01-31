import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import SEO from '../components/common/SEO';
import './LegalPage.css';

const PrivacyPage: React.FC = () => {
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    return (
        <div className="legal-page-wrapper light-mode-forced">
            <SEO
                title="Privacy Policy"
                description="Learn how AI Marking collects, uses, and protects your personal information when using our automated marking services."
                canonical="https://aimarking.ai/privacy"
            />
            <div className="legal-container">
                <Link to="/" className="back-home">
                    <ArrowLeft size={18} />
                    Back to Home
                </Link>

                <h1>Privacy Policy</h1>
                <span className="last-updated">Last Updated: January 11, 2026</span>

                <div className="legal-content">
                    <p>At AI Marking, we take your privacy seriously. This Privacy Policy explains how we collect, use, and protect your personal information when you use our automated marking services.</p>

                    <h2>1. Information We Collect</h2>
                    <p>We collect information that you provide directly to us, including:</p>
                    <ul>
                        <li>Account information (name, email address, password).</li>
                        <li>Subscription and billing information.</li>
                        <li>Data uploaded for marking (images of past papers, student work, and handwriting).</li>
                        <li>Communication data when you contact our support team.</li>
                    </ul>

                    <h2>2. How We Use Your Information</h2>
                    <p>We use the collected information for the following purposes:</p>
                    <ul>
                        <li>To provide and maintain our marking services.</li>
                        <li>To process your subscriptions and payments.</li>
                        <li>To improve our AI models and handwriting recognition technology.</li>
                        <li>To communicate with you about service updates and support.</li>
                        <li>To ensure the security and integrity of our platform.</li>
                    </ul>

                    <h2>3. Data Protection</h2>
                    <p>We implement a variety of security measures to maintain the safety of your personal information. Your uploaded papers are processed securely, and we do not sell your personal data to third parties.</p>

                    <h2>4. Cookies</h2>
                    <p>We use cookies to enhance your experience, remember your preferences, and analyze our traffic. You can choose to disable cookies through your browser settings, though some features of the service may not function properly.</p>

                    <h2>5. Third-Party Services</h2>
                    <p>We may use third-party service providers (such as payment processors and cloud hosting) to help us operate our business. These providers have access to your information only to perform specific tasks on our behalf.</p>

                    <h2>6. Your Rights</h2>
                    <p>Depending on your location, you may have rights regarding your personal data, including the right to access, correct, or delete your information. Contact us at support@aimarking.ai for any requests.</p>

                    <h2>7. Changes to This Policy</h2>
                    <p>We may update our Privacy Policy from time to time. We will notify you of any changes by posting the new Privacy Policy on this page and updating the "Last Updated" date.</p>

                    <h2>8. Contact Us</h2>
                    <p>If you have any questions about this Privacy Policy, please contact us at support@aimarking.ai.</p>
                </div>
            </div>
        </div>
    );
};

export default PrivacyPage;
