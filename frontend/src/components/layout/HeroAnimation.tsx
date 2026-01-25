import React, { useState, useEffect, useCallback } from 'react';
import './HeroAnimation.css';

// Import images
import step1Img from '../../assets/images/spatial_mapping_hero.png';
import step2Img from '../../assets/images/logic_chain_hero.png';
import step3Img from '../../assets/images/red_pen_tick_hero.png';
import step4Img from '../../assets/images/exam_protocol_hero.png';
import redPenImg from '../../assets/images/red_pen_tick_hero.png';

interface AnimationStep {
    headline: string;
    subheadline: string;
    image: string;
}

const STEPS: AnimationStep[] = [
    {
        headline: "1. Handwriting Recognition",
        subheadline: "We see exactly where you wrote your numbers. Even if your handwriting is messy, our AI tracks your full method to award you every mark you deserve.",
        image: step1Img
    },
    {
        headline: "2. Step-by-Step Checking",
        subheadline: "Our AI traces your working out just like a teacher, finding exactly where you made a mistake so you can fix it.",
        image: step2Img
    },
    {
        headline: "3. Examiner-Style Feedback",
        subheadline: "Visual proof. See 'Red Pen' annotations appear directly on your own handwritten equations with 99.2% accuracy.",
        image: redPenImg
    },
    {
        headline: "4. Official Grade Boundaries",
        subheadline: "Get an instant, reliable grade based on the latest 2026 marking standards for Edexcel, AQA, and OCR.",
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
