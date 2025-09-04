import { onRequest } from 'firebase-functions/v2/https';

export const api = onRequest({
  region: 'us-central1',
  memory: '1GiB',
  timeoutSeconds: 60,
  maxInstances: 10
}, (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.status(200).send('');
    return;
  }
  
  if (req.path === '/health') {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
    return;
  }
  
  res.json({ message: 'IntelliMark API is working!', path: req.path });
});
