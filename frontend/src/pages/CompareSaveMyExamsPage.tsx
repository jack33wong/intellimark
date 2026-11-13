import React, { useEffect } from 'react';
import LandingPageHeader from '../components/layout/LandingPageHeader';
import LandingFooter from '../components/layout/LandingFooter';
import { Check, ArrowRight, BookOpen, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import SEO from '../components/common/SEO';
import './CompareChatGPTPage.css';

const CompareSaveMyExamsPage: React.FC = () => {
    useEffect(() => {
        window.scrollTo(0, 0);
    }, []);

    const faqSchema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": "What is the difference between Save My Exams and AI Marking?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Save My Exams is built for learning the syllabus with revision notes, summary videos, and downloadable past paper PDFs. AI Marking (aimarking.ai) is the missing second half of your workflow: it grades your completed handwritten past papers, graphs, and 40-page exam booklets against official AQA, Edexcel, and OCR mark schemes in about 60 seconds."
                }
            },
            {
                "@type": "Question",
                "name": "Can Save My Exams mark my handwritten past paper PDFs?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "No. Save My Exams only checks typed short answers inside its own online quizzes, while its past paper PDFs are download-only for you to mark yourself. AI Marking reads smartphone photos or scanned PDFs of your handwritten working out and awards M1, A1, and B1 method and follow-through marks directly on your page."
                }
            },
            {
                "@type": "Question",
                "name": "Does AI Marking use official exam-board mark schemes?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Yes. Unlike generic AI chatbots, AI Marking is strictly locked to official AQA, Pearson Edexcel, and OCR mark schemes, official examiner guidance notes, and Chief Examiner Reports—and you can also attach any official mark scheme PDF for free."
                }
            },
            {
                "@type": "Question",
                "name": "How do I mark a past paper downloaded from Save My Exams?",
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": "Download and complete your past paper on paper or an iPad as usual, then upload your completed PDF or smartphone photos to AI Marking. For Maths and English Language, official mark schemes are built in; for Sciences and Humanities, simply attach the mark scheme PDF alongside your paper for free."
                }
            }
        ]
    };

    return (
        <div className="compare-page-wrapper light-mode-forced">
            <SEO
                title="Save My Exams vs AI Marking: Revision Notes vs Real Past Paper Grading"
                description="Save My Exams gives you revision notes and past paper PDFs. AI Marking grades your actual handwritten working out, graphs, and full 40-page exam booklets against official mark schemes."
                schemaData={faqSchema}
            />
            <LandingPageHeader />

            <main className="compare-container">
                <section className="compare-hero">
                    <h1 className="features-h1">Save My Exams vs. AI Marking: Revision Notes vs. Real Past Paper Grading</h1>
                    <p>
                        Save My Exams is brilliant for learning the syllabus and downloading past papers. AI Marking is built to grade your actual handwritten working out, graphs, and full 40-page exam booklets.
                    </p>
                    <div className="compare-hero-visual-wrapper" style={{ marginTop: '48px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '28px' }}>
                        <div
                            style={{
                                display: 'flex',
                                flexWrap: 'wrap',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '24px',
                                padding: '32px 40px',
                                background: '#ffffff',
                                borderRadius: '24px',
                                border: '1px solid #eeeeed',
                                boxShadow: '0 20px 60px rgba(0, 0, 0, 0.06)',
                                maxWidth: '760px',
                                width: '100%'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div
                                    style={{
                                        width: '44px',
                                        height: '44px',
                                        borderRadius: '12px',
                                        background: '#f3f3f1',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        color: '#1a1a19'
                                    }}
                                >
                                    <BookOpen size={22} />
                                </div>
                                <div style={{ textAlign: 'left' }}>
                                    <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#1a1a19' }}>Save My Exams</div>
                                    <div style={{ fontSize: '0.85rem', color: '#8c8c87' }}>Revision Notes &amp; Blank PDFs</div>
                                </div>
                            </div>

                            <span
                                style={{
                                    fontSize: '0.9rem',
                                    fontWeight: 600,
                                    color: '#8c8c87',
                                    padding: '6px 14px',
                                    borderRadius: '999px',
                                    background: '#fafafa',
                                    border: '1px solid #eeeeed'
                                }}
                            >
                                vs
                            </span>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <img
                                    src="/images/logo.png"
                                    alt="AI Marking logo"
                                    style={{ width: '44px', height: '44px', borderRadius: '12px', objectFit: 'contain' }}
                                />
                                <div style={{ textAlign: 'left' }}>
                                    <div style={{ fontWeight: 700, fontSize: '1.1rem', color: '#1a1a19' }}>AI Marking</div>
                                    <div style={{ fontSize: '0.85rem', color: '#5e5e5b' }}>Handwritten Past Paper Grading</div>
                                </div>
                            </div>
                        </div>

                        <Link to="/app" className="feature-pill-btn">
                            Grade a past paper for free <ArrowRight size={18} style={{ marginLeft: '8px' }} />
                        </Link>
                    </div>
                </section>

                <section className="compare-features">
                    <div className="compare-feature-row">
                        <div className="compare-feature-text">
                            <h2 className="features-h2">Real exams aren&apos;t typed into a text box. They&apos;re handwritten on paper.</h2>
                            <p>
                                Online revision platforms only check typed short answers on their own proprietary quizzes—and once you download a 40-page past paper PDF, grading it yourself against a raw mark scheme takes 45 minutes. Real GCSE Maths and Science exams require multi-step equations, chemical formulas, and plotted graphs on paper. AI Marking reads your actual smartphone photos or scanned 40-page PDF booklets and places M1, A1, and B1 ticks directly on your handwriting.
                            </p>
                        </div>
                        <div
                            className="compare-feature-visual"
                            style={{ position: 'relative', overflow: 'hidden', borderRadius: '20px', backgroundColor: '#fcfcfc' }}
                        >
                            <img
                                src="/images/compare/science_graph_b1_marking.jpg"
                                alt="AI Marking grading a scanned GCSE Chemistry bar chart with B1 ticks directly on handwritten labels"
                                style={{
                                    width: '100%',
                                    height: '100%',
                                    objectFit: 'cover',
                                    objectPosition: 'center 52%',
                                    transform: 'scale(1.06)',
                                    backgroundColor: '#fcfcfc',
                                    padding: '8px'
                                }}
                            />
                            <div
                                style={{
                                    position: 'absolute',
                                    bottom: '16px',
                                    right: '16px',
                                    background: 'rgba(255, 255, 255, 0.96)',
                                    border: '1px solid #d1fae5',
                                    borderRadius: '12px',
                                    padding: '8px 12px',
                                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.08)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    fontSize: '0.8rem',
                                    fontWeight: 600,
                                    color: '#065f46'
                                }}
                            >
                                <CheckCircle2 size={16} color="#10b981" />
                                <span>B1 × 3 — Plotted bars, y-axis scale &amp; labels verified</span>
                            </div>
                        </div>
                    </div>

                    <div className="compare-feature-row reversed">
                        <div className="compare-feature-text">
                            <h2 className="features-h2">Official Exam-Board Mark Schemes, Not Generic AI</h2>
                            <p>
                                Unlike generic chatbots that guess answers or miss method marks, AI Marking is strictly locked to official AQA, Pearson Edexcel, and OCR mark schemes, official examiner guidance notes, and Chief Examiner Reports. Plus, you can attach any official mark scheme PDF for free—so even if your final answer is off, your working out still earns every M1 follow-through mark it deserves.
                            </p>
                        </div>
                        <div
                            className="compare-feature-visual"
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '24px',
                                backgroundColor: '#f8fafc',
                                borderRadius: '20px'
                            }}
                        >
                            <div
                                style={{
                                    width: '100%',
                                    background: '#ffffff',
                                    borderRadius: '16px',
                                    border: '1px solid #e2e8f0',
                                    boxShadow: '0 12px 32px rgba(15, 23, 42, 0.06)',
                                    padding: '20px'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px', flexWrap: 'wrap', gap: '8px' }}>
                                    <div>
                                        <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#0f172a' }}>
                                            Examiner Benchmark Results
                                        </div>
                                        <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                                            Academic Year 2025–2026 · Official Past Papers
                                        </div>
                                    </div>
                                    <span
                                        style={{
                                            fontSize: '0.72rem',
                                            fontWeight: 600,
                                            color: '#059669',
                                            background: '#ecfdf5',
                                            border: '1px solid #a7f3d0',
                                            padding: '4px 10px',
                                            borderRadius: '999px'
                                        }}
                                    >
                                        Deterministic Engine
                                    </span>
                                </div>

                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', textAlign: 'left' }}>
                                    <thead>
                                    <tr style={{ borderBottom: '1px solid #e2e8f0', color: '#64748b' }}>
                                        <th style={{ padding: '8px 6px' }}>Exam Board</th>
                                        <th style={{ padding: '8px 6px' }}>Subject</th>
                                        <th style={{ padding: '8px 6px' }}>Alignment</th>
                                        <th style={{ padding: '8px 6px' }}>Status</th>
                                    </tr>
                                    </thead>
                                    <tbody>
                                    {[
                                        { board: 'Pearson Edexcel', subject: 'GCSE Mathematics (1MA1)', acc: '99.4%', status: 'Validated' },
                                        { board: 'AQA', subject: 'GCSE Biology (8461/1H)', acc: '99.1%', status: 'Validated' },
                                        { board: 'AQA', subject: 'Combined Science (8464)', acc: '99.0%', status: 'Validated' },
                                        { board: 'AQA / Edexcel', subject: 'GCSE English Language', acc: '98.8%', status: 'Validated' }
                                    ].map((row, idx) => (
                                        <tr key={idx} style={{ borderBottom: idx < 3 ? '1px solid #f1f5f9' : 'none', color: '#1e293b' }}>
                                            <td style={{ padding: '10px 6px', fontWeight: 600 }}>{row.board}</td>
                                            <td style={{ padding: '10px 6px' }}>{row.subject}</td>
                                            <td style={{ padding: '10px 6px', fontWeight: 700, color: '#0f172a' }}>{row.acc}</td>
                                            <td style={{ padding: '10px 6px' }}>
                                                    <span
                                                        style={{
                                                            display: 'inline-block',
                                                            fontSize: '0.72rem',
                                                            fontWeight: 600,
                                                            color: '#047857',
                                                            background: '#d1fae5',
                                                            padding: '2px 8px',
                                                            borderRadius: '6px'
                                                        }}
                                                    >
                                                        {row.status}
                                                    </span>
                                            </td>
                                        </tr>
                                    ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                </section>

                <section className="compare-table-section">
                    <h2 className="features-h1">The Comparison</h2>
                    <div className="compare-table-card">
                        <table className="compare-table">
                            <thead>
                            <tr>
                                <th>Feature</th>
                                <th>Save My Exams</th>
                                <th>AI Marking (aimarking.ai)</th>
                            </tr>
                            </thead>
                            <tbody>
                            <tr>
                                <td>Primary Strength</td>
                                <td className="cross-col">Revision notes &amp; topic questions</td>
                                <td className="check-col">Full handwritten past paper marking</td>
                            </tr>
                            <tr>
                                <td>Full 40-Page Past Paper PDFs</td>
                                <td className="cross-col">Download only (you mark it yourself)</td>
                                <td className="check-col">Automated grading in ~60 seconds</td>
                            </tr>
                            <tr>
                                <td>Handwritten Maths &amp; Working Out</td>
                                <td className="cross-col">Not supported (typed text boxes only)</td>
                                <td className="check-col">Reads messy handwriting, crossed-out work &amp; diagrams</td>
                            </tr>
                            <tr>
                                <td>Method &amp; Follow-Through Marks</td>
                                <td className="cross-col">Basic keyword matching on quiz questions</td>
                                <td className="check-col">Full M1/A1/B1 step-by-step &amp; error-carried-forward logic</td>
                            </tr>
                            <tr>
                                <td>On-Page Visual Red-Pen Annotations</td>
                                <td className="cross-col">None</td>
                                <td className="check-col">Exact line-by-line ticks, crosses &amp; mark codes on your page</td>
                            </tr>
                            </tbody>
                        </table>
                    </div>
                </section>

                <section className="use-case-section">
                    <div className="use-case-card chatgpt">
                        <h3 className="features-h3">Use Save My Exams for</h3>
                        <ul>
                            <li><Check size={20} /> Reading topic-by-topic revision notes</li>
                            <li><Check size={20} /> Watching syllabus summary videos</li>
                            <li><Check size={20} /> Downloading blank past paper PDFs and mark schemes</li>
                        </ul>
                    </div>
                    <div className="use-case-card aimarking">
                        <h3 className="features-h3">Use AI Marking for</h3>
                        <ul>
                            <li><Check size={20} /> Grading your completed handwritten past papers &amp; mock exams</li>
                            <li><Check size={20} /> Getting M1/A1/B1 method marks on multi-step calculations</li>
                            <li><Check size={20} /> Grading any Science or Humanities paper by attaching the mark scheme PDF</li>
                            <li><Check size={20} /> Seeing exact Chief Examiner pitfalls and grade-boundary predictions</li>
                        </ul>
                    </div>
                </section>

                <section className="compare-faq-section">
                    <div className="faq-q-card">
                        <h3>Save My Exams gives you the notes and past papers. AI Marking actually marks your handwritten pages.</h3>
                        <p>
                            Every day, tens of thousands of GCSE and A-Level students download a 30-to-40-page AQA or Edexcel past paper PDF, complete it on paper or an iPad, and then hit a wall trying to figure out whether their working out earns M1 follow-through marks. Use Save My Exams to learn the syllabus—then upload your completed paper to AI Marking for instant, examiner-grade marking.
                        </p>
                    </div>
                </section>

                <div className="compare-footer-cta">
                    <Link to="/app" className="feature-pill-btn">
                        Try AI Marking for free <ArrowRight size={18} style={{ marginLeft: '8px' }} />
                    </Link>

                    <div className="qr-code-wrapper">
                        <img src="/images/qr-demo.png" alt="Scan to try" />
                        <p className="qr-caption">
                            Reading on Desktop? Scan to see how we mark your handwriting instantly.
                        </p>
                    </div>
                </div>

                <p
                    style={{
                        marginTop: '56px',
                        fontSize: '12px',
                        color: '#8c8c87',
                        textAlign: 'center',
                        lineHeight: 1.6
                    }}
                >
                    Save My Exams is a registered trademark of Save My Exams Ltd. AI Marking is an independent platform and is not affiliated with or endorsed by Save My Exams.
                </p>
            </main>

            <LandingFooter />
        </div>
    );
};

export default CompareSaveMyExamsPage;