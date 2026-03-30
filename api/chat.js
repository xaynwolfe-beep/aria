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

    // 3. Main Chat - Real Gmail + Calendar
    if (action === 'chat') {
        const { messages: history = [], accessToken } = req.body || {};

        if (!accessToken) {
            res.statusCode = 401;
            return res.end(JSON.stringify({ error: 'Missing access token' }));
        }

        try {
            // Fetch recent emails
            const emailRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=15', {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const emailData = await emailRes.json();

            let emails = [];
            if (emailData.messages) {
                for (const msg of emailData.messages.slice(0, 8)) {
                    try {
                        const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata`, {
                            headers: { Authorization: `Bearer ${accessToken}` }
                        });
                        const detail = await detailRes.json();
                        const headers = {};
                        if (detail.payload?.headers) {
                            detail.payload.headers.forEach(h => headers[h.name] = h.value);
                        }
                        emails.push({
                            id: detail.id,
                            from: headers.From || 'Unknown',
                            subject: headers.Subject || '(no subject)',
                            date: headers.Date || new Date(parseInt(detail.internalDate)).toLocaleString('en-MY'),
                            snippet: detail.snippet || ''
                        });
                    } catch (_) {}
                }
            }

            // Fetch calendar events (next 30 days)
            const timeMin = new Date().toISOString();
            const timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            const calRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=10&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            });
            const calData = await calRes.json();
            const events = calData.items || [];

            // Build context
            let context = `Current time (Asia/Kuala_Lumpur): ${new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}\n\n`;
            context += `RECENT EMAILS:\n`;
            emails.forEach((e, i) => {
                context += `${i+1}. From: ${e.from} | Subject: "${e.subject}" | Date: ${e.date} | Snippet: "${e.snippet}"\n`;
            });
            context += `\nUPCOMING EVENTS:\n`;
            events.forEach((ev, i) => {
                context += `${i+1}. "${ev.summary}" | Start: ${ev.start.dateTime || ev.start.date}\n`;
            });

            const systemPrompt = `You are Aria, a helpful AI assistant with real access to the user's Gmail and Google Calendar.

${context}

RULES:
- Use ONLY the data provided above. Never invent emails or events.
- Give friendly, concise, and helpful replies.
- If the user asks to send an email, create an event, or delete something, respond with ONLY a JSON object.

Example for sending email:
{"action":"sendEmail","params":{"to":"friend@example.com","subject":"Meeting tomorrow","body":"Hi, let's meet at 3pm."}}

Answer naturally otherwise.`;

            const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
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
                    max_tokens: 900
                })
            });

            const groqData = await groqRes.json();
            let reply = groqData.choices?.[0]?.message?.content?.trim() || "Sorry, I couldn't generate a response right now.";

            res.statusCode = 200;
            return res.end(JSON.stringify({ reply }));

        } catch (err) {
            console.error('Chat error:', err);
            res.statusCode = 500;
            return res.end(JSON.stringify({ 
                reply: "Sorry, I had trouble accessing your Gmail or Calendar. Please try again in a moment." 
            }));
        }
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Unknown action' }));
}
