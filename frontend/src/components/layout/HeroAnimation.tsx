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
        headline: "1. Spatial Precision",
        subheadline: "0.1mm accuracy. We map every ink stroke to its exact X/Y coordinate for flawlessly precise marking.",
        image: step1Img
    },
    {
        headline: "2. Logic Chain Analysis",
        subheadline: "Our AI traces your multi-step logic chain in real-time, identifying the exact point of error.",
        image: step2Img
    },
    {
        headline: "3. The 'Red Pen' Edge",
        subheadline: "Visual proof. See examiner annotations appear directly on your specific handwritten equations.",
        image: redPenImg
    },
    {
        headline: "4. Official Protocol",
        subheadline: "Marks awarded based on 2026 Exam Board schemas for Edexcel, AQA, and OCR.",
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
