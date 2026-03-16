import React, { useRef, useEffect } from 'react';
import './HeroAnimation.css';

const HeroAnimation: React.FC = () => {
    const videoRef = useRef<HTMLVideoElement>(null);

    useEffect(() => {
        // Ensure video starts playing if it hasn't already
        if (videoRef.current) {
            videoRef.current.play().catch(err => {
                console.log("Autoplay prevented or failed:", err);
            });
        }
    }, []);

    return (
        <div className="hero-animation-container static-scanner-showcase">
            <div className="hero-main-row">
                <div className="hero-text-side">
                    <h2 className="hero-headline static-headline">
                        Built-In Scanner for Messy Handwriting
                    </h2>
                    <p className="hero-static-description active">
                        Don't waste time taking 20 separate photos. Use our fast batch-scanner to upload your whole mock paper at once. Our AI perfectly reads messy pencil marks, crossed-out working, and complex fractions to find your method marks.
                    </p>
                </div>

                <div className="hero-image-side">
                    {/* Circle background - Tan/Cream accent */}
                    <div className="hero-circle-bg scanner-bg" />

                    <div className="hero-floating-frame smartphone-mockup">
                        <video
                            ref={videoRef}
                            src="/video/mobilescan3.mp4"
                            className="scanner-video"
                            autoPlay
                            muted
                            loop
                            playsInline
                            poster="/assets/images/red_pen_tick_hero.png"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default HeroAnimation;
