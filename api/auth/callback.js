export default async function handler(req, res) {
    const { code, error } = req.query

    if (error) {
        res.writeHead(302, { Location: `/?error=${encodeURIComponent(error)}` })
        return res.end()
    }

    if (code) {
        res.writeHead(302, { Location: `/?code=${encodeURIComponent(code)}` })
        return res.end()
    }

    // Fallback redirect
    res.writeHead(302, { Location: '/' })
    res.end()
}
