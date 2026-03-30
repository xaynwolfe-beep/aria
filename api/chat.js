export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        return res.end();
    }

    const action = req.query.action || (req.body && req.body.action);

    if (action === 'getAuthUrl') {
        const host = req.headers.host || 'aria-omega.vercel.app';
        const redirectUri = `https://${host}/api/auth/callback`;
        const scopes = 'https://mail.google.com/ https://www.googleapis.com/auth/calendar openid email profile';

        const params = new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: scopes,
            access_type: 'offline',
            prompt: 'consent'
        });

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

        res.statusCode = 200;
        return res.end(JSON.stringify({ authUrl }));
    }

    if (action === 'exchangeCode') {
        // ... (keep your existing exchangeCode if you have it, or leave empty for now)
        res.statusCode = 200;
        return res.end(JSON.stringify({ error: "Not implemented in debug mode" }));
    }

    // ==================== DEBUG CHAT HANDLER ====================
    if (action === 'chat') {
        const { messages: history = [], accessToken } = req.body || {};

        if (!accessToken) {
            return res.status(401).json({ error: 'Missing access token' });
        }

        try {
            let debugInfo = "Starting request...\n";

            // Test Gmail access
            debugInfo += "Fetching emails...\n";
            const emailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=5', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });

            if (!emailRes.ok) {
                debugInfo += `Gmail failed: ${emailRes.status} ${emailRes.statusText}\n`;
            } else {
                debugInfo += "Gmail OK\n";
            }

            // Test Calendar access
            debugInfo += "Fetching calendar...\n";
            const now = new Date().toISOString();
            const calRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=5&timeMin=${now}`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });

            if (!calRes.ok) {
                debugInfo += `Calendar failed: ${calRes.status} ${calRes.statusText}\n`;
            } else {
                debugInfo += "Calendar OK\n";
            }

            // Groq test
            debugInfo += "Calling Groq...\n";
            const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.1-70b-versatile',
                    messages: [{ role: 'user', content: 'Say hello' }],
                    max_tokens: 50
                })
            });

            if (!groqRes.ok) {
                debugInfo += `Groq failed: ${groqRes.status}\n`;
            } else {
                debugInfo += "Groq OK\n";
            }

            res.statusCode = 200;
            return res.end(JSON.stringify({ 
                reply: `Debug Info:\n${debugInfo}\n\nThe backend is running but there is an issue with permissions or API calls.`
            }));

        } catch (err) {
            console.error(err);
            res.statusCode = 500;
            return res.end(JSON.stringify({ 
                error: err.message || 'Unknown error',
                stack: err.stack ? err.stack.substring(0, 300) : 'no stack'
            }));
        }
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Unknown action' }));
}
