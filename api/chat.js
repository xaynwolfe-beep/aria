export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        return res.end();
    }

    const action = req.query.action || (req.body && req.body.action);

    // 1. Get Google OAuth URL
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

    // 2. Exchange code for tokens (used by frontend after callback)
    if (action === 'exchangeCode') {
        const { code } = req.body;
        const host = req.headers.host || 'aria-omega.vercel.app';
        const redirectUri = `https://${host}/api/auth/callback`;

        try {
            const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    code,
                    client_id: process.env.GOOGLE_CLIENT_ID,
                    client_secret: process.env.GOOGLE_CLIENT_SECRET,
                    redirect_uri: redirectUri,
                    grant_type: 'authorization_code'
                })
            });

            const tokens = await tokenResponse.json();

            if (tokens.error) throw new Error(tokens.error_description || tokens.error);

            // Get user profile
            const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { 'Authorization': `Bearer ${tokens.access_token}` }
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

    // 3. Main Chat Handler - Fetches real Gmail + Calendar
    if (action === 'chat') {
        const { messages: history = [], accessToken } = req.body || {};

        if (!accessToken) {
            res.statusCode = 401;
            return res.end(JSON.stringify({ error: 'Missing Google access token' }));
        }

        try {
            // Fetch recent emails
            const emailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const emailData = await emailRes.json();
            let emails = [];
            if (emailData.messages) {
                for (const m of emailData.messages.slice(0, 10)) {
                    const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata`, {
                        headers: { Authorization: `Bearer ${accessToken}` }
                    });
                    const detail = await detailRes.json();
                    const headers = {};
                    if (detail.payload?.headers) detail.payload.headers.forEach(h => headers[h.name] = h.value);
                    emails.push({
                        id: detail.id,
                        from: headers.From || 'Unknown',
                        subject: headers.Subject || '(no subject)',
                        date: headers.Date || '',
                        snippet: detail.snippet || ''
                    });
                }
            }

            // Fetch upcoming calendar events
            const timeMin = new Date().toISOString();
            const timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            const calRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=15&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const calData = await calRes.json();
            const events = calData.items || [];

            // Build context
            let context = `User's Gmail & Calendar Data (Asia/Kuala_Lumpur timezone):\n\n`;
            context += `RECENT EMAILS:\n` + emails.map((e,i) => `${i+1}. From: ${e.from} | "${e.subject}" | ${e.date}\nSnippet: ${e.snippet}`).join('\n') + '\n\n';
            context += `UPCOMING EVENTS:\n` + events.map((e,i) => `${i+1}. "${e.summary}" | ${e.start.dateTime || e.start.date}`).join('\n');

            const systemPrompt = `You are Aria, a helpful AI assistant for aria-xayn.
You have real access to the user's Gmail and Google Calendar. Use ONLY the data below. Never invent any emails or events.

${context}

Answer naturally. If the user wants to send an email, create an event, or delete something, respond with valid JSON only in this format:
{"action":"sendEmail","params":{"to":"email","subject":"...","body":"..."}} 
or similar for createEvent / deleteEmail / deleteEvent.

Otherwise, reply normally and helpfully.`;

            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.1-70b-versatile',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        ...history
                    ],
                    temperature: 0.7,
                    max_tokens: 1000
                })
            });

            const groqData = await groqResponse.json();
            let reply = groqData.choices?.[0]?.message?.content?.trim() || "Sorry, I couldn't process that.";

            res.statusCode = 200;
            return res.end(JSON.stringify({ reply }));

        } catch (err) {
            console.error(err);
            res.statusCode = 500;
            return res.end(JSON.stringify({ error: "Failed to fetch data. Please try again." }));
        }
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Unknown action' }));
}
