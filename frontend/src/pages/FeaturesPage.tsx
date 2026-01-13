import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import LandingFooter from '../components/layout/LandingFooter';
import UserSegmentation from '../components/landing/UserSegmentation';
import SEO from '../components/common/SEO';
import './FeaturesPage.css';

const FaqItem: React.FC<{ q: string; a: string }> = ({ q, a }) => {
    const [isOpen, setIsOpen] = React.useState(false);
    return (
        <div className={`faq-item ${isOpen ? 'active' : ''}`}>
            <button className="faq-question" onClick={() => setIsOpen(!isOpen)}>
                {q}
                <span className="faq-icon">+</span>
            </button>
            <div className="faq-answer">
                {a}
            </div>
        </div>
    );
};

const FeaturesPage: React.FC = () => {
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    const features = [
        {
            title: "AI Handwriting Recognition",
            description: "Our advanced neural networks are trained specifically on mathematical notations and messy handwriting. Simply upload a photo of your paper, and let the AI extract every equation and step with precision.",
            image: "/images/features/handwriting_v4.png",
            reversed: false,
            linkText: "Learn about OCR"
        },
        {
            title: "Precision OCR Annotation",
            description: "Empowered by Mathpix, the industry standard for mathematical OCR, our system achieves 100% recognition accuracy. This allows us to map precise digital annotations—including checkmarks, boxes, and examiner comments—directly onto your original handwritten pages with professional precision.",
            image: "/images/features/mathpix_sketch.jpg",
            reversed: true,
            linkText: "See annotation tech"
        },
        {
            title: "Instant Step-by-Step Marking",
            description: "Don't just get a final score. Our platform breaks down where every mark was earned or lost based on official exam board criteria, providing students with immediate, actionable feedback on their method.",
            image: "/images/features/step_marking_v3.png",
            reversed: false,
            linkText: "See marking flow"
        },
        {
            title: "Question Mode: The Full Mark Blueprint",
            description: "Stop guessing what examiners want. Upload any past paper question, and our AI generates a precise model answer perfectly aligned with official AQA, Edexcel, and OCR marking schemes.",
            image: "/images/features/question-mode-demo.png",
            reversed: true,
            linkText: "Try Question Mode"
        },
        {
            title: "Context Chat: Targeted Feedback",
            description: "Don't just see your score—understand it. Our context-aware chat allows you to follow up on every scan. Ask why a specific step was flagged or how to secure that missing Method Mark (M1).",
            image: "/images/features/context-chat-demo.png",
            reversed: false,
            linkText: "Chat with AI"
        },
        {
            title: "Growth & Analytics Dashboard",
            description: "Track performance across different topics and exam boards. Identify weak spots in Algebra or Geometry early, and watch your grade predictions rise as you complete more past papers.",
            image: "/images/features/analytics_sketch_v3.png",
            reversed: true,
            linkText: "Explore analytics"
        }
    ];

    const showcases = [
        {
            id: 'tables',
            label: 'Marking Tables',
            title: 'Automated Table Recognition',
            image: '/images/features/real_table.png'
        },
        {
            id: 'drawings',
            label: 'Marking Drawings',
            title: 'Intelligent Graph Analysis',
            image: '/images/features/real_graph.png'
        },
        {
            id: 'handwriting',
            label: 'Marking Handwritten',
            title: 'Complex Calculation Support',
            image: '/images/features/real_work.png'
        }
    ];

    const [activeShowcase, setActiveShowcase] = React.useState(showcases[0]);

    const faqData = [
        {
            q: "How is this different from other AI tools?",
            a: "Unlike general AI, AI Marking is specifically trained on GCSE/A-Level mathematical marking schemes and messy human handwriting. It doesn't just 'read' text—it understands mathematical steps and extracts marks exactly like an official examiner."
        },
        {
            q: "What exam boards do you support?",
            a: "We currently offer comprehensive support for Edexcel, AQA, and OCR past papers (2022-2024 series). We are constantly expanding our database to include all major international boards."
        },
        {
            q: "Can I use it for other subjects besides Maths?",
            a: "While our core strength is mathematical sciences, we are currently beta testing support for Physics, Chemistry, and Biology where step-by-step marking is critical."
        },
        {
            q: "How accurate is the handwriting recognition?",
            a: "Extremely. Our neural networks are trained on thousands of real student papers, allowing us to accurately interpret messy handwriting, crossed-out work, and complex mathematical notations."
        },
        {
            q: "How long does it take to mark a full paper?",
            a: "Once uploaded, a full 80-mark past paper is processed, marked, and summarized in under 30 seconds."
        }
    ];

    const faqSchema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": faqData.map(item => ({
            "@type": "Question",
            "name": item.q,
            "acceptedAnswer": {
                "@type": "Answer",
                "text": item.a
            }
        }))
    };

    return (
        <div className="features-page-wrapper light-mode-forced">
            <SEO
                title="Advanced Features"
                description="Explore our Spatial AI technology, OCR precision, and automated marking logic built for GCSE and A-Level standards."
                schemaData={faqSchema}
            />
            <LandingPageHeader />

            <section className="features-hero">
                <h1 className="features-h1">Pixel-Perfect AI Marking.</h1>
                <p>
                    Stop guessing your grade. Experience examiner-level precision that maps every coordinate of your handwriting to official board criteria.
                </p>
            </section>

            <main className="features-content">
                {features.map((f, i) => (
                    <div key={i} className={`fp-row ${f.reversed ? 'reversed' : ''}`}>
                        <div className="fp-text">
                            <h2 className="features-h2">{f.title}</h2>
                            <p>{f.description}</p>
                            <Link to="/app" className="feature-pill-btn">
                                {f.linkText} <ArrowRight size={18} />
                            </Link>
                        </div>
                        <div className="fp-image-container">
                            <img src={f.image} alt={f.title} />
                        </div>
                    </div>
                ))}
            </main>

            {/* Comparison Section */}
            <section className="features-comparison">
                <h2 className="features-h1">How AI Marking compares</h2>
                <p className="comparison-subtitle">See how we stack up against traditional marking methods.</p>

                <div className="comparison-card">
                    <table className="comparison-table">
                        <thead>
                            <tr>
                                <th className="feature-col"></th>
                                <th className="traditional-col">Traditional AI tools</th>
                                <th className="ai-col">AI Marking</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td className="feature-col"><span className="comparison-label">Speed</span></td>
                                <td className="traditional-col">Takes 20-30 minutes per paper for full, detailed feedback.</td>
                                <td className="ai-col">Instant step-by-step marking and feedback in seconds.</td>
                            </tr>
                            <tr>
                                <td className="feature-col"><span className="comparison-label">Precision</span></td>
                                <td className="traditional-col">Requires re-marking or manual cross-referencing for messy writing.</td>
                                <td className="ai-col">Neural networks trained on mathematical handwriting and notation.</td>
                            </tr>
                            <tr>
                                <td className="feature-col"><span className="comparison-label">Feedback</span></td>
                                <td className="traditional-col">Generic marks or short comments often lacking context.</td>
                                <td className="ai-col">Actionable hints, explanations of lost marks, and follow-up AI support.</td>
                            </tr>
                            <tr>
                                <td className="feature-col"><span className="comparison-label">Consistency</span></td>
                                <td className="traditional-col">Human markers or basic tools can vary in precision per paper.</td>
                                <td className="ai-col">100% consistent application of official exam board criteria every time.</td>
                            </tr>
                            <tr>
                                <td className="feature-col"><span className="comparison-label">Insights</span></td>
                                <td className="traditional-col">Hard to track specific topic performance across different years.</td>
                                <td className="ai-col">Full dashboard identifies weak spots in Algebra vs Geometry automatically.</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </section>

            {/* Showcase Section */}
            <section className="features-showcase">
                <div className="showcase-header">
                    <h2 className="features-h1">See what AI Marking can create</h2>
                    <p className="showcase-subtitle">Real marking results with precision AI.</p>
                </div>

                <div className="showcase-tabs">
                    {showcases.map((s) => (
                        <button
                            key={s.id}
                            className={`showcase-tab ${activeShowcase.id === s.id ? 'active' : ''}`}
                            onClick={() => setActiveShowcase(s)}
                        >
                            {s.label}
                        </button>
                    ))}
                </div>

                <div className="showcase-display">
                    <div className="showcase-image-wrapper">
                        <img
                            key={activeShowcase.id}
                            src={activeShowcase.image}
                            alt={activeShowcase.title}
                            className="showcase-img fade-in"
                        />
                    </div>
                </div>
            </section>

            <UserSegmentation />

            {/* FAQ Section */}
            <section className="features-faq">
                <h2 className="features-h1">Frequently asked questions about AI Marking</h2>

                <div className="faq-list">
                    {faqData.map((item, index) => (
                        <FaqItem key={index} q={item.q} a={item.a} />
                    ))}
                </div>
            </section>

            <LandingFooter />
        </div>
    );
};

export default FeaturesPage;
