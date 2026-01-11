import React from 'react';
import './UserSegmentation.css';

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
                            <img src="/images/features/segment_student.png" alt="Student Icon" />
                        </div>
                        <h3>For Students</h3>
                        <p className="segment-outcome">"See the 'Red Pen' on your own work. Learn exactly why you missed that Grade 7 boundary."</p>
                        <ul className="segment-features">
                            <li>Instant mark schemes</li>
                            <li>ECF logic detection</li>
                            <li>24/7 self-study support</li>
                        </ul>
                    </div>

                    <div className="segmentation-card tutor-card">
                        <div className="segment-icon">
                            <img src="/images/features/segment_tutor.png" alt="Tutor Icon" />
                        </div>
                        <h3>For Tutors</h3>
                        <p className="segment-outcome">"Mark an entire mock series in seconds. Spend your sessions teaching, not grading."</p>
                        <ul className="segment-features">
                            <li>Automated class cohorts</li>
                            <li>Deep performance analytics</li>
                            <li>Professional feedback reports</li>
                        </ul>
                    </div>

                    <div className="segmentation-card parent-card">
                        <div className="segment-icon">
                            <img src="/images/features/segment_parent.png" alt="Parent Icon" />
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
