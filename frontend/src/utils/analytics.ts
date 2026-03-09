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
 * @param {string} userEmail - The user's verified email address for Enhanced Conversions
 */
export const fireAdsPurchaseConversion = (transactionValue: number | string, transactionId: string, userEmail?: string | null) => {
    const CONVERSION_LABEL = 'cUbtCMXn24IcEOCDuN0C';
    const ADS_ID = 'AW-732824032';

    // 1. Upstream Data Integrity Checks
    if (typeof window.gtag !== 'function') {
        console.error('[Ads Evidence] ❌ gtag is not defined. Conversion dropped upstream. Check Phase 1 initialization.');
        return;
    }

    if (!transactionValue || !transactionId) {
        console.error('[Ads Evidence] ❌ Missing critical transaction data (Value or ID). Halting conversion fire to prevent malformed payload.', { transactionValue, transactionId });
        return;
    }

    // 2. NEW: Explicitly set the Enhanced Conversion user data first (SAFEGUARD)
    if (userEmail) {
        window.gtag('set', 'user_data', {
            "email": userEmail
        });
        console.log(`[Ads Evidence] 📧 Enhanced data attached for: ${userEmail}`);
    } else {
        console.warn(`[Ads Evidence] ⚠️ Email missing. Firing standard conversion without Enhanced Data.`);
    }

    // 3. Outbound Payload Verification Log
    const value = parseFloat(transactionValue.toString());
    const payload = {
        'send_to': `${ADS_ID}/${CONVERSION_LABEL}`,
        'value': value,
        'currency': 'GBP',
        'transaction_id': transactionId.toString()
    };

    console.log(`[Ads Evidence] 🚀 Firing Native Ads Purchase Conversion. ID: ${ADS_ID}/${CONVERSION_LABEL} | Value: £${transactionValue} | Order: ${transactionId}`);
    console.log('[Ads Evidence] 📦 Full Payload:', payload);

    // 4. Native Event Fire (Switched to 'purchase' as requested)
    window.gtag('event', 'purchase', payload);

    // 5. Verification Post-Fire
    console.log('[Ads Evidence] ✅ Success: Google Ads Event DISPATCHED to window.gtag');
    if (window.hasOwnProperty('dataLayer')) {
        console.log('[Ads Evidence] 📊 DataLayer Status:', (window as any).dataLayer?.slice(-1)[0]);
    }
};

/**
 * Fires the Google Ads Sign-up Conversion
 * @param {string} userEmail - The user's verified email address for Enhanced Conversions
 */
export const fireAdsSignupConversion = (userEmail?: string | null) => {
    // NOTE: Placeholder label for Sign-up. Update this once the exact label is known.
    const CONVERSION_LABEL = '5pBwCLCH5oQcEOCDuN0C';
    const ADS_ID = 'AW-732824032';

    if (typeof window.gtag !== 'function') {
        console.warn('[Ads Evidence] ⚠️ gtag missing. Sign-up conversion skipped.');
        return;
    }

    // NEW: Explicitly set the Enhanced Conversion user data first
    if (userEmail) {
        window.gtag('set', 'user_data', {
            "email": userEmail
        });
        console.log(`[Ads Evidence] 📧 Enhanced data (Sign-up) attached for: ${userEmail}`);
    }

    const payload = {
        'send_to': `${ADS_ID}/${CONVERSION_LABEL}`,
        'value': 1.0, // Default value for sign-up
        'currency': 'GBP'
    };

    console.log(`[Ads Evidence] 🚀 Firing Native Ads Sign-up Conversion. ID: ${ADS_ID}/${CONVERSION_LABEL}`);

    // Fire the 'sign_up' event
    window.gtag('event', 'sign_up', payload);
};
