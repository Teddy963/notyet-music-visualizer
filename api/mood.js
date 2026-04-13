export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Allow user-provided key (for future "bring your own key" feature)
  // Falls back to the owner's server-side key
  const apiKey = req.headers['x-user-api-key'] || process.env.ANTHROPIC_KEY

  if (!apiKey) {
    return res.status(401).json({ error: 'No API key available' })
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(req.body),
    })

    const data = await upstream.json()
    return res.status(upstream.status).json(data)
  } catch (e) {
    return res.status(500).json({ error: 'Upstream request failed' })
  }
}
