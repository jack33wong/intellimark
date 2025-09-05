export const AI_MODELS = {
    'gemini-2.5-pro': {
        name: 'Google Gemini 2.5 Pro',
        apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent',
        maxTokens: 8000,
        temperature: 0.1
    },
    'chatgpt-5': {
        name: 'OpenAI ChatGPT 5',
        apiEndpoint: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-5',
        maxTokens: 8000,
        temperature: 0.1,
        maxCompletionTokens: 8000
    },
    'chatgpt-4o': {
        name: 'OpenAI GPT-4 Omni',
        apiEndpoint: 'https://api.openai.com/v1/chat/completions',
        model: 'gpt-4o',
        maxTokens: 8000,
        temperature: 0.1,
        maxCompletionTokens: 8000
    }
};
export function getModelConfig(modelType) {
    const config = AI_MODELS[modelType];
    if (!config) {
        throw new Error(`Unsupported model type: ${modelType}`);
    }
    return config;
}
export function getAvailableModels() {
    return Object.keys(AI_MODELS);
}
export function getModelDisplayName(modelType) {
    return AI_MODELS[modelType]?.name || modelType;
}
export function isModelSupported(modelType) {
    return modelType in AI_MODELS;
}
export function getDefaultModel() {
    return 'chatgpt-4o';
}
export function validateModelConfig(modelType) {
    try {
        const config = getModelConfig(modelType);
        return !!(config.name &&
            config.apiEndpoint &&
            config.maxTokens &&
            typeof config.temperature === 'number');
    }
    catch {
        return false;
    }
}
export function getModelPromptTemplate(modelType) {
    const basePrompt = `You are an expert mathematics tutor. Please analyze the provided homework or question and provide detailed feedback, step-by-step solutions, and constructive comments.`;
    switch (modelType) {
        case 'gemini-2.5-pro':
            return `${basePrompt} Use clear, concise language and focus on mathematical accuracy.`;
        case 'chatgpt-5':
            return `${basePrompt} Provide comprehensive explanations with mathematical rigor.`;
        case 'chatgpt-4o':
            return `${basePrompt} Offer detailed analysis with practical examples.`;
        default:
            return basePrompt;
    }
}
export function getModelParameters(modelType) {
    const config = getModelConfig(modelType);
    switch (modelType) {
        case 'gemini-2.5-pro':
            return {
                maxOutputTokens: config.maxTokens,
                temperature: config.temperature,
                topP: 0.8,
                topK: 40
            };
        case 'chatgpt-5':
        case 'chatgpt-4o':
            return {
                max_tokens: config.maxTokens,
                temperature: config.temperature,
                top_p: 0.8,
                frequency_penalty: 0.1,
                presence_penalty: 0.1
            };
        default:
            return {
                temperature: config.temperature
            };
    }
}
