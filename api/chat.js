export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        return res.end();
    }

    let action = req.query.action || (req.body && req.body.action);

    // For GET test
    if (req.method === 'GET' && action === 'getAuthUrl') {
        const clientId = process.env.GOOGLE_CLIENT_ID || 'MISSING';
        res.statusCode = 200;
        return res.end(JSON.stringify({
            authUrl: `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=https://aria-omega.vercel.app/api/auth/callback&response_type=code&scope=https://mail.google.com/+https://www.googleapis.com/auth/calendar+openid+email+profile&access_type=offline&prompt=consent`,
            debug: { clientId: clientId.substring(0, 20) + '...' }
        }));
    }

    // Main chat handler - simplified and safe
    if (action === 'chat') {
        const GROQ_API_KEY = process.env.GROQ_API_KEY;
        const accessToken = req.body?.accessToken;

        if (!GROQ_API_KEY) {
            res.statusCode = 500;
            return res.end(JSON.stringify({ 
                error: 'GROQ_API_KEY is not set in Vercel Environment Variables' 
            }));
        }

        if (!accessToken) {
            res.statusCode = 401;
            return res.end(JSON.stringify({ error: 'Missing Google access token' }));
        }

        try {
            // Safe fallback response while we debug Groq
            const safeReply = `Hello Xayn! 👋\n\nI have access to your Gmail and Google Calendar.\n\nTry asking me:\n• "Summarize my recent emails"\n• "What is on my calendar this week?"\n\nI'm ready when you are!`;

            res.statusCode = 200;
            return res.end(JSON.stringify({ 
                reply: safeReply,
                debug: { groqKeyPresent: true, accessTokenPresent: !!accessToken }
            }));

        } catch (err) {
            console.error('Chat error:', err.message);
            res.statusCode = 500;
            return res.end(JSON.stringify({ 
                error: 'Backend error: ' + err.message 
            }));
        }
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Unknown action' }));
}
