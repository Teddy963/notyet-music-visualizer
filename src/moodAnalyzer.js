// Ask Claude to tag each lyric line with visual mood parameters
export async function analyzeLyrics(trackName, artist, lines, userApiKey = null) {
  if (!lines?.length) return null

  const lyricsText = lines.map((l, i) => `${i}|${l.words}`).join('\n')

  const prompt = `You are a visual music director. Analyze these lyrics and assign visual mood parameters to each line.

Song: "${trackName}" by ${artist}

Lyrics (index|line):
${lyricsText}

Return a JSON array — one object per line in the same order:
[
  {
    "i": 0,
    "hue": 220,        // dominant color hue 0-360 (0=red, 60=yellow, 120=green, 180=cyan, 240=blue, 300=purple)
    "sat": 70,         // color saturation 30-100
    "energy": 0.6,     // visual intensity 0.0-1.0
    "spread": 0.5,     // particle spread/expansion 0.0-1.0 (0=contracted, 1=exploded)
    "speed": 0.5,      // motion speed 0.0-1.0
    "keywords": ["word1", "word2"]  // 1-3 words EXTRACTED DIRECTLY FROM THIS LINE — must appear verbatim in the line. Pick the most emotionally charged or visually evocative. Keep original language. Skip function words (the/a/and/i/to / 은/는/이/가/을/를/의/에/도). NEVER invent or summarize — only use words that exist in the line.
  }
]

Rules:
- Emotional/dark lines: low hue (200-280), low energy
- Intense/climax lines: high energy (0.8-1.0), high spread
- Warm/love lines: hue 0-40 or 300-360, mid energy
- Cold/lonely lines: hue 180-240, low spread
- Upbeat/joyful: hue 40-120, high speed
- Return ONLY the JSON array, no explanation.`

  try {
    const headers = { 'content-type': 'application/json' }
    if (userApiKey) headers['x-user-api-key'] = userApiKey

    const res = await fetch('/api/mood', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8192,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) {
      const errBody = await res.text().catch(() => '')
      console.warn('[mood] API error', res.status, errBody)
      return null
    }

    const data = await res.json()
    const text = data.content?.[0]?.text ?? ''
    const json = text.match(/\[[\s\S]*/)
    if (!json) return null

    let tags
    try {
      // Try full parse first
      const closed = json[0].match(/\[[\s\S]*\]/)
      tags = JSON.parse(closed ? closed[0] : json[0])
    } catch {
      // Truncated — recover complete objects up to last '},'
      const partial = json[0].replace(/,?\s*\{[^}]*$/, '') + ']'
      try { tags = JSON.parse(partial) } catch { return null }
    }
    // Map index → mood params
    const map = {}
    for (const t of tags) map[t.i] = t
    return map
  } catch (e) {
    console.warn('[mood] failed:', e)
    return null
  }
}
