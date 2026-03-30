export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        return res.end();
    }

    const action = req.query.action || (req.body && req.body.action);

    const REDIRECT_URI = 'https://aria-omega.vercel.app/api/auth/callback';

    // 1. Get Auth URL
    if (action === 'getAuthUrl') {
        const params = new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            response_type: 'code',
            scope: 'https://mail.google.com/ https://www.googleapis.com/auth/calendar openid email profile',
            access_type: 'offline',
            prompt: 'consent'
        });

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;

        res.statusCode = 200;
        return res.end(JSON.stringify({ authUrl }));
    }

    // 2. Exchange Code
    if (action === 'exchangeCode') {
        const { code } = req.body;
        try {
            const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    code,
                    client_id: process.env.GOOGLE_CLIENT_ID,
                    client_secret: process.env.GOOGLE_CLIENT_SECRET,
                    redirect_uri: REDIRECT_URI,
                    grant_type: 'authorization_code'
                })
            });

            const tokens = await tokenResponse.json();

            if (tokens.error) throw new Error(tokens.error_description || tokens.error);

            const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${tokens.access_token}` }
            });
            const profile = await profileResponse.json();

            res.statusCode = 200;
            return res.end(JSON.stringify({
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expires_in: tokens.expires_in,
                profile: {
                    name: profile.name,
                    email: profile.email,
                    picture: profile.picture
                }
            }));
        } catch (error) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: error.message }));
        }
    }

    // 3. Chat handler (simplified for now)
    if (action === 'chat') {
        const { messages: history = [], accessToken } = req.body || {};

        if (!accessToken) {
            res.statusCode = 401;
            return res.end(JSON.stringify({ error: 'Missing access token' }));
        }

        res.statusCode = 200;
        return res.end(JSON.stringify({
            reply: "✅ Login successful! I'm connected to your Gmail and Google Calendar.\n\nTry asking me:\n• Summarize my recent emails\n• What is on my calendar this week?"
        }));
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Unknown action' }));
}
