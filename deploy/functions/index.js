import { onRequest } from 'firebase-functions/v2/https';
import app from './server.js';

export const api = onRequest({
  region: 'us-central1',
  memory: '1GiB',
  timeoutSeconds: 60,
  maxInstances: 10
}, app);