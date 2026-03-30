export default async function handler(req, res) {
    const url = new URL(req.url, `https://${req.headers.host}`);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
        res.writeHead(302, { Location: `/?error=${encodeURIComponent(error)}` });
        return res.end();
    }

    if (code) {
        res.writeHead(302, { Location: `/?code=${encodeURIComponent(code)}` });
        return res.end();
    }

    res.writeHead(302, { Location: '/' });
    res.end();
}
