import ApiClient from './apiClient';
import API_CONFIG from '../config/api';

interface ExamMetadata {
    boards: string[];
    tiers: string[];
    papers: string[];
}

class ConfigService {
    private metadataCache: ExamMetadata | null = null;
    private metadataPromise: Promise<ExamMetadata> | null = null;
    private creditConfigCache: any = null;
    private creditConfigPromise: Promise<any> | null = null;
    private pricingCache: any = null;
    private pricingPromise: Promise<any> | null = null;

    async getExamMetadata(): Promise<ExamMetadata> {
        if (this.metadataCache) return this.metadataCache;
        if (this.metadataPromise) return this.metadataPromise;

        this.metadataPromise = (async () => {
            try {
                const response = await ApiClient.get('/api/config/exam-metadata');
                this.metadataCache = response.data;
                return response.data;
            } finally {
                this.metadataPromise = null;
            }
        })();
        return this.metadataPromise;
    }

    async getCreditConfig(): Promise<any> {
        if (this.creditConfigCache) return this.creditConfigCache;
        if (this.creditConfigPromise) return this.creditConfigPromise;

        this.creditConfigPromise = (async () => {
            try {
                const response = await fetch(`${API_CONFIG.BASE_URL}/api/config/credits`);
                if (!response.ok) throw new Error(`Failed to fetch credit config: ${response.status}`);
                const data = await response.json();
                this.creditConfigCache = data;
                return data;
            } finally {
                this.creditConfigPromise = null;
            }
        })();
        return this.creditConfigPromise;
    }

    async getPricing(): Promise<any> {
        if (this.pricingCache) return this.pricingCache;
        if (this.pricingPromise) return this.pricingPromise;

        this.pricingPromise = (async () => {
            try {
                const response = await ApiClient.get('/api/payment/plans');
                if (response.data.success) {
                    this.pricingCache = response.data.plans;
                    return response.data.plans;
                }
                throw new Error('Failed to fetch pricing');
            } finally {
                this.pricingPromise = null;
            }
        })();
        return this.pricingPromise;
    }
}

export default new ConfigService();
