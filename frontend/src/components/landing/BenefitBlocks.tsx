import React from 'react';
import { Target, Search, MessageCircle } from 'lucide-react';
import './BenefitBlocks.css';

const BenefitBlocks: React.FC = () => {
    const benefits = [
        {
            icon: <Target className="benefit-icon" />,
            header: "Stop Guessing Your Grade",
            text: "Instantly know what you scored on past papers before your teacher even sees them. Get your exact grade in seconds."
        },
        {
            icon: <Search className="benefit-icon" />,
            header: "Learn From Every Mistake",
            text: "Don't just get a score. Our AI highlights exactly which method steps you missed so you never make the same mistake twice."
        },
        {
            icon: <MessageCircle className="benefit-icon" />,
            header: "24/7 Step-by-Step Help",
            text: "Stuck on a 5-mark question? Chat directly with the AI to get a clear, step-by-step walkthrough of the exact mark scheme."
        }
    ];

    return (
        <section className="benefit-blocks-section">
            <div className="benefit-blocks-container">
                {benefits.map((benefit, index) => (
                    <div key={index} className="benefit-card">
                        <div className="benefit-icon-wrapper">
                            {benefit.icon}
                        </div>
                        <h3 className="benefit-header">{benefit.header}</h3>
                        <p className="benefit-text">{benefit.text}</p>
                    </div>
                ))}
            </div>
        </section>
    );
};

export default BenefitBlocks;
