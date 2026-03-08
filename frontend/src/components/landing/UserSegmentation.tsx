import React from 'react';
import './UserSegmentation.css';

import { Timer } from 'lucide-react';

const UserSegmentation: React.FC = () => {
    return (
        <section className="segmentation-section">
            <div className="segmentation-container">
                <div className="badge-container center">
                    <span className="performance-badge">Personalized Impact</span>
                </div>
                <h2 className="segmentation-title center">Built for your specific goals</h2>

                <div className="segmentation-grid">
                    <div className="segmentation-card student-card">
                        <div className="segment-icon">
                            <img src="/images/features/segment_student_v2.png" alt="Student Icon" />
                        </div>
                        <h3>For Students</h3>
                        <p className="segment-outcome">"See the 'Red Pen' on your own work. Learn exactly why you missed that Grade 7 boundary."</p>
                        <ul className="segment-features">
                            <li>Instant mark schemes</li>
                            <li>Get marks for your working out</li>
                            <li>24/7 self-study support</li>
                        </ul>
                    </div>

                    <div className="segmentation-card exam-card">
                        <div className="segment-icon">
                            <img src="/images/features/segment_revision_v1.png" alt="Revision Icon" />
                        </div>
                        <h3>For Mock Exams & Revision</h3>
                        <p className="segment-outcome">"Stop stressing the night before a test. Get instant feedback on your late-night past papers so you walk into the exam hall with total confidence."</p>
                        <ul className="segment-features">
                            <li>No waiting for teachers to mark</li>
                            <li>Unlimited late-night practice</li>
                            <li>Instant peace of mind</li>
                        </ul>
                    </div>

                    <div className="segmentation-card parent-card">
                        <div className="segment-icon">
                            <img src="/images/features/segment_parent_v2.png" alt="Parent Icon" />
                        </div>
                        <h3>For Parents</h3>
                        <p className="segment-outcome">"Give your child 24/7 access to an examiner-grade marking assistant at 1% of the cost of a private tutor."</p>
                        <ul className="segment-features">
                            <li>Verified senior examiner rigor</li>
                            <li>Affordable excellence</li>
                            <li>Step-by-step progress tracking</li>
                        </ul>
                    </div>
                </div>
            </div>
        </section>
    );
};

export default UserSegmentation;
