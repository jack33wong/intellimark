import React, { useState, useEffect, useCallback } from 'react';
import './HeroAnimation.css';

// Import images
import step1Img from '../../assets/images/hero-step-1.png';
import step2Img from '../../assets/images/hero-step-2.png';
import step3Img from '../../assets/images/hero-step-3.png';
import step4Img from '../../assets/images/hero-step-4.png';
import redPenImg from '../../assets/images/red_pen_marking.png';

interface AnimationStep {
    headline: string;
    subheadline: string;
    image: string;
}

const STEPS: AnimationStep[] = [
    {
        headline: "1. Spatial Mapping",
        subheadline: "We don't just read math; we map your journey. Every pen stroke is tracked on the X/Y axis.",
        image: step1Img
    },
    {
        headline: "2. Logic Verification",
        subheadline: "Our AI analyzes step-by-step working, not just the final answer, catching exactly where you went wrong.",
        image: step2Img
    },
    {
        headline: "3. Digital Red Pen",
        subheadline: "See examiner-grade feedback annotated directly on your specific equations in real-time.",
        image: redPenImg
    },
    {
        headline: "4. Grade Prediction",
        subheadline: "Instant mark predictions for Edexcel, AQA, and OCR based on official 2026 schemas.",
        image: step4Img
    }
];

const HeroAnimation: React.FC = () => {
    const [currentStep, setCurrentStep] = useState(0);
    const [prevStep, setPrevStep] = useState(-1);

    const nextStep = useCallback(() => {
        setPrevStep(currentStep);
        setCurrentStep((prev) => (prev + 1) % STEPS.length);
    }, [currentStep]);

    useEffect(() => {
        const timer = setInterval(nextStep, 5000);
        return () => clearInterval(timer);
    }, [nextStep]);

    return (
        <div className="hero-animation-container">
            <div className="hero-main-row">
                <div className="hero-text-side">
                    <div className="hero-headlines-wrapper">
                        {STEPS.map((step, index) => (
                            <h2
                                key={index}
                                className={`hero-headline step-${index} ${index === currentStep ? 'active' : ''} ${index === prevStep ? 'exit' : ''}`}
                            >
                                {step.headline}
                            </h2>
                        ))}
                    </div>
                    <p className={`hero-static-description active`}>
                        {STEPS[currentStep].subheadline}
                    </p>
                </div>

                <div className="hero-image-side">
                    {/* Circle background like Google Ads */}
                    <div
                        className={`hero-circle-bg step-${currentStep}`}
                    />

                    <div className="hero-floating-frame">
                        {STEPS.map((step, index) => (
                            <img
                                key={index}
                                src={step.image}
                                alt={step.headline}
                                className={`hero-image ${index === currentStep ? 'active' : ''}`}
                            />
                        ))}
                    </div>
                </div>
            </div>

            <div className="hero-controls">
                {STEPS.map((_, index) => (
                    <button
                        key={index}
                        className={`hero-dot ${index === currentStep ? 'active' : ''}`}
                        onClick={() => {
                            setPrevStep(currentStep);
                            setCurrentStep(index);
                        }}
                        aria-label={`Go to animation step ${index + 1}`}
                    />
                ))}
            </div>
        </div>
    );
};

export default HeroAnimation;
