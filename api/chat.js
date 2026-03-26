export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Credentials', 'true')
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
        res.statusCode = 200
        return res.end()
    }

    const url = new URL(req.url, `http://${req.headers.host}`)
    let action = url.searchParams.get('action')

    // Parse body for POST
    let body = {}
    if (req.method === 'POST') {
        let raw = ''
        await new Promise((resolve) => {
            req.on('data', (chunk) => { raw += chunk })
            req.on('end', resolve)
        })
        try {
            body = JSON.parse(raw)
        } catch (_) {}
        if (!action) action = body.action
    }

    const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID
    const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
    const GROQ_API_KEY = process.env.GROQ_API_KEY

    // Helper: getAuthUrl
    if (action === 'getAuthUrl') {
        const host = req.headers.host || 'aria-xayn.vercel.app'
        const redirectUri = `https://${host}/api/auth/callback`
        const scopes = [
            'https://mail.google.com/',
            'https://www.googleapis.com/auth/calendar',
            'openid',
            'email',
            'profile'
        ].join(' ')

        const params = new URLSearchParams({
            client_id: GOOGLE_CLIENT_ID,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: scopes,
            access_type: 'offline',
            prompt: 'consent'
        })

        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`
        res.statusCode = 200
        return res.end(JSON.stringify({ authUrl }))
    }

    // Helper: exchangeCode
    if (action === 'exchangeCode') {
        const code = body.code
        const host = req.headers.host || 'aria-xayn.vercel.app'
        const redirectUri = `https://${host}/api/auth/callback`

        try {
            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    code,
                    client_id: GOOGLE_CLIENT_ID,
                    client_secret: GOOGLE_CLIENT_SECRET,
                    redirect_uri: redirectUri,
                    grant_type: 'authorization_code'
                })
            })
            const tokensData = await tokenRes.json()

            if (tokensData.error) throw new Error(tokensData.error_description || tokensData.error)

            const profileRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${tokensData.access_token}` }
            })
            const profile = await profileRes.json()

            res.statusCode = 200
            return res.end(JSON.stringify({
                access_token: tokensData.access_token,
                refresh_token: tokensData.refresh_token,
                expires_in: tokensData.expires_in,
                profile: {
                    name: profile.name,
                    picture: profile.picture,
                    email: profile.email
                }
            }))
        } catch (err) {
            res.statusCode = 400
            return res.end(JSON.stringify({ error: err.message }))
        }
    }

    // Helper functions
    async function getEmails(accessToken) {
        const listRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25', {
            headers: { Authorization: `Bearer ${accessToken}` }
        })
        const listData = await listRes.json()
        if (!listData.messages) return []

        const emails = []
        for (const msg of listData.messages) {
            const detailRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=From,To,Subject,Date`, {
                headers: { Authorization: `Bearer ${accessToken}` }
            })
            const detail = await detailRes.json()
            const headersObj = {}
            if (detail.payload && detail.payload.headers) {
                detail.payload.headers.forEach(h => { headersObj[h.name] = h.value })
            }
            emails.push({
                id: detail.id,
                from: headersObj.From || 'Unknown',
                to: headersObj.To || '',
                subject: headersObj.Subject || '(no subject)',
                date: headersObj.Date || new Date(parseInt(detail.internalDate)).toLocaleString('en-MY'),
                snippet: detail.snippet || ''
            })
        }
        return emails
    }

    async function getCalendarEvents(accessToken) {
        const now = new Date().toISOString()
        const thirtyDays = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?maxResults=20&timeMin=${encodeURIComponent(now)}&timeMax=${encodeURIComponent(thirtyDays)}&singleEvents=true&orderBy=startTime`, {
            headers: { Authorization: `Bearer ${accessToken}` }
        })
        const data = await res.json()
        return data.items || []
    }

    async function sendGmailEmail(accessToken, to, subject, body) {
        const mimeMessage = [
            `From: me`,
            `To: ${to}`,
            `Subject: ${subject}`,
            `Content-Type: text/plain; charset=utf-8`,
            ``,
            body
        ].join('\r\n')

        const raw = Buffer.from(mimeMessage).toString('base64')
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '')

        const sendRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ raw })
        })
        if (!sendRes.ok) throw new Error('Failed to send email')
        return await sendRes.json()
    }

    async function createCalendarEvent(accessToken, params) {
        const event = {
            summary: params.summary,
            start: { dateTime: params.start, timeZone: 'Asia/Kuala_Lumpur' },
            end: { dateTime: params.end, timeZone: 'Asia/Kuala_Lumpur' },
            description: params.description || ''
        }
        const res = await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(event)
        })
        if (!res.ok) throw new Error('Failed to create event')
        return await res.json()
    }

    async function deleteGmailEmail(accessToken, messageId) {
        const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/trash`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}` }
        })
        if (!res.ok) throw new Error('Failed to trash email')
    }

    async function deleteCalendarEvent(accessToken, eventId) {
        const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${accessToken}` }
        })
        if (!res.ok) throw new Error('Failed to delete event')
    }

    // Main chat + actions
    if (action === 'chat') {
        const { messages: history = [], accessToken } = body
        if (!accessToken) {
            res.statusCode = 401
            return res.end(JSON.stringify({ error: 'Missing access token' }))
        }

        try {
            const emails = await getEmails(accessToken)
            const events = await getCalendarEvents(accessToken)

            let dataStr = `RECENT EMAILS (up to 25):\n`
            emails.forEach((e, i) => {
                dataStr += `${i + 1}. ID: ${e.id} | From: ${e.from} | Subject: "${e.subject}" | Date: ${e.date} | Snippet: "${e.snippet}"\n`
            })
            dataStr += `\nUPCOMING EVENTS (next 30 days):\n`
            events.forEach((ev, i) => {
                const start = ev.start.dateTime || ev.start.date
                const end = ev.end.dateTime || ev.end.date
                dataStr += `${i + 1}. ID: ${ev.id} | Title: "${ev.summary}" | Start: ${start} | End: ${end}\n`
            })

            const systemPrompt = `You are Aria, a helpful AI assistant for aria-xayn (timezone: Asia/Kuala_Lumpur).
You have real access to the user's Gmail and Google Calendar data shown below.

${dataStr}

RULES:
• NEVER invent emails, events, or any data. Use ONLY what is listed above.
• If you cannot answer from the data, say exactly: "I don't see that in your recent emails or calendar."
• For actions the user requests, reply with ONLY a JSON object (no extra text):
   - Send email → {"action":"sendEmail","params":{"to":"email","subject":"...","body":"..."}}
   - Create event → {"action":"createEvent","params":{"summary":"...","start":"2026-03-27T10:00:00","end":"2026-03-27T11:00:00","description":"..."}}
   - Delete email → {"action":"deleteEmail","params":{"messageId":"exact-id-from-list"}}
   - Delete event → {"action":"deleteEvent","params":{"eventId":"exact-id-from-list"}}
• For normal conversation, reply with friendly, concise text.`

            const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${GROQ_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'llama-3.1-70b-versatile',
                    messages: [
                        { role: 'system', content: systemPrompt },
                        ...history
                    ],
                    temperature: 0.7,
                    max_tokens: 1024
                })
            })

            const groqData = await groqResponse.json()
            let content = groqData.choices[0]?.message?.content?.trim() || 'Sorry, I could not generate a response.'

            // Handle possible JSON action
            let finalReply = content
            try {
                const parsed = JSON.parse(content)
                if (parsed.action && parsed.params) {
                    const { action: act, params } = parsed
                    if (act === 'sendEmail') {
                        await sendGmailEmail(accessToken, params.to, params.subject, params.body)
                        finalReply = `✅ Email successfully sent to ${params.to}`
                    } else if (act === 'createEvent') {
                        await createCalendarEvent(accessToken, params)
                        finalReply = `✅ Event "${params.summary}" created successfully`
                    } else if (act === 'deleteEmail') {
                        await deleteGmailEmail(accessToken, params.messageId)
                        finalReply = `✅ Email moved to trash`
                    } else if (act === 'deleteEvent') {
                        await deleteCalendarEvent(accessToken, params.eventId)
                        finalReply = `✅ Event deleted`
                    }
                }
            } catch (_) {
                // Normal text response
            }

            res.statusCode = 200
            return res.end(JSON.stringify({ reply: finalReply }))
        } catch (err) {
            console.error(err)
            res.statusCode = 500
            return res.end(JSON.stringify({ error: err.message || 'Internal error' }))
        }
    }

    // Direct action endpoints (for completeness)
    if (action === 'sendEmail') {
        const { accessToken, to, subject, body: emailBody } = body
        try {
            await sendGmailEmail(accessToken, to, subject, emailBody)
            res.statusCode = 200
            return res.end(JSON.stringify({ success: true, message: 'Email sent' }))
        } catch (e) {
            res.statusCode = 500
            return res.end(JSON.stringify({ error: e.message }))
        }
    }

    if (action === 'createEvent') {
        const { accessToken, ...params } = body
        try {
            await createCalendarEvent(accessToken, params)
            res.statusCode = 200
            return res.end(JSON.stringify({ success: true, message: 'Event created' }))
        } catch (e) {
            res.statusCode = 500
            return res.end(JSON.stringify({ error: e.message }))
        }
    }

    if (action === 'deleteEmail') {
        const { accessToken, messageId } = body
        try {
            await deleteGmailEmail(accessToken, messageId)
            res.statusCode = 200
            return res.end(JSON.stringify({ success: true, message: 'Email moved to trash' }))
        } catch (e) {
            res.statusCode = 500
            return res.end(JSON.stringify({ error: e.message }))
        }
    }

    if (action === 'deleteEvent') {
        const { accessToken, eventId } = body
        try {
            await deleteCalendarEvent(accessToken, eventId)
            res.statusCode = 200
            return res.end(JSON.stringify({ success: true, message: 'Event deleted' }))
        } catch (e) {
            res.statusCode = 500
            return res.end(JSON.stringify({ error: e.message }))
        }
    }

    // Fallback
    res.statusCode = 404
    res.end(JSON.stringify({ error: 'Unknown action' }))
}
