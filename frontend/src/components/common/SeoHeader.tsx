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
    // Enforce non-www for SEO parameters
    const cleanCanonicalUrl = canonicalUrl ? canonicalUrl.replace(/https?:\/\/www\.aimarking\.ai/g, 'https://aimarking.ai') : undefined;
    const cleanOgUrl = ogUrl ? ogUrl.replace(/https?:\/\/www\.aimarking\.ai/g, 'https://aimarking.ai') : undefined;

    // Generate optimized title
    const finalTitle = title || (examBoard
        ? `AI ${examBoard} Maths Marking | Instant GCSE ${year || ''} Feedback`
        : isHome
            ? "AI Exam Paper Marking & Feedback | GCSE & A-Level Maths, English & Any Subject"
            : "AI Exam Marking | Instant Past Paper Feedback & Grading");

    // Generate optimized description
    const finalDescription = description || (examBoard
        ? `Upload your ${examBoard} ${year || ''} Maths past papers and get instant, AI-powered marking with step-by-step feedback.`
        : "Mark GCSE & A-Level Maths and GCSE English Language past papers instantly with built-in AQA, Edexcel & OCR schemes—or upload any subject with its mark scheme.");

    const keywords = "AI exam marking, GCSE maths marking, GCSE English Language marking, mark my paper, Edexcel marking, AQA feedback, OCR marking, upload mark scheme, AI tutor";

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
        "description": "AI tool for marking GCSE & A-Level Maths, GCSE English Language, and any subject past papers with an uploaded mark scheme."
    };

    return (
        <Helmet>
            <title>{finalTitle}</title>
            <meta name="description" content={finalDescription} />
            <meta name="keywords" content={keywords} />

            {cleanCanonicalUrl && <link rel="canonical" href={cleanCanonicalUrl} data-rh="true" />}

            {/* Open Graph / Facebook */}
            <meta property="og:type" content="website" />
            <meta property="og:title" content={ogTitle || finalTitle} />
            <meta property="og:description" content={ogDescription || finalDescription} />
            {cleanOgUrl && <meta property="og:url" content={cleanOgUrl} />}

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
                        "name": "How to mark your exam past paper using AI",
                        "step": [
                            {
                                "@type": "HowToStep",
                                "name": "Upload Work",
                                "text": "Upload a photo or PDF of your completed Maths, English Language, or any subject past paper (with its mark scheme)."
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
