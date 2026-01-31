import React from 'react';
import { Helmet } from 'react-helmet-async';

interface SEOProps {
    title?: string;
    description?: string;
    canonical?: string;
    ogType?: string;
    keywords?: string;
    schemaData?: object;
    noIndex?: boolean;
    image?: string;
    themeColor?: string;
}

const SEO: React.FC<SEOProps> = ({
    title,
    description,
    canonical,
    ogType = 'website',
    keywords,
    schemaData,
    noIndex = false,
    image,
    themeColor
}) => {
    const siteTitle = "AI Marking | GCSE Maths Past Paper Grading";
    const fullTitle = title ? `${title} | AI Marking` : siteTitle;
    const defaultDescription = "Instantly mark GCSE Maths past papers with AI. Get accurate grades, step-by-step logic analysis, and personalized feedback.";
    const metaDescription = description || defaultDescription;

    // ENFORCE NON-WWW CANONICAL & UNIQUE PER PAGE
    // If canonical is provided, use it.
    // If NOT provided, use the current window location (strip query params to avoid duplicates).
    let url = canonical;

    if (!url && typeof window !== 'undefined') {
        url = window.location.origin + window.location.pathname;
    }

    url = url || "https://aimarking.ai";

    // Strip 'www.' to enforce non-www domain
    url = url.replace(/https?:\/\/www\.aimarking\.ai/g, 'https://aimarking.ai');

    // ENFORCE NON-WWW IMAGE
    let ogImage = image || "https://aimarking.ai/og-image.png";
    ogImage = ogImage.replace(/https?:\/\/www\.aimarking\.ai/g, 'https://aimarking.ai');

    return (
        <Helmet>
            {/* Basic metadata */}
            <title>{fullTitle}</title>
            <meta name="description" content={metaDescription} />
            {keywords && <meta name="keywords" content={keywords} />}
            <link rel="canonical" href={url} />
            {noIndex && <meta name="robots" content="noindex, nofollow" />}
            {themeColor && <meta name="theme-color" content={themeColor} />}

            {/* Open Graph */}
            <meta property="og:title" content={fullTitle} />
            <meta property="og:description" content={metaDescription} />
            <meta property="og:type" content={ogType} />
            <meta property="og:url" content={url} />
            <meta property="og:image" content={ogImage} />

            {/* Twitter */}
            <meta name="twitter:title" content={fullTitle} />
            <meta name="twitter:description" content={metaDescription} />
            <meta name="twitter:image" content={ogImage} />

            {/* Structured Data */}
            {schemaData && (
                <script type="application/ld+json">
                    {JSON.stringify(schemaData, null, 2)}
                </script>
            )}
        </Helmet>
    );
};

export default SEO;
