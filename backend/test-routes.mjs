import express from 'express';

// Test importing the routes
console.log('1. Testing imports...');

try {
    const configRoutes = await import('./routes/config.js');
    console.log('✅ config.js imports successfully');
} catch (e) {
    console.log('❌ config.js failed:', e.message);
}

try {
    const creditsRoutes = await import('./routes/credits.js');
    console.log('✅ credits.js imports successfully');
} catch (e) {
    console.log('❌ credits.js failed:', e.message);
}

// Test creating app with routes
console.log('\n2. Testing route registration...');
const app = express();

try {
    const configRoutes = await import('./routes/config.js');
    app.use('/api/config', configRoutes.default);
    console.log('✅ config route registered');
} catch (e) {
    console.log('❌ config route failed:', e.message);
}

try {
    const creditsRoutes = await import('./routes/credits.js');
    app.use('/api/credits', creditsRoutes.default);
    console.log('✅ credits route registered');
} catch (e) {
    console.log('❌ credits route failed:', e.message);
}

// Start test server
const server = app.listen(5003, () => {
    console.log('\n3. Testing endpoints on port 5003...');

    // Test config endpoint
    fetch('http://localhost:5003/api/config/credits')
        .then(r => r.ok ? '✅' : '❌ ' + r.status)
        .then(status => console.log('Config endpoint:', status))
        .catch(e => console.log('Config endpoint: ❌', e.message));

    // Test credits endpoint
    setTimeout(() => {
        fetch('http://localhost:5003/api/credits/test123')
            .then(r => r.ok ? '✅' : '❌ ' + r.status)
            .then(status => console.log('Credits endpoint:', status))
            .catch(e => console.log('Credits endpoint: ❌', e.message))
            .finally(() => {
                server.close();
                process.exit(0);
            });
    }, 100);
});
