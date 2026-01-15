import React from 'react';
import { Helmet } from 'react-helmet-async';

interface SeoHeaderProps {
    title?: string;
    description?: string;
    examBoard?: string;
    year?: string;
    isHome?: boolean;
    canonicalUrl?: string; // NEW
    ogTitle?: string;      // NEW
    ogDescription?: string;// NEW
    ogUrl?: string;        // NEW
}

export const SeoHeader: React.FC<SeoHeaderProps> = ({
    title,
    description,
    examBoard,
    year,
    isHome = false,
    canonicalUrl,
    ogTitle,
    ogDescription,
    ogUrl
}) => {
    // Generate optimized title
    const finalTitle = title || (examBoard
        ? `AI ${examBoard} Maths Marking | Instant GCSE ${year || ''} Feedback`
        : isHome
            ? "AI GCSE Maths Marking & Feedback | Instant Past Paper Grading"
            : "AI Maths Marking | Instant GCSE Past Paper Feedback & Grading");

    // Generate optimized description
    const finalDescription = description || (examBoard
        ? `Upload your ${examBoard} ${year || ''} Maths past papers and get instant, AI-powered marking with step-by-step feedback.`
        : "Upload GCSE Maths past papers and get instant, AI-powered marking with step-by-step feedback. Supporting Edexcel, AQA, and OCR.");

    const keywords = "AI math marking, GCSE maths, mark my paper, Edexcel marking, AQA maths feedback, OCR maths marking, AI tutor";

    // SoftwareApplication Schema
    const schema = {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        "name": "AI Marking",
        "operatingSystem": "Web",
        "applicationCategory": "EducationApplication",
        "offers": {
            "@type": "Offer",
            "price": "0",
            "priceCurrency": "GBP"
        },
        "description": "AI tool for marking GCSE mathematics past papers with instant, human-level feedback."
    };

    return (
        <Helmet>
            <title>{finalTitle}</title>
            <meta name="description" content={finalDescription} />
            <meta name="keywords" content={keywords} />

            {canonicalUrl && <link rel="canonical" href={canonicalUrl} data-rh="true" />}

            {/* Open Graph / Facebook */}
            <meta property="og:type" content="website" />
            <meta property="og:title" content={ogTitle || finalTitle} />
            <meta property="og:description" content={ogDescription || finalDescription} />
            {ogUrl && <meta property="og:url" content={ogUrl} />}

            {/* Twitter */}
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="twitter:title" content={ogTitle || finalTitle} />
            <meta name="twitter:description" content={ogDescription || finalDescription} />

            {/* JSON-LD SoftwareApplication Schema */}
            <script type="application/ld+json">
                {JSON.stringify(schema)}
            </script>

            {/* NEW: HowTo Schema for Step-by-Step Snippets */}
            {isHome && (
                <script type="application/ld+json">
                    {JSON.stringify({
                        "@context": "https://schema.org",
                        "@type": "HowTo",
                        "name": "How to mark your GCSE Maths paper using AI",
                        "step": [
                            {
                                "@type": "HowToStep",
                                "name": "Upload Work",
                                "text": "Upload a photo or PDF of your completed GCSE Maths past paper."
                            },
                            {
                                "@type": "HowToStep",
                                "name": "AI Analysis",
                                "text": "Our AI analyzes your handwriting and compares it to the official mark scheme."
                            },
                            {
                                "@type": "HowToStep",
                                "name": "Get Results",
                                "text": "Receive an instant grade and detailed feedback on every question."
                            }
                        ]
                    })}
                </script>
            )}
        </Helmet>
    );
};

export default SeoHeader;
