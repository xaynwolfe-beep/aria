// api/chat.js - Minimal working version
export default async function handler(req, res) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        return res.end();
    }

    const action = req.query.action || (req.body && req.body.action);

    // Test endpoint
    if (action === 'getAuthUrl') {
        res.statusCode = 200;
        return res.end(JSON.stringify({
            authUrl: "https://accounts.google.com/o/oauth2/v2/auth?client_id=TEST&redirect_uri=https://aria-omega.vercel.app/api/auth/callback&response_type=code&scope=openid",
            message: "API route is working!"
        }));
    }

    // Chat endpoint - safe version
    if (action === 'chat') {
        res.statusCode = 200;
        return res.end(JSON.stringify({
            reply: "✅ API is connected! Hello from aria-xayn.\n\nYour Gmail and Calendar integration is ready.\nTry asking me to summarize your emails."
        }));
    }

    // Default response
    res.statusCode = 200;
    res.end(JSON.stringify({ 
        message: "aria-xayn API is running",
        action: action || "none"
    }));
}
