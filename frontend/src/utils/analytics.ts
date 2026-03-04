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

/**
 * Fires the Google Ads Purchase Conversion
 * @param {number|string} transactionValue - The total cart/purchase value
 * @param {string} transactionId - Your unique internal order ID (prevents duplicate counting)
 */
export const fireAdsPurchaseConversion = (transactionValue: number | string, transactionId: string) => {
    const CONVERSION_LABEL = 'cUbtCMXn24IcEOCDuN0C';

    // 1. Upstream Data Integrity Checks
    if (typeof window.gtag !== 'function') {
        console.error('[Ads Debug] gtag is not defined. Conversion dropped upstream. Check Phase 1 initialization.');
        return;
    }

    if (!transactionValue || !transactionId) {
        console.error('[Ads Debug] Missing critical transaction data (Value or ID). Halting conversion fire to prevent malformed payload.');
        return;
    }

    // 2. Outbound Payload Verification Log
    console.log(`[Ads Debug] Firing Native Ads Conversion. ID: AW-732824032/${CONVERSION_LABEL} | Value: £${transactionValue} | Order: ${transactionId}`);

    // 3. Native Event Fire
    window.gtag('event', 'conversion', {
        'send_to': `AW-732824032/${CONVERSION_LABEL}`,
        'value': parseFloat(transactionValue.toString()),
        'currency': 'GBP',
        'transaction_id': transactionId.toString()
    });
};
