import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const ScrollToTop = () => {
    const { pathname } = useLocation();

    useEffect(() => {
        // Try multiple ways to scroll to top to cover all browser/CSS scenarios
        const scrollToTop = () => {
            window.scrollTo(0, 0);
            document.documentElement.scrollTo(0, 0);
            document.body.scrollTo(0, 0);

            // List of potential scrollable containers in this app
            const containers = ['.app-container', '.right-side', '.main-content', '.legal-page-wrapper'];

            containers.forEach(selector => {
                const el = document.querySelector(selector);
                if (el) {
                    el.scrollTo(0, 0);
                    (el as HTMLElement).scrollTop = 0;
                }
            });
        };

        // Execute immediately
        scrollToTop();

        // Also execute after a short delay to ensure React has finished rendering/layout
        const timer = setTimeout(scrollToTop, 20);
        return () => clearTimeout(timer);
    }, [pathname]);

    return null;
};

export default ScrollToTop;
