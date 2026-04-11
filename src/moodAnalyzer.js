const API_KEY = import.meta.env.VITE_ANTHROPIC_KEY
console.log('[mood] key loaded:', API_KEY ? API_KEY.slice(0,12) + '...' : 'MISSING')

// Ask Claude to tag each lyric line with visual mood parameters
export async function analyzeLyrics(trackName, artist, lines) {
  if (!API_KEY || !lines?.length) return null

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
    "shape": "standing" // human pose silhouette
  }
]

Shape values (pick the one that best matches the lyric's emotional/physical energy):
- "standing"    — neutral, present, grounded
- "running"     — urgency, movement, escape, pursuit
- "falling"     — loss, surrender, despair, chaos
- "curled"      — vulnerability, grief, inward, hiding
- "reaching"    — longing, aspiration, connection, hope
- "dispersed"   — dissolution, freedom, release, openness
- "contracted"  — tension, fear, held breath, anticipation

Rules:
- Emotional/dark lines: low hue (200-280), low energy
- Intense/climax lines: high energy (0.8-1.0), high spread
- Warm/love lines: hue 0-40 or 300-360, mid energy
- Cold/lonely lines: hue 180-240, low spread
- Upbeat/joyful: hue 40-120, high speed
- Return ONLY the JSON array, no explanation.`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4096,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!res.ok) { console.warn('[mood] API error', res.status); return null }

    const data = await res.json()
    const text = data.content?.[0]?.text ?? ''
    const json = text.match(/\[[\s\S]*\]/)
    if (!json) return null

    const tags = JSON.parse(json[0])
    // Map index → mood params
    const map = {}
    for (const t of tags) map[t.i] = t
    return map
  } catch (e) {
    console.warn('[mood] failed:', e)
    return null
  }
}
