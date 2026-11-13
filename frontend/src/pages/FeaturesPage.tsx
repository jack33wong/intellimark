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
            description: "Don't worry about scribbles or crossed-out working. Just snap a photo, and our AI accurately reads messy mathematical equations, multi-page handwritten essays, and any subject paper.",
            image: "/images/features/handwriting_v4.png",
            reversed: false,
            linkText: "Try Handwriting Scan"
        },
        {
            title: "The Digital Red Pen",
            description: "See exactly where you went wrong. Our AI draws checkmarks, crosses, margin badges, and helpful examiner notes directly onto your original photo, just like a real teacher.",
            image: "/images/features/mathpix_sketch.jpg",
            reversed: true,
            linkText: "See marking example"
        },
        {
            title: "Instant Step-by-Step & LoR Marking",
            description: "Don't just get a final score. Our platform breaks down every method mark in Maths, Levels of Response (LoR) bands in English Language, or custom mark scheme criteria for any subject you upload.",
            image: "/images/features/step_marking_v3.png",
            reversed: false,
            linkText: "See marking flow"
        },
        {
            title: "Question Mode: The Full Mark Blueprint",
            description: "Stop guessing what examiners want. Upload any past paper question, and our AI generates a precise model answer aligned with official AQA, Edexcel, and OCR schemes—or your own uploaded mark scheme.",
            image: "/images/features/question-mode-demo.png",
            reversed: true,
            linkText: "Try Question Mode"
        },
        {
            title: "Your 24/7 AI Tutor",
            description: "Don't understand why you dropped a mark or stayed in Level 3? Chat directly with the AI to get a simple, personalized explanation so you never make the same mistake twice.",
            image: "/images/features/context-chat-demo.png",
            reversed: false,
            linkText: "Chat with AI"
        },
        {
            title: "Growth & Analytics Dashboard",
            description: "Track performance across subjects, topics, and exam boards. Identify weak spots in Algebra, Geometry, or English Assessment Objectives (AO1–AO6) early, and watch your grade predictions rise.",
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
        },
        {
            id: 'essays',
            label: 'Marking Essays',
            title: 'English Language LoR Grading',
            image: '/images/english_spatial_marking_q2.jpg'
        }
    ];

    const [activeShowcase, setActiveShowcase] = React.useState(showcases[0]);

    const faqData = [
        {
            q: "How is this different from other AI tools?",
            a: "Unlike general AI, AI Marking is specifically built for GCSE & A-Level Maths, GCSE English Language, and official mark-scheme grading. It understands mathematical method steps, multi-page Levels of Response (LoR) essay rubrics, and any custom mark scheme you upload."
        },
        {
            q: "What exam boards do you support?",
            a: "We offer built-in support for Edexcel, AQA, and OCR past papers (2020–2025 series) across GCSE & A-Level Maths and GCSE English Language—plus you can upload papers from any exam board together with their mark scheme."
        },
        {
            q: "Can I use it for other subjects besides Maths and Eng Lang?",
            a: "Yes! Alongside our 2,500+ built-in Maths and English Language mark schemes, you can upload any subject's past paper (such as Sciences, Humanities, or Languages) together with its mark scheme—and mark scheme pages never count toward your page limit."
        },
        {
            q: "How accurate is the handwriting recognition?",
            a: "Extremely. Our neural networks are trained on thousands of real student papers, allowing us to accurately interpret messy handwriting, crossed-out work, multi-page essays, and complex mathematical notations."
        },
        {
            q: "How long does it take to mark a full paper?",
            a: "Once uploaded, a full past paper is processed, marked, and summarized in under 30 seconds."
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
                description="Explore our Spatial AI and Levels of Response (LoR) marking built for GCSE & A-Level Maths, GCSE English Language, and any subject uploaded with its mark scheme."
                schemaData={faqSchema}
            />
            <LandingPageHeader />

            <section className="features-hero">
                <h1 className="features-h1">Pixel-Perfect AI Marking.</h1>
                <p>
                    Stop guessing your grade. Get Maths, English Language, and any subject paper with its mark scheme graded instantly with examiner-level accuracy.
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
                                <td className="ai-col">Accurately reads messy handwriting, multi-page essays, and complex math symbols.</td>
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
                                <td className="ai-col">Full dashboard identifies weak spots across Maths topics, English AOs, and past papers automatically.</td>
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
