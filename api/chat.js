// api/chat.js - Debug version
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.statusCode = 200;
        return res.end();
    }

    const action = req.query.action || (req.body && req.body.action);

    // === DEBUG: Show environment variables status ===
    if (action === 'getAuthUrl') {
        const clientId = process.env.GOOGLE_CLIENT_ID || 'MISSING';
        const secretPresent = !!process.env.GOOGLE_CLIENT_SECRET;
        const groqPresent = !!process.env.GROQ_API_KEY;

        const realAuthUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${clientId}&redirect_uri=https://aria-omega.vercel.app/api/auth/callback&response_type=code&scope=https://mail.google.com/+https://www.googleapis.com/auth/calendar+openid+email+profile&access_type=offline&prompt=consent`;

        res.statusCode = 200;
        return res.end(JSON.stringify({
            authUrl: realAuthUrl,
            debug: {
                clientId: clientId === 'MISSING' ? 'MISSING' : clientId.substring(0, 30) + '...',
                secretPresent: secretPresent,
                groqPresent: groqPresent,
                message: "Check if clientId shows your real ID or still MISSING"
            }
        }));
    }

    // Chat handler - safe version
    if (action === 'chat') {
        const groqKey = process.env.GROQ_API_KEY ? "present" : "missing";

        res.statusCode = 200;
        return res.end(JSON.stringify({
            reply: `✅ API is connected!\n\nGROQ key: ${groqKey}\n\nHello Xayn! Ask me to summarize your emails or check your calendar.`,
            debug: { groqKeyStatus: groqKey }
        }));
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ message: "aria-xayn API running" }));
}
