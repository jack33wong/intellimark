/**
 * Centralized Analytics Utility
 * Handles traffic source detection and unified event tracking
 */

declare global {
    interface Window {
        gtag?: (...args: any[]) => void;
    }
}

export type InteractionMode = 'MARK' | 'MODEL';

/**
 * Detects the traffic source based on UTM parameters or Referrer
 */
const getTrafficSource = (): string => {
    const urlParams = new URLSearchParams(window.location.search);
    const utmSource = urlParams.get('utm_source');
    const referrer = document.referrer.toLowerCase();

    if (utmSource === 'google' || referrer.includes('google.com')) return 'google';
    if (utmSource === 'chatgpt' || referrer.includes('chatgpt.com') || referrer.includes('t.co')) return 'chatgpt';

    return 'direct';
};

/**
 * Centralized function to track paper interactions (Model/Mark clicks)
 * 
 * @param paperId The identification code of the paper (e.g., "8300-1H-JUN24")
 * @param mode The mode selected by the user
 */
export const trackPaperInteraction = (paperId: string, mode: InteractionMode) => {
    const source = getTrafficSource();
    const eventData = {
        'event_category': 'Conversion Hub',
        'event_label': mode,
        'paper_id': paperId,
        'traffic_source': source,
        'non_interaction': false
    };

    // 1. Google Analytics (via gtag)
    if (window.gtag) {
        window.gtag('event', 'paper_interaction', eventData);
    }

    // 2. Debug logging (only in development)
    if (process.env.NODE_ENV !== 'production') {
        console.log(`[Analytics] Tracked ${mode} for ${paperId} from ${source}`, eventData);
    }
};
