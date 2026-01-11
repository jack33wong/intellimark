import React from 'react';
import { Star } from 'lucide-react';
import './Testimonials.css';

const Testimonials: React.FC = () => {
    const testimonials = [
        {
            quote: "AI Marking has completely transformed how I review student past papers. The speed and accuracy are unmatched.",
            author: "Former AQA Senior Examiner",
            name: "Verified User"
        },
        {
            quote: "The handwriting recognition for complex equations is surprisingly robust. It saves me hours every week.",
            author: "Maths Department Head",
            name: "Verified User"
        },
        {
            quote: "I highly recommend this for Maths GCSE marking to boost marking time and accuracy. It's been instrumental in my progress.",
            author: "Wembley Sixth Form",
            name: "Grade 9 Maths Student"
        }
    ];

    return (
        <section className="testimonials-section">
            <div className="testimonials-container">
                <div className="badge-container">
                    <span className="performance-badge">EEAT Certified</span>
                </div>
                <h2 className="section-title">Trusted by Examiners & Educators</h2>

                <div className="testimonials-grid">
                    {testimonials.map((t, i) => (
                        <div key={i} className="testimonial-card">
                            <div className="stars">
                                {[...Array(5)].map((_, i) => <Star key={i} size={16} fill="var(--text-brand)" color="var(--text-brand)" />)}
                            </div>
                            <p className="testimonial-quote">"{t.quote}"</p>
                            <div className="testimonial-meta">
                                <span className="author-name">{t.name}</span>
                                <span className="author-role">{t.author}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
};

export default Testimonials;
