export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        return res.end();
    }

    // Parse body for POST requests
    let body = {};
    if (req.method === 'POST') {
        let raw = '';
        await new Promise(resolve => {
            req.on('data', chunk => { raw += chunk; });
            req.on('end', resolve);
        });
        try { body = JSON.parse(raw); } catch (_) {}
    }

    const action = new URL(req.url, `https://${req.headers.host}`).searchParams.get('action') || body.action;
    const REDIRECT_URI = 'https://aria-omega.vercel.app/api/auth/callback';

    // ── 1. GET AUTH URL ──────────────────────────────────────────────────────
    if (action === 'getAuthUrl') {
        const params = new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            redirect_uri: REDIRECT_URI,
            response_type: 'code',
            scope: 'https://mail.google.com/ https://www.googleapis.com/auth/calendar openid email profile',
            access_type: 'offline',
            prompt: 'consent'
        });
        res.statusCode = 200;
        return res.end(JSON.stringify({
            authUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
        }));
    }

    // ── 2. EXCHANGE CODE FOR TOKENS ──────────────────────────────────────────
    if (action === 'exchangeCode') {
        const { code } = body;
        try {
            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
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
            const tokens = await tokenRes.json();
            if (tokens.error) throw new Error(tokens.error_description || tokens.error);

            const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${tokens.access_token}` }
            });
            const profile = await profileRes.json();

            res.statusCode = 200;
            return res.end(JSON.stringify({
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expires_in: tokens.expires_in,
                profile: { name: profile.name, email: profile.email, picture: profile.picture }
            }));
        } catch (err) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ error: err.message }));
        }
    }

    // ── 3. MAIN CHAT (real Gmail + Calendar + Groq) ──────────────────────────
    if (action === 'chat') {
        const { messages: history = [], accessToken } = body;

        if (!accessToken) {
            res.statusCode = 401;
            return res.end(JSON.stringify({ error: 'Missing access token' }));
        }
        if (!process.env.GROQ_API_KEY) {
            res.statusCode = 500;
            return res.end(JSON.stringify({ error: 'GROQ_API_KEY not set' }));
        }

        try {
            // ── Fetch Gmail ──────────────────────────────────────────────────
            let emails = [];
            const emailListRes = await fetch(
                'https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20',
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            const emailListData = await emailListRes.json();

            if (emailListData.messages) {
                for (const msg of emailListData.messages.slice(0, 10)) {
                    try {
                        const detailRes = await fetch(
                            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From,To,Subject,Date`,
                            { headers: { Authorization: `Bearer ${accessToken}` } }
                        );
                        const detail = await detailRes.json();
                        const h = {};
                        (detail.payload?.headers || []).forEach(x => { h[x.name] = x.value; });
                        emails.push({
                            id: detail.id,
                            from: h.From || 'Unknown',
                            to: h.To || '',
                            subject: h.Subject || '(no subject)',
                            date: h.Date || new Date(parseInt(detail.internalDate)).toLocaleString('en-MY'),
                            snippet: detail.snippet || ''
                        });
                    } catch (_) {}
                }
            }

            // ── Fetch Calendar ───────────────────────────────────────────────
            const timeMin = new Date().toISOString();
            const timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
            const calRes = await fetch(
                `https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=15&timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true&orderBy=startTime`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            const calData = await calRes.json();
            const events = calData.items || [];

            // ── Build AI Context ─────────────────────────────────────────────
            const now = new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' });
            let context = `Current time (Asia/Kuala_Lumpur): ${now}\n\n`;
            context += `RECENT EMAILS (${emails.length} fetched):\n`;
            emails.forEach((e, i) => {
                context += `${i + 1}. ID:${e.id} | From: ${e.from} | Subject: "${e.subject}" | ${e.date}\n   Snippet: ${e.snippet}\n`;
            });
            context += `\nUPCOMING CALENDAR EVENTS (next 30 days, ${events.length} found):\n`;
            events.forEach((ev, i) => {
                context += `${i + 1}. ID:${ev.id} | "${ev.summary || '(no title)'}" | Start: ${ev.start?.dateTime || ev.start?.date}\n`;
            });

            const systemPrompt = `You are Aria, a smart and friendly AI assistant for aria-xayn (timezone: Asia/Kuala_Lumpur).
You have LIVE access to the user's Gmail and Google Calendar shown below. 

${context}

STRICT RULES:
1. NEVER invent, guess, or fabricate emails or events. Use ONLY the data above.
2. If data is unavailable for a question, say: "I don't see that in your recent emails or calendar."
3. For action requests, respond with ONLY a raw JSON object (no markdown, no extra text):
   - Send email:    {"action":"sendEmail","params":{"to":"...","subject":"...","body":"..."}}
   - Create event:  {"action":"createEvent","params":{"summary":"...","start":"2026-03-30T10:00:00","end":"2026-03-30T11:00:00"}}
   - Delete email:  {"action":"deleteEmail","params":{"messageId":"exact-id-from-above"}}
   - Delete event:  {"action":"deleteEvent","params":{"eventId":"exact-id-from-above"}}
4. For normal questions, reply in friendly, concise plain text.`;

            const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.1-70b-versatile',
                    messages: [{ role: 'system', content: systemPrompt }, ...history],
                    temperature: 0.6,
                    max_tokens: 1000
                })
            });

            const groqData = await groqRes.json();
            let reply = groqData.choices?.[0]?.message?.content?.trim();

            if (!reply) {
                const errDetail = JSON.stringify(groqData).substring(0, 300);
                throw new Error(`Groq returned no content. Response: ${errDetail}`);
            }

            // ── Handle action JSON responses ─────────────────────────────────
            try {
                const parsed = JSON.parse(reply);
                if (parsed.action && parsed.params) {
                    const { action: act, params } = parsed;

                    if (act === 'sendEmail') {
                        const mime = [
                            `From: me`, `To: ${params.to}`,
                            `Subject: ${params.subject}`,
                            `Content-Type: text/plain; charset=utf-8`, ``,
                            params.body
                        ].join('\r\n');
                        const raw = Buffer.from(mime).toString('base64')
                            .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                        const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ raw })
                        });
                        if (!sendRes.ok) throw new Error('Gmail send failed');
                        reply = `✅ Email sent to **${params.to}** with subject: "${params.subject}"`;

                    } else if (act === 'createEvent') {
                        const event = {
                            summary: params.summary,
                            description: params.description || '',
                            start: { dateTime: params.start, timeZone: 'Asia/Kuala_Lumpur' },
                            end: { dateTime: params.end, timeZone: 'Asia/Kuala_Lumpur' }
                        };
                        const evRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                            body: JSON.stringify(event)
                        });
                        if (!evRes.ok) throw new Error('Calendar create failed');
                        reply = `✅ Event **"${params.summary}"** created on your calendar.`;

                    } else if (act === 'deleteEmail') {
                        const trashRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${params.messageId}/trash`, {
                            method: 'POST',
                            headers: { Authorization: `Bearer ${accessToken}` }
                        });
                        if (!trashRes.ok) throw new Error('Trash failed');
                        reply = `🗑️ Email moved to trash.`;

                    } else if (act === 'deleteEvent') {
                        const delRes = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${params.eventId}`, {
                            method: 'DELETE',
                            headers: { Authorization: `Bearer ${accessToken}` }
                        });
                        if (!delRes.ok) throw new Error('Delete event failed');
                        reply = `🗑️ Calendar event deleted.`;
                    }
                }
            } catch (_) {
                // Not JSON — normal text reply, keep as-is
            }

            res.statusCode = 200;
            return res.end(JSON.stringify({ reply }));

        } catch (err) {
            console.error('Chat handler error:', err.message);
            res.statusCode = 500;
            return res.end(JSON.stringify({
                reply: `❌ Error: ${err.message || 'Something went wrong. Please try again.'}`
            }));
        }
    }

    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Unknown action' }));
}
