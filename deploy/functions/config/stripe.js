"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.STRIPE_CONFIG = void 0;
const stripe_1 = __importDefault(require("stripe"));
const dotenv = __importStar(require("dotenv"));
dotenv.config({ path: '.env.local' });
const stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY || '', {
    apiVersion: '2025-08-27.basil',
});
exports.STRIPE_CONFIG = {
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
    secretKey: process.env.STRIPE_SECRET_KEY || '',
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
    currency: 'usd',
    plans: {
        pro: {
            monthly: { priceId: process.env.STRIPE_PRO_MONTHLY_PRICE_ID || '', amount: 1900 },
            yearly: { priceId: process.env.STRIPE_PRO_YEARLY_PRICE_ID || '', amount: 19000 },
        },
        enterprise: {
            monthly: { priceId: process.env.STRIPE_ENTERPRISE_MONTHLY_PRICE_ID || '', amount: 10000 },
            yearly: { priceId: process.env.STRIPE_ENTERPRISE_YEARLY_PRICE_ID || '', amount: 100000 },
        },
    },
};
exports.default = stripe;
