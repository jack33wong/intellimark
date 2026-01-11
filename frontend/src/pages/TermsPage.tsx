import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import './LegalPage.css';

const TermsPage: React.FC = () => {
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    return (
        <div className="legal-page-wrapper light-mode-forced">
            <div className="legal-container">
                <Link to="/" className="back-home">
                    <ArrowLeft size={18} />
                    Back to Home
                </Link>

                <h1>Terms of Service</h1>
                <span className="last-updated">Last Updated: January 11, 2026</span>

                <div className="legal-content">
                    <p>Welcome to AI Marking. By using our website and services, you agree to comply with and be bound by the following terms and conditions.</p>

                    <h2>1. Acceptance of Terms</h2>
                    <p>By accessing or using AI Marking, you agree to be bound by these Terms of Service and all applicable laws and regulations. If you do not agree with any part of these terms, you are prohibited from using this site.</p>

                    <h2>2. Use of Service</h2>
                    <p>Our service is designed to provide automated marking for educational past papers. You agree to use the service only for lawful purposes and in a way that does not infringe the rights of others.</p>

                    <h2>3. User Accounts</h2>
                    <p>To use certain features, you must create an account. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account.</p>

                    <h2>4. Subscriptions and Payments</h2>
                    <ul>
                        <li>Subscription fees are billed in advance on a monthly or yearly basis.</li>
                        <li>All fees are non-refundable except where required by law.</li>
                        <li>You may cancel your subscription at any time through your account settings.</li>
                    </ul>

                    <h2>5. Intellectual Property</h2>
                    <p>All content and technology on AI Marking, including the AI models, software, and design, are the property of AI Marking and are protected by international copyright and trademark laws.</p>

                    <h2>6. User Content</h2>
                    <p>You retain ownership of the papers and data you upload. However, by uploading content, you grant AI Marking a license to process this data to provide and improve our marking services.</p>

                    <h2>7. Limitation of Liability</h2>
                    <p>AI Marking provides its services "as is" without any warranties. We are not liable for any inaccuracies in automated marking or for any damages arising from the use of our service.</p>

                    <h2>8. Termination</h2>
                    <p>We reserve the right to terminate or suspend your account and access to the service at our sole discretion, without notice, for conduct that we believe violates these Terms of Service.</p>

                    <h2>9. Governing Law</h2>
                    <p>These terms are governed by and construed in accordance with the laws of the jurisdiction in which AI Marking operates, without regard to its conflict of law provisions.</p>

                    <h2>10. Contact Information</h2>
                    <p>If you have any questions about these Terms of Service, please contact us at support@aimarking.ai.</p>
                </div>
            </div>
        </div>
    );
};

export default TermsPage;
