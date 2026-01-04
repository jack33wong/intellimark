import React from 'react';
import { Helmet } from 'react-helmet-async';

interface SEOProps {
    title?: string;
    description?: string;
    canonical?: string;
    ogType?: string;
    keywords?: string;
    schemaData?: object;
}

const SEO: React.FC<SEOProps> = ({
    title,
    description,
    canonical,
    ogType = 'website',
    keywords,
    schemaData
}) => {
    const siteTitle = "AI Marking | GCSE Maths Past Paper Grading";
    const fullTitle = title ? `${title} | AI Marking` : siteTitle;
    const defaultDescription = "Instantly mark GCSE Maths past papers with AI. Get accurate grades, step-by-step logic analysis, and personalized feedback.";
    const metaDescription = description || defaultDescription;
    const url = canonical || "https://aimarking.ai";

    return (
        <Helmet>
            {/* Basic metadata */}
            <title>{fullTitle}</title>
            <meta name="description" content={metaDescription} />
            {keywords && <meta name="keywords" content={keywords} />}
            <link rel="canonical" href={url} />

            {/* Open Graph */}
            <meta property="og:title" content={fullTitle} />
            <meta property="og:description" content={metaDescription} />
            <meta property="og:type" content={ogType} />
            <meta property="og:url" content={url} />

            {/* Twitter */}
            <meta name="twitter:title" content={fullTitle} />
            <meta name="twitter:description" content={metaDescription} />

            {/* Structured Data */}
            {schemaData && (
                <script type="application/ld+json">
                    {JSON.stringify(schemaData)}
                </script>
            )}
        </Helmet>
    );
};

export default SEO;
