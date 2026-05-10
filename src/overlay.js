// AR Detection Overlay
// All lyric keywords pre-placed invisibly at song start
// Active lyric line → matching nodes activate (light up + label)
// Beat → flash pulse across active nodes

// Pure vocal filler — always filtered
const STOPWORDS = new Set([
  'oh','ooh','mm','na','la','da','ah','uh','hmm','yeah','hey','woah','whoa','woo',
])

// Function words shown as tiny "attachment" nodes (connect to neighbors via edges)
// Articles, prepositions, aux verbs — no freq boost, always small
const ATTACH_WORDS = new Set([
  'a','an','the',
  'in','on','at','to','for','of','with','by','from','into','about','out','up','down','off',
  'and','or','but','nor','so',
  'is','are','was','were','be','been','being','have','has','had',
  'will','would','could','should','may','might','shall','can',
])

// Detect repeated-syllable vocal fillers: tata, lala, nana, haha, etc.
function isFiller(w) {
  if (w.length < 4) return false
  // Pattern: same 1-3 char chunk repeated (e.g. "tata", "lalala", "nana")
  for (let len = 1; len <= 3; len++) {
    const chunk = w.slice(0, len)
    if (chunk.length > 0 && w.split(chunk).every(s => s === '')) return true
    // Check if whole word is repetition of chunk
    if (w.length % len === 0 && w === chunk.repeat(w.length / len)) return true
  }
  return false
}

// Korean particles to strip from END of words (longest first to avoid partial matches)
// NOTE: '은'/'는' intentionally excluded — too ambiguous with verb endings (숨쉬는, 빛나는)
const KO_PARTICLES = [
  '에서도','으로서','에게서','이라는','이라고','라고','에서','까지','부터','이다','이야',
  '이랑','한테','에게','에도','으로','을','를','이','가','도','만','로',
  '에','의','와','과','야','랑',
]

// KO_ATTACH_WORDS: particles shown as nodes but with very low ring weight (like EN ATTACH_WORDS)
const KO_ATTACH_WORDS = new Set(KO_PARTICLES)

function stripKoParticle(word) {
  for (const p of KO_PARTICLES) {
    if (word.endsWith(p) && word.length > p.length)
      return [word.slice(0, word.length - p.length), p]
  }
  return [word, null]
}

// Pronouns & light function words — kept in map but always small (no freq boost)
const CONNECTOR_WORDS = new Set([
  'i','me','my','you','your','we','our','he','she','his','her','it','its',
  'they','them','their','this','that','not','no','so','if','up','go',
  'do','does','did','am',
  '나','너','우리','저','나를','너를','내가','네가','그가','그녀',
])

function tokenize(text) {
  const out = []
  for (const raw of text.split(/\s+/)) {
    const isKorean = /[가-힣]/.test(raw)
    let processRaw = raw
    if (!isKorean && raw.includes('-')) {
      const parts = raw.split('-').map(p => p.replace(/[^a-zA-Z']/g, '')).filter(p => p.length >= 1)
      if (parts.length >= 2) processRaw = parts[parts.length - 1]
    }
    let cleaned
    if (isKorean) {
      ;[cleaned] = stripKoParticle(raw.replace(/[^가-힣]/g, ''))
    } else {
      cleaned = processRaw.replace(/[^a-zA-Z']/g, '').toLowerCase()
    }
    if (cleaned.length < 1) continue
    if (cleaned.length < 2 && !CONNECTOR_WORDS.has(cleaned) && !isKorean) {
      if (!/^[A-Z]$/.test(raw.replace(/[^a-zA-Z]/g, ''))) continue
    }
    if (isKorean ? KO_STOPWORDS.has(cleaned) : STOPWORDS.has(cleaned)) continue
    if (!isKorean && isFiller(cleaned)) continue
    out.push(cleaned)
  }
  return out
}


// KO_STOPWORDS: purely meaningless filler (particles now handled as KO_ATTACH_WORDS nodes)
const KO_STOPWORDS = new Set([])

// HSL ↔ RGB helpers
function hslToRgb(h, s, l) {
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q
  const hue = (p, q, t) => {
    if (t < 0) t++; if (t > 1) t--
    if (t < 1/6) return p + (q - p) * 6 * t
    if (t < 1/2) return q
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6
    return p
  }
  return [hue(p,q,h+1/3), hue(p,q,h), hue(p,q,h-1/3)]
}


// SLERP between two points on the sphere surface
// Returns intermediate point at parameter t ∈ [0,1]
function slerpSphere(ax, ay, az, bx, by, bz, t) {
  const la = Math.sqrt(ax*ax + ay*ay + az*az) || 1
  const lb = Math.sqrt(bx*bx + by*by + bz*bz) || 1
  const anx = ax/la, any = ay/la, anz = az/la
  const bnx = bx/lb, bny = by/lb, bnz = bz/lb
  const dot = Math.min(1, Math.max(-1, anx*bnx + any*bny + anz*bnz))
  const omega = Math.acos(dot)
  if (omega < 0.001) {
    return [ax + t*(bx-ax), ay + t*(by-ay), az + t*(bz-az)]
  }
  const so = Math.sin(omega)
  const fa = Math.sin((1-t)*omega) / so
  const fb = Math.sin(t*omega) / so
  const r = (la + lb) * 0.5   // average radius
  return [(anx*fa + bnx*fb)*r, (any*fa + bny*fb)*r, (anz*fa + bnz*fb)*r]
}

// Stable deterministic hash → [0, 1)
function wordHash(word, salt = 0) {
  let h = salt * 0x9e3779b9
  for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) & 0xffffff
  // Extra mixing pass to spread short-word clusters
  h = ((h ^ (h >>> 13)) * 0x85ebca6b) & 0xffffff
  return h / 0xffffff
}

export class DataOverlay {
  constructor(container) {
    this.canvas = document.createElement('canvas')
    this.canvas.id = 'ar-overlay'
    this.canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:6;mix-blend-mode:screen;'
    container.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')

    this.time        = 0
    this._trackCode  = ''
    this._beatFlash  = 0
    this._edgeGlitch = 0   // 0→1, decays; drives line displacement magnitude
    this._sweepT     = 0   // radar sweep position 0→1 (left to right)

    // Color — smooth lerp toward target, overridden by mood when available
    this._cr = 255; this._cg = 40;  this._cb = 40   // current (lerped)
    this._tr = 255; this._tg = 40;  this._tb = 40   // target
    this._moodColor = false   // true = mood override active, ignore setColor

    // Pre-placed detection nodes (all keywords from song)
    // { word, x, y, type, size, rot, freq, state:'dormant'|'active', alpha, activeTimer }
    this._nodes = []
    this._edges = []
    this._activeWords     = new Set()
    this._pendingKeywords = null
    this._lastActiveWords = null   // for re-activation after refine
    this._mapReveal       = 0
    this._mapPinned       = false

    // Accumulation rings — repeat lyric, centered on repeated word's node
    this._accumCircles = []
    this._accumTimer   = 0
    this._accumActive  = false
    this._accumNodeX   = 0
    this._accumNodeY   = 0
    this._accumNodeType = 'circle'  // 'circle' or 'box'

    // Cross-line continuity rings — word appears in both prev and current line
    this._prevLineTokens = new Set()
    this._lastLineWords  = null
    this._conShape       = 'circle'  // updated from mood

    // String / sustained-instrument wave lines
    this._stringPresence  = 0   // smoothed 0-1
    this._stringDots      = [] // traversing melody dots
    this._stringSpawnT    = 0  // spawn timer

    // Beat effects
    this._pings      = []   // A: sonar rings  — driven by bass/kick
    this._edgePulses = []   // B: edge signals — driven by treble (continuous)
    this._lockOns    = []   // C: brackets     — driven by beat + overall
    this._cascade    = null // D: net cascade  — driven by kick > threshold
    this._pulseCd    = 0    // B spawn cooldown
    this._cascadeCd  = 0    // D cooldown — prevent cascade every beat

    // Mood color chips — accumulate as mood hue changes per lyric line
    this._moodChips   = []   // [{r,g,b,born}]
    this._lastMoodHue = null

    // World rotation + camera pan (force-directed layout)
    this._worldAngle  = 0      // slow auto-rotation (radians)
    this._camX        = 0
    this._camY        = 0
    this._targetCamX  = 0
    this._targetCamY  = 0
    this._wordLine    = {}     // word → lyric line index

    // Drag-to-rotate state
    this._dragActive  = false
    this._dragLastX   = 0
    this._dragLastY   = 0
    this._dragVelX    = 0
    this._tiltAngle   = 0.28
    this._dragMoved   = false   // distinguish click vs drag

    // Recommendation nodes
    this._recNodes    = []      // [{track, wx, wy, wz, x, y, hue, alpha}]
    this.onRecClick   = null    // callback(track) — set by main.js

    this._resize()
    this._initDrag()
    window.addEventListener('resize', () => {
      this._resize()
      this._rebuildPositions()
      this._accumCircles = []
      this._prevLineTokens = new Set()
    })
  }

  _initDrag() {
    // Canvas has pointer-events:none — listen on window instead
    // Skip if pointer is on a button/interactive element
    const isUI = e => e.target?.closest('button, a, input, [data-no-drag]') != null

    let _downX = 0, _downY = 0

    const onDown = e => {
      if (isUI(e)) return
      this._dragActive = true
      this._dragMoved  = false
      this._dragLastX  = e.clientX
      this._dragLastY  = e.clientY
      _downX = e.clientX; _downY = e.clientY
      this._dragVelX   = 0
    }
    const onMove = e => {
      if (!this._dragActive) return
      const dx = e.clientX - this._dragLastX
      const dy = e.clientY - this._dragLastY
      if (Math.abs(e.clientX - _downX) > 4 || Math.abs(e.clientY - _downY) > 4) this._dragMoved = true
      this._dragLastX = e.clientX
      this._dragLastY = e.clientY
      this._worldAngle += dx * 0.006
      // Cap velocity to prevent post-drag spinning lag
      this._dragVelX = Math.max(-1.2, Math.min(1.2, dx * 0.006 * 60))
      this._tiltAngle = Math.max(0, Math.min(0.8, this._tiltAngle + dy * 0.003))
    }
    const onUp = e => {
      if (!this._dragMoved && this._dragActive && !isUI(e)) {
        // Treat as click — check rec nodes
        this._handleClick(e.clientX, e.clientY)
      }
      this._dragActive = false
    }

    // Track hover position for rec node highlight
    window.addEventListener('pointermove', e => {
      this._hoverX = e.clientX
      this._hoverY = e.clientY
    })

    window.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup',   onUp)
  }

  _handleClick(cx, cy) {
    if (!this._recNodes.length || !this.onRecClick) return
    // Find closest rec node to click point
    let best = null, bestDist = Infinity
    for (const rn of this._recNodes) {
      if (rn.x == null) continue
      const d = Math.hypot(rn.x - cx, rn.y - cy)
      if (d < bestDist) { bestDist = d; best = rn }
    }
    const hitR = 40  // px hit radius
    if (best && bestDist < hitR) this.onRecClick(best.track)
  }

  setRecommendations(tracks) {
    if (!tracks?.length) { this._recNodes = []; return }
    const SR = (this._sphereR || 220) * 1.35  // slightly outside main sphere
    this._recNodes = tracks.slice(0, 7).map((track, i) => {
      const phi   = (i / tracks.length) * Math.PI * 2 + 0.4
      const theta = Math.PI * 0.5 + (Math.random() - 0.5) * 0.6  // near equator
      return {
        track,
        wx: SR * Math.sin(theta) * Math.cos(phi),
        wy: SR * Math.cos(theta),
        wz: SR * Math.sin(theta) * Math.sin(phi),
        hue: (i / tracks.length) * 360,
        alpha: 0,
        x: null, y: null,
        label: track.name.slice(0, 18) + (track.name.length > 18 ? '…' : ''),
        artist: track.artists?.[0]?.name ?? '',
      }
    })
  }

  _resize() {
    this.canvas.width  = window.innerWidth
    this.canvas.height = window.innerHeight
    this._buildGridCache()
  }

  _buildGridCache() {
    const w = window.innerWidth, h = window.innerHeight
    const cr = 232, cg = 175, cb = 0
    const MINOR = 20, MAJOR = 80, CROSS = 5
    const snap = v => Math.round(v) + 0.5

    if (!this._gridCanvas) {
      this._gridCanvas = document.createElement('canvas')
    }
    this._gridCanvas.width  = w
    this._gridCanvas.height = h
    const gc = this._gridCanvas.getContext('2d')
    gc.clearRect(0, 0, w, h)

    // Fine grid
    gc.lineWidth = 0.4
    gc.strokeStyle = `rgba(${cr},${cg},${cb},0.045)`
    gc.beginPath()
    for (let x = 0; x < w; x += MINOR) { gc.moveTo(snap(x), 0); gc.lineTo(snap(x), h) }
    for (let y = 0; y < h; y += MINOR) { gc.moveTo(0, snap(y)); gc.lineTo(w, snap(y)) }
    gc.stroke()

    // Major grid
    gc.lineWidth = 0.6
    gc.strokeStyle = `rgba(${cr},${cg},${cb},0.09)`
    gc.beginPath()
    for (let x = 0; x < w; x += MAJOR) { gc.moveTo(snap(x), 0); gc.lineTo(snap(x), h) }
    for (let y = 0; y < h; y += MAJOR) { gc.moveTo(0, snap(y)); gc.lineTo(w, snap(y)) }
    gc.stroke()

    // Registration crosshairs
    gc.lineWidth = 0.7
    gc.strokeStyle = `rgba(${cr},${cg},${cb},0.18)`
    for (let x = 0; x <= w; x += MAJOR) {
      for (let y = 0; y <= h; y += MAJOR) {
        gc.beginPath()
        gc.moveTo(snap(x) - CROSS, snap(y)); gc.lineTo(snap(x) + CROSS, snap(y))
        gc.moveTo(snap(x), snap(y) - CROSS); gc.lineTo(snap(x), snap(y) + CROSS)
        gc.stroke()
      }
    }
  }

  _rebuildPositions() {
    // World coords (wx, wy) are canvas-size independent — no rebuild needed.
    // Projection in update() recalculates x, y each frame from wx, wy.
  }

  // ── Called once per song ─────────────────────────────────────────────────────
  setLines(lines) {
    if (!lines?.length) return
    this._lines = lines
    const w = this.canvas.width, h = this.canvas.height
    const pad = 60

    // Collect hyphen buildup targets (pin-pin-pin-pinky → "pinky" gets boost)
    const buildupWords = new Set()
    for (const line of lines) {
      for (const raw of line.words.split(/\s+/)) {
        if (raw.includes('-')) {
          const parts = raw.split('-').map(p => p.replace(/[^a-zA-Z']/g, '').toLowerCase()).filter(p => p.length >= 2)
          if (parts.length >= 2) buildupWords.add(parts[parts.length - 1])
        }
      }
    }

    // Count all unique content words + build surface form map (root → first surface with particle)
    const freq = {}
    const surfaceMap = {}  // root → display surface form (e.g. "슬픔" → "슬픔에")
    for (const line of lines) {
      const seen = new Set()
      for (const raw of line.words.split(/\s+/)) {
        if (!/[가-힣]/.test(raw)) continue
        const rawKo = raw.replace(/[^가-힣]/g, '')
        const [root] = stripKoParticle(rawKo)
        if (root && root.length >= 2 && !surfaceMap[root]) surfaceMap[root] = rawKo
      }
      for (const t of tokenize(line.words)) {
        if (!seen.has(t)) { freq[t] = (freq[t] || 0) + 1; seen.add(t) }
      }
    }

    const sorted     = Object.entries(freq).sort((a, b) => b[1] - a[1])
    const maxFreq    = sorted[0]?.[1] ?? 1
    const titleWords = this._titleWords ?? new Set()

    this._nodes = sorted.map(([word, count], nodeIdx) => {
      const h3 = wordHash(word, 3), h4 = wordHash(word, 4)
      const isTitle = titleWords.has(word)
      const freqScale = Math.log2(count + 1) / Math.log2(maxFreq + 1)
      const size = 5 + h4 * 4 + freqScale * 28 + (isTitle ? 14 : 0)
      const type = h3 > 0.5 ? 'circle' : 'box'
      // Display: surface form with particle if Korean (e.g. "슬픔에"), else uppercase
      const surface = /[가-힣]/.test(word) ? (surfaceMap[word] ?? word) : word.toUpperCase()
      return {
        word, parts: [word], display: surface,
        x: w * 0.5, y: h * 0.5,
        type, size, rot: (h3 - 0.5) * 0.4, freq: count,
        isCore: isTitle || count >= Math.max(2, maxFreq * 0.35),
        isTitle, isConnector: false, isAttach: false,
        state: 'dormant', alpha: 0, activeTimer: 0,
        _nodeIdx: nodeIdx,
        hue: wordHash(word, 5) * 360,
      }
    })

    // ── Build edges → radial sphere layout ───────────────────────────────
    this._buildEdges(lines)
    this._computeRadialLayout()
  }

  // ── Rebuild edges from lines (shared by setLines + refineWithKeywords) ───
  _buildEdges(lines) {
    this._edges = []
    const wordToIdx = {}
    this._nodes.forEach((n, i) => {
      for (const p of n.parts) {
        if (!wordToIdx[p]) wordToIdx[p] = []
        wordToIdx[p].push(i)
      }
    })
    const edgeSet = new Set()
    const addEdge = (a, b, sameLine) => {
      if (a === b) return
      const key = a < b ? `${a}-${b}` : `${b}-${a}`
      if (!edgeSet.has(key)) {
        edgeSet.add(key)
        this._edges.push({ a, b, sameLine: !!sameLine })
      } else if (sameLine) {
        // Upgrade existing edge to sameLine if encountered again within a line
        const existing = this._edges.find(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))
        if (existing) existing.sameLine = true
      }
    }

    // Sequential window-3: connects consecutive words within each line
    // Bigram (i→i+1) + skip-gram (i→i+2) only — no full cliques
    const W = 3
    for (const line of lines) {
      const tokens = tokenize(line.words)
      const seen = new Set()
      const idxSeq = []
      for (const t of tokens) {
        for (const idx of (wordToIdx[t] || [])) {
          if (!seen.has(idx)) { seen.add(idx); idxSeq.push(idx) }
        }
      }
      for (let i = 0; i < idxSeq.length; i++)
        for (let j = i + 1; j < Math.min(idxSeq.length, i + W); j++)
          addEdge(idxSeq[i], idxSeq[j], true)  // all window-3 edges are same-line
    }
  }

  // ── Called when Claude mood analysis completes — boost keyword nodes ──────
  refineWithKeywords(moodMap) {
    if (!moodMap || !this._nodes.length) return

    // Collect Claude-identified keywords + their mood hues
    const kwSet = new Set()
    const kwHue = {}
    for (const mood of Object.values(moodMap)) {
      for (const kw of (mood.keywords || [])) {
        const clean = /[가-힣]/.test(kw)
          ? stripKoParticle(kw.replace(/[^가-힣]/g, ''))[0]
          : kw.toLowerCase().replace(/[^a-z']/g, '')
        if (clean.length >= 2) {
          kwSet.add(clean)
          if (mood.hue != null && kwHue[clean] == null) kwHue[clean] = mood.hue
        }
      }
    }
    if (!kwSet.size) return

    // Boost existing nodes that Claude identified — don't replace the list
    const maxFreq = Math.max(...this._nodes.map(n => n.freq))
    for (const n of this._nodes) {
      if (kwSet.has(n.word)) {
        n.isCore  = true
        n.size    = Math.max(n.size, 20 + (n.freq / maxFreq) * 30)
        n.alpha   = Math.max(n.alpha, 0.4)
        if (kwHue[n.word] != null) n.hue = kwHue[n.word]
      }
    }

    console.log('[overlay] boosted', kwSet.size, 'Claude keywords')
    if (this._lastActiveWords) this.setActiveLine(this._lastActiveWords)
  }

  setTrack(name) {
    let hash = 0
    for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff
    const sector = String(Math.floor(hash / 1000) % 100).padStart(2, '0')
    const id     = String(hash % 10000).padStart(4, '0')
    this._trackCode  = `SECTOR-${sector}-${id}`
    this._titleWords = new Set(tokenize(name))  // title words get max priority
    this._nodes = []
    this._edges = []
    this._activeWords = new Set()
  }

  // ── Per lyric line ───────────────────────────────────────────────────────────
  // Called every frame with visualizer accent — only apply when no mood override
  setColor(r, g, b) {
    if (!this._moodColor) { this._tr = r; this._tg = g; this._tb = b }
  }

  setLineMood(mood) {
    if (mood?.keywords?.length) this._pendingKeywords = mood.keywords
    if (mood?.hue != null) {
      // Convert mood hue → vivid RGB (sat 85%, lightness 55%)
      const [r, g, b] = hslToRgb(mood.hue / 360, Math.min(1, (mood.sat ?? 70) / 100 * 0.85 + 0.1), 0.55)
      this._tr = Math.round(r * 255)
      this._tg = Math.round(g * 255)
      this._tb = Math.round(b * 255)
      this._moodColor = true
      // Push color chip when hue changes meaningfully
      const hue = Math.round(mood.hue)
      if (this._lastMoodHue !== hue) {
        this._lastMoodHue = hue
        this._moodChips.push({ r: this._tr, g: this._tg, b: this._tb, born: 0, energy: mood.energy ?? 0.5 })
      }
    } else {
      this._moodColor = false  // fall back to visualizer accent
    }
    // Shape from mood: warm/high-energy → circle, cool/low-energy → box
    if (mood?.energy != null || mood?.hue != null) {
      const e = mood.energy ?? 0.5
      const h = mood.hue ?? 200
      const warm = (h <= 60 || h >= 300)
      this._conShape = (e >= 0.55 || warm) ? 'circle' : 'box'
    }
  }

  setMapPinned(v) { this._mapPinned = v }

  setSubtitle(text) { this._lastActiveWords = text; this.setActiveLine(text) }

  // factor 0-1: repeat intensity. line = raw lyric text to find repeated word's node.
  setRepeat(factor, line) {
    if (factor > 0 && !this._accumActive && line) {
      // Find the most-repeated word in this line
      const words = line.toLowerCase().replace(/[^a-z가-힣\s]/g, '').split(/\s+/).filter(w => w.length > 1)
      const freq = {}
      for (const w of words) freq[w] = (freq[w] || 0) + 1
      const repeated = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0]
      const node = repeated && this._nodes.find(n => n.word === repeated)
      if (node) {
        this._accumNodeX    = node.x
        this._accumNodeY    = node.y
        this._accumNodeType = node.type || 'circle'
        this._accumActive   = true
        this._accumTimer    = 0
      }
    }
    if (factor === 0 && this._accumActive) {
      this._accumActive = false
      this._accumCircles.forEach(c => { c.fading = true })
    }
  }

  clearAccumRings() {
    this._accumActive = false
    this._accumCircles.forEach(c => { c.fading = true })
  }

  setActiveLine(words) {
    if (!words) return

    // Deactivate previously active/neighbor nodes
    for (const n of this._nodes) {
      if (n.state === 'active' || n.state === 'neighbor') n.state = 'fading'
    }

    // Determine token set + per-token repeat count for this line
    this._pendingKeywords = null
    const lineTokens = tokenize(words)
    const tokenSet = new Set(lineTokens)

    // Cross-line continuity: detect words shared with previous line → spawn beat-driven rings
    if (words !== this._lastLineWords) {
      for (const t of lineTokens) {
        if (this._prevLineTokens.has(t)) {
          const node = this._nodes.find(n => n.word === t || n.parts.includes(t))
          if (node) {
            for (let i = 0; i < 3; i++) {
              this._accumCircles.push({
                x: node.x, y: node.y,
                r: node.size ?? 6,
                alpha: 0.75 - i * 0.18,
                delay: i * 0.22,
                beatDriven: true,
                shape: this._conShape,
                fading: false,
              })
            }
          }
        }
      }
      this._prevLineTokens = new Set(lineTokens)
      this._lastLineWords  = words
    }
    // Count repetitions per token (e.g. "love love love" → {love: 3})
    const repeatCount = {}
    for (const t of lineTokens) repeatCount[t] = (repeatCount[t] || 0) + 1

    // Activate matching nodes + their edge-connected neighbors (dimmer)
    const activeIdxs = new Set()
    this._nodes.forEach((n, i) => {
      const matches = n.parts.length > 1
        ? n.parts.some(p => tokenSet.has(p))
        : tokenSet.has(n.parts[0])
      if (matches) {
        n.state = 'active'; n.activeTimer = 0; n.alpha = 0
        activeIdxs.add(i)
        // Repeated word → emit extra expanding rings (staggered)
        const reps = repeatCount[n.word] || 1
        for (let r = 1; r < reps; r++) {
          const delay = r * 0.18
          this._pings.push({
            x: n.x, y: n.y,
            r: n.size,
            maxR: n.size + 40 + r * 20,
            spd: 35,
            alpha: 0.55 - r * 0.08,
            _delay: delay,
          })
        }
      }
    })
    // Pan camera toward active nodes' projected screen centroid
    const actNodes = this._nodes.filter(n => n.state === 'active')
    if (actNodes.length) {
      const rc = Math.cos(this._worldAngle), rs = Math.sin(this._worldAngle)
      // Rotate each node's world coords, take centroid of projected X/Y
      let sx = 0, sy = 0
      for (const n of actNodes) {
        sx += n.wx * rc + (n.wz||0) * rs
        sy += n.wy
      }
      this._targetCamX = sx / actNodes.length
      this._targetCamY = sy / actNodes.length
    }

    // Neighbors: activate at half brightness
    for (const edge of this._edges) {
      const aIsActive = activeIdxs.has(edge.a), bIsActive = activeIdxs.has(edge.b)
      if (aIsActive && !activeIdxs.has(edge.b)) {
        const nb = this._nodes[edge.b]
        if (nb && nb.state === 'dormant') { nb.state = 'neighbor'; nb.alpha = 0 }
      }
      if (bIsActive && !activeIdxs.has(edge.a)) {
        const na = this._nodes[edge.a]
        if (na && na.state === 'dormant') { na.state = 'neighbor'; na.alpha = 0 }
      }
    }
  }

  // ── Radial sphere layout ─────────────────────────────────────────────────
  // Nodes placed on a 3D sphere surface.
  // Frequency rank → radial ring (center = high freq, outer = low freq).
  // Sphere rotates around Y axis → different nodes come to front over time.
  // This produces the neuron / Spotify-globe visual.
  _computeRadialLayout() {
    const nodes = this._nodes
    const N = nodes.length
    if (!N) return

    // Sort by frequency (highest first = center)
    // Penalties: single-char Korean ×0.15, connector/function words ×0.20
    // Boost: song title words ×3.0 (always pull toward center)
    const titleWords = this._titleWords ?? new Set()
    const _effFreq = n => {
      if (KO_ATTACH_WORDS.has(n.word)) return n.freq * 0.20
      if (/^[가-힣]$/.test(n.word)) return n.freq * 0.15
      if (CONNECTOR_WORDS.has(n.word) || ATTACH_WORDS.has(n.word)) return n.freq * 0.20
      if (titleWords.has(n.word)) return n.freq * 3.0
      return n.freq
    }
    const sorted = [...nodes].sort((a, b) => _effFreq(b) - _effFreq(a))

    // Ring capacity: center=1, then grows outward (1,5,10,16,22,28,35...)
    const RING_CAPS = [1, 5, 10, 16, 22, 28, 35, 42]
    let ring = 0, ringCount = 0
    sorted.forEach(n => {
      const cap = RING_CAPS[Math.min(ring, RING_CAPS.length - 1)]
      if (ringCount >= cap) { ring++; ringCount = 0 }
      n._ring    = ring
      n._ringIdx = ringCount
      n._ringCap = RING_CAPS[Math.min(ring, RING_CAPS.length - 1)]
      ringCount++
    })
    const maxRing = Math.max(1, sorted[sorted.length - 1]._ring)
    this._maxRing = maxRing

    // Place nodes in 3D spherical coordinates
    // Ring 0 = north pole, outer rings → equator
    const SR = 220   // sphere radius (world units)
    this._sphereR = SR
    nodes.forEach(n => {
      const t     = n._ring / maxRing          // 0 = center, 1 = outer
      const theta = t * Math.PI * 0.85         // polar angle (0 = pole/center, π*0.85 ≈ equator)
      // Golden-angle azimuth within ring, offset per ring for organic spacing
      const phi   = (n._ringIdx / Math.max(1, n._ringCap)) * Math.PI * 2
                    + n._ring * 2.399          // 2.399 ≈ golden angle (radians)
      // Small jitter for organic look
      const jt    = (wordHash(n.word, 7) - 0.5) * 0.15
      const jp    = (wordHash(n.word, 8) - 0.5) * 0.25

      // Ring 0 = nucleus at sphere origin (0,0,0)
      // Perspective projects (0,0,0) → exact screen center regardless of rotation
      if (n._ring === 0) {
        n.wx = 0; n.wy = 0; n.wz = 0
      } else {
        n.wx = SR * Math.sin(theta + jt) * Math.cos(phi + jp)
        n.wy = SR * Math.cos(theta + jt)
        n.wz = SR * Math.sin(theta + jt) * Math.sin(phi + jp)
      }

      // Size decreases exponentially with ring — center big, outer tiny
      const RING_SIZES = [58, 32, 18, 11, 7, 5, 3]
      n.size = RING_SIZES[Math.min(n._ring, RING_SIZES.length - 1)]
      n.type = n._ring <= 1 ? 'circle'
             : wordHash(n.word, 3) > 0.55 ? 'circle' : 'box'
      // Hue: azimuth angle → rainbow around the sphere, slight ring-tint
      n.hue = 42  // AMBER LOCK — revert to: ((phi / (Math.PI * 2)) * 360 + n._ring * 20 + 360) % 360
    })

    // Word→line map (for camera targeting on lyric change)
    const lines = this._lines || []
    const wordLine = {}
    lines.forEach((line, li) => {
      for (const t of tokenize(line.words))
        if (wordLine[t] == null) wordLine[t] = li
    })
    this._wordLine = wordLine

    // Reset camera / rotation
    this._camX = 0; this._camY = 0
    this._targetCamX = 0; this._targetCamY = 0
    this._worldAngle = 0
  }

  // Spread nodes so they don't overlap, then pull edge-connected nodes together
  _applyRepulsion() {
    const w   = this.canvas.width, h = this.canvas.height
    const pad = 60
    const nodes = this._nodes
    const n = nodes.length
    if (n < 2) return

    // Phase 1: repulsion
    for (let iter = 0; iter < 160; iter++) {
      for (let i = 0; i < n; i++) {
        const a = nodes[i]
        for (let j = i + 1; j < n; j++) {
          const b    = nodes[j]
          const dx   = b.x - a.x
          const dy   = b.y - a.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.1
          const min  = a.size + b.size + 20
          if (dist >= min) continue
          const push = (min - dist) / min * 0.5
          const fx   = (dx / dist) * push * min * 0.5
          const fy   = (dy / dist) * push * min * 0.5
          a.x -= fx;  a.y -= fy
          b.x += fx;  b.y += fy
        }
        a.x = Math.max(pad + a.size, Math.min(w - pad - a.size, a.x))
        a.y = Math.max(pad + a.size, Math.min(h - pad - a.size, a.y))
      }
    }

    // Phase 2: spring attraction — pull edge-connected nodes closer
    // Target edge length scales with node sizes so clusters are tighter for small nodes
    const TARGET = 140
    for (let iter = 0; iter < 80; iter++) {
      for (const edge of this._edges) {
        const a = nodes[edge.a], b = nodes[edge.b]
        if (!a || !b) continue
        const dx   = b.x - a.x
        const dy   = b.y - a.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        if (dist > TARGET) {
          const f = (dist - TARGET) / dist * 0.10
          a.x += dx * f;  a.y += dy * f
          b.x -= dx * f;  b.y -= dy * f
        }
      }
      for (const a of nodes) {
        a.x = Math.max(pad + a.size, Math.min(w - pad - a.size, a.x))
        a.y = Math.max(pad + a.size, Math.min(h - pad - a.size, a.y))
      }
    }
  }

  // D: BFS cascade from active nodes through the network
  _triggerCascade(midEnergy) {
    const adj = {}
    for (const edge of this._edges) {
      ;(adj[edge.a] = adj[edge.a] || []).push(edge.b)
      ;(adj[edge.b] = adj[edge.b] || []).push(edge.a)
    }
    const activeIdxs = new Set()
    this._nodes.forEach((n, i) => { if (n.state === 'active') activeIdxs.add(i) })
    if (!activeIdxs.size) return

    const visited = new Set(activeIdxs)
    const levels  = [[...activeIdxs]]
    for (let l = 0; l < 1; l++) {
      const next = []
      for (const idx of levels[levels.length - 1])
        for (const nb of (adj[idx] || []))
          if (!visited.has(nb)) { visited.add(nb); next.push(nb) }
      if (next.length) levels.push(next); else break
    }

    const delay = 0.09 - midEnergy * 0.04  // mid↑ → faster cascade
    this._cascade = {
      timer: 0,
      waves: levels.map((idxs, i) => ({ idxs, delay: i * delay, fired: false, alpha: 0 })),
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  update(audio, delta) {
    this.time += delta

    // Smooth color lerp toward target
    const ls = 1 - Math.pow(0.01, delta)
    this._cr += (this._tr - this._cr) * ls
    this._cg += (this._tg - this._cg) * ls
    this._cb += (this._tb - this._cb) * ls
    const cr = 232, cg = 175, cb = 0  // AMBER LOCK — structural layer (wireframe, HUD)
    // Active layer — mood color, lerped per lyric line
    const acr = Math.round(this._cr), acg = Math.round(this._cg), acb = Math.round(this._cb)
    // Dormant nodes — amber tinted toward mood (60% amber, 40% mood)
    const dcr = Math.round(cr * 0.60 + acr * 0.40)
    const dcg = Math.round(cg * 0.60 + acg * 0.40)
    const dcb = Math.round(cb * 0.60 + acb * 0.40)

    const { ctx } = this
    const w = this.canvas.width, h = this.canvas.height
    const cx = w * 0.5
    // Pixel snap helper — aligns to half-pixel so 1px strokes fall on exact pixel rows
    const px = v => Math.round(v) + 0.5
    const overall = audio.overall ?? 0
    const bass    = audio.bass    ?? audio.kick ?? 0
    const treble  = audio.treble  ?? audio.texture ?? 0
    const mid     = audio.mid     ?? audio.melody  ?? 0
    const kick    = audio.kick    ?? bass
    const beat    = audio.beat    ?? false

    // ── Beat effect spawning ─────────────────────────────────────────────
    this._cascadeCd -= delta
    if (beat) {
      this._beatFlash  = 1.0
      // Edge glitch: strong bass/kick = bigger displacement, lasts ~2-4 frames
      if (kick > 0.4 || bass > 0.55)
        this._edgeGlitch = Math.min(1, 0.5 + kick * 0.7 + bass * 0.4)

      const activeNodes = this._nodes.filter(n => n.state === 'active')

      // A: Sonar ping — max 1 node (core first)
      const pingCandidates = [...activeNodes].sort((a, b) => (b.isCore ? 1 : 0) - (a.isCore ? 1 : 0))
      for (const n of pingCandidates.slice(0, 1)) {
        this._pings.push({
          x: n.x, y: n.y,
          r: n.size * 0.8,
          maxR: 60 + bass * 120,
          spd: 50 + bass * 90,
          alpha: 0.5 + bass * 0.3,
        })
      }

      // C: Lock-on bracket — only 1, on strongest core node
      const lockTarget = activeNodes.find(n => n.isCore) ?? activeNodes[0]
      if (lockTarget && overall > 0.25) {
        this._lockOns.push({
          x: lockTarget.x, y: lockTarget.y,
          r:  lockTarget.size * (1.6 + overall * 0.6),
          tr: lockTarget.size,
          alpha: 0.75 + overall * 0.2,
        })
      }

      // D: Cascade only on strong kick, 3s cooldown
      if (kick > 0.55 && this._cascadeCd <= 0) {
        this._triggerCascade(mid)
        this._cascadeCd = 3.0
      }
    }
    this._beatFlash  *= Math.pow(0.80, delta * 60)
    this._edgeGlitch *= Math.pow(0.55, delta * 60)  // fast decay: gone in ~3-4 frames

    // B: Edge signal pulses — slower rate
    this._pulseCd -= delta
    if (this._pulseCd <= 0 && this._edges.length > 0) {
      const activeEdges = this._edges.filter(e => {
        const na = this._nodes[e.a], nb = this._nodes[e.b]
        return na && nb && (na.state === 'active' || nb.state === 'active')
      })
      if (activeEdges.length > 0) {
        const e  = activeEdges[Math.floor(Math.random() * activeEdges.length)]
        const na = this._nodes[e.a], nb = this._nodes[e.b]
        const fwd = na.state === 'active' || nb.state !== 'active'
        this._edgePulses.push({
          ax: fwd ? na.x : nb.x, ay: fwd ? na.y : nb.y,
          bx: fwd ? nb.x : na.x, by: fwd ? nb.y : na.y,
          t: 0, speed: 0.45 + treble * 1.0,
        })
        this._pulseCd = Math.max(0.8, 1.2 - treble * 0.4)  // min 0.8s gap
      }
    }

    // Map reveal
    const targetReveal = this._mapPinned ? 1.0 : 0
    this._mapReveal += ((targetReveal - this._mapReveal) * Math.min(1, delta * 4))
    const revealMult = 1 + this._mapReveal * 8



    // ── 3D globe: Y-rotation + X-tilt + perspective projection ──────────
    {
      if (!this._dragActive) {
        // Inertia decay
        this._dragVelX *= Math.pow(0.88, delta * 60)
        this._worldAngle += this._dragVelX * delta

        // Auto-focus: rotate toward the lowest-ring active node (ring>0)
        // Ring 0 is always center — use ring 1+ active node as focus target
        const focusNode = this._nodes
          .filter(n => n.state === 'active' && (n._ring ?? 99) > 0 && n.wx != null)
          .sort((a, b) => (a._ring ?? 99) - (b._ring ?? 99))[0]

        const velMag = Math.abs(this._dragVelX)
        if (focusNode && velMag < 0.008) {
          // Angle that brings this node's XZ to the +Z front
          const targetAngle = Math.atan2(-focusNode.wx, focusNode.wz || 0.001)
          // Shortest-path angular delta
          let da = targetAngle - this._worldAngle
          while (da >  Math.PI) da -= Math.PI * 2
          while (da < -Math.PI) da += Math.PI * 2
          // Gentle lerp — only when inertia is negligible
          const focusStrength = Math.max(0, 1 - velMag / 0.008)
          this._worldAngle += da * Math.min(1, delta * 0.8 * focusStrength)

          // Auto-tilt: rotate X axis so active node centroid lands near vertical center
          const activeForTilt = this._nodes.filter(n => n.state === 'active' && n.wx != null && (n._ring ?? 99) > 0)
          if (activeForTilt.length > 0) {
            const avgWY = activeForTilt.reduce((sum, n) => sum + n.wy, 0) / activeForTilt.length
            const tiltTarget = Math.atan2(avgWY, this._sphereR || 220)
            const clampedTilt = Math.max(0, Math.min(0.75, tiltTarget))
            this._tiltAngle += (clampedTilt - this._tiltAngle) * Math.min(1, delta * 0.6 * focusStrength)
          }
        } else if (!focusNode) {
          // No active node — slow drift
          this._worldAngle += delta * 0.020
        }
      } else {
        this._dragVelX *= Math.pow(0.88, delta * 60)
      }

      const TILT  = this._tiltAngle ?? 0.28    // user-controlled X-axis tilt
      const rawR  = this._sphereR || 220
      const SR    = Math.min(w, h) * 0.38      // sphere radius in screen units
      const s     = SR / rawR                  // world→screen scale
      const FOCAL = SR * 2.4                   // camera Z distance (perspective strength)

      const rc = Math.cos(this._worldAngle), rs = Math.sin(this._worldAngle)
      const ct = Math.cos(TILT), st = Math.sin(TILT)
      // Store projection params for curved edge drawing
      this._pp = { rc, rs, ct, st, SR, s, FOCAL, w, h }

      for (const n of this._nodes) {
        if (n.wx == null) { n._projAlpha = 0; n._projScale = 0; continue }
        // 1. Y-axis rotation
        const rx0 = (n.wx * rc + (n.wz||0) * rs) * s
        const ry0 =  n.wy * s
        const rz0 = (-n.wx * rs + (n.wz||0) * rc) * s
        // 2. X-axis tilt (rotate around X)
        const rx  = rx0
        const ry  = ry0 * ct - rz0 * st
        const rz  = ry0 * st + rz0 * ct
        // 3. Perspective projection: camera at (0,0,+FOCAL), looking toward -Z
        //    Nodes with high rz are closest to camera → appear larger
        const dz  = Math.max(0.1, FOCAL - rz)   // distance: camera to node
        const p   = FOCAL / dz                  // perspective scale (>1 = front, <1 = back)
        n.x = w * 0.5 + rx * p
        n.y = h * 0.5 + ry * p
        n._rz = rz   // store for depth sort
        // 4. Depth → alpha (back is almost invisible)
        const depth = (rz + SR) / (2 * SR)      // 0=back, 1=front
        n._projAlpha = Math.max(0.05, depth * 0.92 + 0.08)
        n._projScale = Math.max(0.18, p * 0.88)
      }

      // Depth sort: draw back nodes first so front nodes paint over them
      // Use a separate array — do NOT sort this._nodes in-place (edges use original indices)
      this._drawOrder = [...this._nodes].sort((a, b) => (a._rz||0) - (b._rz||0))

      // Project rec nodes with same pipeline (they sit on a larger shell)
      for (const rn of this._recNodes) {
        const rx0 = (rn.wx * rc + rn.wz * rs) * s
        const ry0 =  rn.wy * s
        const rz0 = (-rn.wx * rs + rn.wz * rc) * s
        const ry  = ry0 * ct - rz0 * st
        const rz  = ry0 * st + rz0 * ct
        const dz  = Math.max(0.1, FOCAL - rz)
        const p   = FOCAL / dz
        rn.x = w * 0.5 + rx0 * p
        rn.y = h * 0.5 + ry  * p
        rn._depth = (rz + SR * 1.35) / (2 * SR * 1.35)
        rn.alpha  = Math.min(1, rn.alpha + delta * 0.8)  // fade in
      }
    }

    // Phosphor persistence — fade previous frame instead of hard clear
    ctx.fillStyle = 'rgba(0,0,0,0.90)'
    ctx.fillRect(0, 0, w, h)

    // ── Blueprint grid — pre-baked offscreen, single drawImage per frame ──
    if (this._gridCanvas) ctx.drawImage(this._gridCanvas, 0, 0)

    // ── Horizontal scan line ─────────────────────────────────────────────
    const scanY = ((this.time * 0.09) % 1.05) * h
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.04)`
    ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(0, scanY); ctx.lineTo(w, scanY); ctx.stroke()

    // ── Radar sweep — vertical beam traversing sphere L→R→L ─────────────
    {
      const SWEEP_SPEED = 0.06  // full cycle every ~16s
      this._sweepT = (this._sweepT + delta * SWEEP_SPEED) % 2
      const t = this._sweepT < 1 ? this._sweepT : 2 - this._sweepT  // ping-pong 0→1→0
      const pp2 = this._pp
      if (pp2) {
        const { SR, w: pw, h: ph } = pp2
        const cx2 = pw * 0.5, cy2 = ph * 0.5
        const sweepX = cx2 + (t * 2 - 1) * SR
        const halfH  = Math.sqrt(Math.max(0, SR * SR - (sweepX - cx2) ** 2))
        ctx.strokeStyle = `rgba(${acr},${acg},${acb},${0.07 + overall * 0.03})`
        ctx.lineWidth   = 0.8
        ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(px(sweepX), cy2 - halfH)
        ctx.lineTo(px(sweepX), cy2 + halfH)
        ctx.stroke()
      }
    }

    // ── Network edges — SLERP curved arcs along sphere surface ───────────
    const pp = this._pp
    if (pp) {
      const { rc, rs, ct, st, SR, s, FOCAL, w: pw, h: ph } = pp
      // Project a world point through the same pipeline as nodes
      const proj = (wx, wy, wz) => {
        const rx0 = (wx * rc + wz * rs) * s
        const ry0 =  wy * s
        const rz0 = (-wx * rs + wz * rc) * s
        const rx  = rx0
        const ry  = ry0 * ct - rz0 * st
        const rz  = ry0 * st + rz0 * ct
        const dz  = Math.max(0.1, FOCAL - rz)
        const p   = FOCAL / dz
        return { x: pw*0.5 + rx*p, y: ph*0.5 + ry*p, depth: (rz + SR)/(2*SR) }
      }

      for (const edge of this._edges) {
        const na = this._nodes[edge.a], nb = this._nodes[edge.b]
        if (!na || !nb || na.wx == null || nb.wx == null) continue

        const aActive = na.state === 'active', bActive = nb.state === 'active'
        const bothActive   = aActive && bActive
        const eitherActive = aActive || bActive

        let alpha, lw
        if (bothActive)        { alpha = 0.95; lw = 1.8 }
        else if (eitherActive) { alpha = 0.55; lw = 1.1 }
        else                   { alpha = 0.18 + this._mapReveal * 0.12; lw = 0.75 }

        // CRT phosphor bloom on active edges, flat on dormant
        if (bothActive) {
          ctx.shadowBlur  = 5 + this._beatFlash * 10
          ctx.shadowColor = `rgba(${acr},${acg},${acb},0.75)`
        } else if (eitherActive) {
          ctx.shadowBlur  = 2
          ctx.shadowColor = `rgba(${acr},${acg},${acb},0.4)`
        } else {
          ctx.shadowBlur = 0
        }

        ctx.lineWidth = lw

        // Active: mood color. Dormant: amber
        const er = eitherActive ? acr : cr
        const eg = eitherActive ? acg : cg
        const eb = eitherActive ? acb : cb
        const segColor = (t, depth) => {
          const a = alpha * (depth * (edge.sameLine ? 0.88 : 0.75) + 0.06)
          return `rgba(${er},${eg},${eb},${a})`
        }

        // Ring 0 is at origin — SLERP undefined; draw straight line to center
        const aIsOrigin = (na._ring === 0), bIsOrigin = (nb._ring === 0)
        if (aIsOrigin || bIsOrigin) {
          const midDepth = ((na._projAlpha ?? 1) + (nb._projAlpha ?? 1)) / 2
          ctx.strokeStyle = segColor(0.5, midDepth)
          // Glitch: snap mid-point for center-spoke edges
          const glitchMag0 = this._edgeGlitch
          const mx = (na.x + nb.x) / 2, my = (na.y + nb.y) / 2
          if (glitchMag0 > 0.1 && eitherActive) {
            const seed = edge.a * 53 + edge.b * 29 + Math.floor(this.time * 8)
            const rng  = ((seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
            if (rng < glitchMag0 * 0.5) {
              const dx = (rng - 0.5) * glitchMag0 * 10
              const dy = (((seed ^ 0xdeadbeef) & 0xff) / 255 - 0.5) * glitchMag0 * 6
              ctx.beginPath(); ctx.moveTo(na.x, na.y); ctx.lineTo(mx + dx, my + dy)
              ctx.lineTo(nb.x, nb.y); ctx.stroke()
              continue
            }
          }
          ctx.beginPath(); ctx.moveTo(na.x, na.y); ctx.lineTo(nb.x, nb.y); ctx.stroke()
        } else {
          // SLERP along sphere surface: sample N intermediate points, project each
          const STEPS = eitherActive ? 12 : 7
          const pts = []
          for (let si = 0; si <= STEPS; si++) {
            const t  = si / STEPS
            const [ix, iy, iz] = slerpSphere(na.wx, na.wy, na.wz||0, nb.wx, nb.wy, nb.wz||0, t)
            pts.push({ ...proj(ix, iy, iz), t })
          }

          // Edge glitch: on strong beats, randomly snap a 1-3 segment run sideways
          const glitchMag = this._edgeGlitch
          let glitchRun = null
          if (glitchMag > 0.08 && eitherActive) {
            // Each edge independently decides whether to glitch this frame
            const seed = edge.a * 31 + edge.b * 17 + Math.floor(this.time * 8)
            const rng  = ((seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
            if (rng < glitchMag * 0.7) {
              const start = 1 + Math.floor(rng * (STEPS - 2))
              const len   = 1 + Math.floor((rng * 7919 % 1) * 3)
              const dx    = (((seed * 1664525 + 1013904223) & 0xff) / 255 - 0.5) * glitchMag * 12
              const dy    = (((seed * 214013  + 2531011)   & 0xff) / 255 - 0.5) * glitchMag * 5
              glitchRun   = { start, end: Math.min(STEPS, start + len), dx, dy }
            }
          }

          pts.forEach((pt, i) => {
            if (i === 0) return
            const prev = pts[i - 1]
            let px1 = prev.x, py1 = prev.y, px2 = pt.x, py2 = pt.y
            if (glitchRun && i >= glitchRun.start && i <= glitchRun.end) {
              px1 += glitchRun.dx; py1 += glitchRun.dy
              px2 += glitchRun.dx; py2 += glitchRun.dy
            }
            ctx.strokeStyle = segColor(pt.t, pt.depth)
            ctx.beginPath(); ctx.moveTo(px1, py1); ctx.lineTo(px2, py2); ctx.stroke()
          })
        }
      }
    }

    ctx.shadowBlur = 0

    // ── Sphere equator outline — single crisp ring (Pioneer plaque) ──────
    if (pp) {
      const { SR, w: pw, h: ph } = pp
      const scx = pw * 0.5, scy = ph * 0.5
      ctx.setLineDash([])
      ctx.lineWidth = 1.5
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${0.45 + this._beatFlash * 0.20})`
      ctx.beginPath(); ctx.arc(px(scx), px(scy), SR, 0, Math.PI * 2); ctx.stroke()
    }

    // ── Sphere wireframe — 4 latitude rings + 8 longitude lines + tick marks ──
    if (pp) {
      const { rc, rs, ct, st, SR, s, FOCAL, w: pw, h: ph } = pp
      const projWF = (wx, wy, wz) => {
        const rx0 = (wx * rc + wz * rs) * s
        const ry0 =  wy * s
        const rz0 = (-wx * rs + wz * rc) * s
        const ry  = ry0 * ct - rz0 * st
        const rz  = ry0 * st + rz0 * ct
        const dz  = Math.max(0.1, FOCAL - rz)
        const p   = FOCAL / dz
        return { x: pw*0.5 + rx0*p, y: ph*0.5 + ry*p, depth: (rz + SR)/(2*SR) }
      }

      const WF_BASE = 0.28 + this._mapReveal * 0.20

      // Latitude rings — 4 rings, dashed
      ctx.setLineDash([3, 7])
      ctx.lineWidth = 0.8
      const LAT_THETAS = [Math.PI*0.22, Math.PI*0.40, Math.PI*0.60, Math.PI*0.78]
      for (const theta of LAT_THETAS) {
        const rLat = Math.sin(theta), yLat = Math.cos(theta)
        const STEPS = 48
        let prev = null
        for (let i = 0; i <= STEPS; i++) {
          const phi = (i / STEPS) * Math.PI * 2
          const pt = projWF(SR * rLat * Math.cos(phi), SR * yLat, SR * rLat * Math.sin(phi))
          if (prev && pt.depth > 0.05) {
            ctx.strokeStyle = `rgba(${cr},${cg},${cb},${WF_BASE * pt.depth})`
            ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(pt.x, pt.y); ctx.stroke()
          }
          prev = pt
        }
      }

      // Longitude lines — 8 lines + tick marks (Pioneer plaque pulsar style)
      const LON_COUNT  = 8
      const STEPS_LON  = 28
      const TICK_EVERY = 5    // every ~32° of arc
      const TICK_LEN   = 3.0

      for (let li = 0; li < LON_COUNT; li++) {
        const phi = (li / LON_COUNT) * Math.PI * 2
        const pts = []
        for (let si = 0; si <= STEPS_LON; si++) {
          const theta = (si / STEPS_LON) * Math.PI
          pts.push(projWF(
            SR * Math.sin(theta) * Math.cos(phi),
            SR * Math.cos(theta),
            SR * Math.sin(theta) * Math.sin(phi)
          ))
        }

        // Longitude arc (dashed)
        ctx.setLineDash([3, 7])
        ctx.lineWidth = 0.8
        for (let si = 1; si <= STEPS_LON; si++) {
          const pt = pts[si], prev = pts[si - 1]
          if (pt.depth > 0.05) {
            ctx.strokeStyle = `rgba(${cr},${cg},${cb},${WF_BASE * pt.depth})`
            ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(pt.x, pt.y); ctx.stroke()
          }
        }

        // Tick marks — perpendicular to arc, Pioneer plaque style
        ctx.setLineDash([])
        ctx.lineWidth = 1.0
        for (let si = TICK_EVERY; si < STEPS_LON; si += TICK_EVERY) {
          const pt = pts[si], prv = pts[Math.max(0, si - 1)]
          if (pt.depth < 0.15) continue
          const tx = pt.x - prv.x, ty = pt.y - prv.y
          const len = Math.sqrt(tx*tx + ty*ty) || 1
          const nx = -ty / len * TICK_LEN, ny = tx / len * TICK_LEN
          ctx.strokeStyle = `rgba(${cr},${cg},${cb},${WF_BASE * pt.depth * 0.8})`
          ctx.beginPath()
          ctx.moveTo(pt.x - nx, pt.y - ny)
          ctx.lineTo(pt.x + nx, pt.y + ny)
          ctx.stroke()
        }
      }
      ctx.setLineDash([])
    }

    // ── B: Edge signal pulses ────────────────────────────────────────────
    for (let i = this._edgePulses.length - 1; i >= 0; i--) {
      const p = this._edgePulses[i]
      p.t += p.speed * delta
      if (p.t >= 1) { this._edgePulses.splice(i, 1); continue }
      const x = p.ax + (p.bx - p.ax) * p.t
      const y = p.ay + (p.by - p.ay) * p.t
      const a = Math.sin(p.t * Math.PI) * 0.9
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`
      ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill()
      // Faint trail behind
      const tx = p.ax + (p.bx - p.ax) * Math.max(0, p.t - 0.08)
      const ty = p.ay + (p.by - p.ay) * Math.max(0, p.t - 0.08)
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${a * 0.3})`
      ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(x, y); ctx.stroke()
    }

    // ── Detection nodes ──────────────────────────────────────────────────
    const drawNodes = this._drawOrder ?? this._nodes
    for (const n of drawNodes) {
      n.activeTimer += delta

      if (n.state === 'dormant') {
        // Brightness decreases by ring: center = always prominent, outer = barely visible
        const RING_ALPHA = [0.95, 0.78, 0.58, 0.38, 0.20, 0.11, 0.06]
        const target = RING_ALPHA[Math.min(n._ring ?? 6, RING_ALPHA.length - 1)]
        n.alpha += (target - n.alpha) * Math.min(1, delta * 1.8)
      } else if (n.state === 'active') {
        n.alpha = Math.min(0.92, n.alpha + delta * 4)
      } else if (n.state === 'neighbor') {
        n.alpha = Math.min(0.35, n.alpha + delta * 3)
      } else if (n.state === 'fading') {
        const floor = 0.04 + (n.size / 80) * 0.03
        n.alpha = Math.max(floor, n.alpha - delta * 1.0)
        if (n.alpha <= 0.07) n.state = 'dormant'
      }

      const beatBoost = n.state === 'active' ? this._beatFlash * 0.35 : 0
      const projAlpha = n._projAlpha ?? 1
      const projScale = n._projScale ?? 1
      const isActive  = n.state === 'active'
      const isHub     = (n._ring ?? 99) <= 1   // ring 0,1 = hub nodes
      const a = Math.min(1, (n.alpha + beatBoost) * projAlpha)
      const showLabel = isActive || (isHub && a > 0.25) || (this._mapPinned && n.display)

      // Perspective-scaled draw size — hubs large, leaves tiny
      const drawSize = Math.max(1.5, n.size * projScale)

      const r3      = Math.max(1.5, drawSize * 0.55)
      const isCenter = (n._ring ?? 99) === 0
      const isMid    = (n._ring ?? 99) <= 3 && !isHub   // ring 2-3: middle layer

      // Back-facing tiny nodes → cheap dot (skip full render)
      if (!isActive && !isHub && projAlpha < 0.20 && drawSize < 5) {
        ctx.beginPath()
        ctx.arc(n.x, n.y, Math.max(1.2, r3 * 0.5), 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${a * 0.55})`
        ctx.fill()
        continue
      }

      // ── Node sizing — Pioneer plaque: generous, readable ─────────────────
      const dotR   = Math.max(1.5, r3 * (isActive ? 0.38 : isHub ? 0.32 : 0.25))
      const outerR = isActive ? Math.max(4.0, drawSize * 0.80) : Math.max(2.5, r3 * 1.0)

      // ── CRT Phosphor (active) vs Flat Engraved (dormant) ─────────────────
      const beatBoostGlow = this._beatFlash * 16

      if (isActive) {
        // Active: mood color CRT phosphor bloom
        ctx.shadowBlur  = 14 + drawSize * 0.6 + beatBoostGlow
        ctx.shadowColor = `rgba(${acr},${acg},${acb},0.95)`

        ctx.lineWidth   = 2.5
        ctx.strokeStyle = `rgba(${acr},${acg},${acb},${a})`
        ctx.beginPath(); ctx.arc(n.x, n.y, outerR, 0, Math.PI * 2); ctx.stroke()

        // Phosphor halo ring
        ctx.lineWidth   = 1.0
        ctx.shadowBlur  = 0
        ctx.strokeStyle = `rgba(${acr},${acg},${acb},${a * 0.20})`
        ctx.beginPath(); ctx.arc(n.x, n.y, outerR * 2.0, 0, Math.PI * 2); ctx.stroke()

        const dotBright  = Math.min(255, acr + 23)
        const dotBrightG = Math.min(255, acg + 38)
        ctx.fillStyle = `rgba(${dotBright},${dotBrightG},${acb},${a})`
        ctx.beginPath(); ctx.arc(n.x, n.y, dotR, 0, Math.PI * 2); ctx.fill()

      } else {
        // Dormant: flat crisp — Pioneer plaque style
        ctx.shadowBlur = 0
        // Depth fading reduced: back nodes still clearly readable
        const depthFactor = 0.12 + projAlpha * 0.88   // back ~12%, front ~100%
        const outlineAlpha = depthFactor * (isHub ? 0.90 : isMid ? 0.75 : 0.58)
        ctx.lineWidth   = isHub ? 1.6 : isMid ? 1.2 : 0.9
        ctx.strokeStyle = `rgba(${dcr},${dcg},${dcb},${outlineAlpha})`
        ctx.beginPath(); ctx.arc(n.x, n.y, outerR, 0, Math.PI * 2); ctx.stroke()

        const dotAlpha = depthFactor * (isHub ? 1.0 : isMid ? 0.82 : 0.65)
        ctx.fillStyle = `rgba(${dcr},${dcg},${dcb},${dotAlpha})`
        ctx.beginPath(); ctx.arc(n.x, n.y, dotR, 0, Math.PI * 2); ctx.fill()
      }

      // All node types: same circle rendering — box type no longer used
      if (showLabel) {
        if (isActive) {
            // Crosshair tick marks (short, outside ring)
            const ch = outerR + 5
            const ct = 4  // tick length
            ctx.globalAlpha = a * 0.55
            ctx.strokeStyle = `rgba(${acr},${acg},${acb},${a})`
            ctx.lineWidth = 1.4
            ctx.beginPath()
            ctx.moveTo(n.x - ch, n.y); ctx.lineTo(n.x - ch + ct, n.y)
            ctx.moveTo(n.x + ch - ct, n.y); ctx.lineTo(n.x + ch, n.y)
            ctx.moveTo(n.x, n.y - ch); ctx.lineTo(n.x, n.y - ch + ct)
            ctx.moveTo(n.x, n.y + ch - ct); ctx.lineTo(n.x, n.y + ch)
            ctx.stroke()
            ctx.globalAlpha = 1

            const goRight = n.x < w * 0.58
            const fz  = Math.max(8, 10 + Math.round(drawSize / 18))
            const dir = goRight ? 1 : -1
            const diagLen = 12 + drawSize * 0.3
            const horzLen = 28 + drawSize * 0.6
            const startX  = n.x + dir * outerR
            const midX    = startX + dir * diagLen
            const midY    = n.y - 10
            const endX    = midX + dir * horzLen
            ctx.lineWidth = 1.2; ctx.strokeStyle = `rgba(${acr},${acg},${acb},${a * 0.70})`
            ctx.beginPath()
            ctx.moveTo(startX, n.y)
            ctx.lineTo(midX, midY)
            ctx.lineTo(endX, midY)
            ctx.stroke()
            ctx.beginPath()
            ctx.moveTo(endX, midY - 3)
            ctx.lineTo(endX, midY + 3)
            ctx.stroke()
            ctx.font = `700 ${fz}px 'Space Mono', 'Noto Sans KR', monospace`
            ctx.fillStyle = `rgba(${acr},${acg},${acb},${a})`
            ctx.textAlign = goRight ? 'left' : 'right'
            ctx.fillText((n.display ?? n.word).toUpperCase(), endX + dir * 6, midY + fz * 0.36)
          } else {
            // ATC waypoint style — code right of symbol, vertically centered
            ctx.font = `400 7px 'Space Mono', 'Noto Sans KR', monospace`
            ctx.fillStyle = `rgba(${dcr},${dcg},${dcb},${a * 0.72})`
            ctx.textAlign = 'left'
            ctx.fillText((n.display ?? n.word).toUpperCase(), n.x + outerR + 3, n.y + 2.5)
          }
          ctx.textAlign = 'left'
        }
      ctx.shadowBlur = 0
    }

    // ── A: Sonar pings ───────────────────────────────────────────────────
    for (let i = this._pings.length - 1; i >= 0; i--) {
      const p = this._pings[i]
      if (p._delay > 0) { p._delay -= delta; continue }
      p.r     += p.spd * delta
      p.alpha -= delta * 1.6
      if (p.alpha <= 0 || p.r >= p.maxR) { this._pings.splice(i, 1); continue }
      ctx.strokeStyle = `rgba(${acr},${acg},${acb},${p.alpha * 0.65})`
      ctx.lineWidth   = 1.2 + bass * 1.8
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke()
    }

    // ── C: Lock-on brackets ──────────────────────────────────────────────
    for (let i = this._lockOns.length - 1; i >= 0; i--) {
      const lo = this._lockOns[i]
      lo.r    += (lo.tr - lo.r) * Math.min(1, delta * 10)
      lo.alpha -= delta * 2.8
      if (lo.alpha <= 0) { this._lockOns.splice(i, 1); continue }
      const s = lo.r, bl = s * 0.38
      ctx.strokeStyle = `rgba(${acr},${acg},${acb},${lo.alpha})`
      ctx.lineWidth   = 1.2
      for (const [sx, sy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
        const bx = lo.x + sx * s, by = lo.y + sy * s
        ctx.beginPath()
        ctx.moveTo(bx - sx * bl, by); ctx.lineTo(bx, by); ctx.lineTo(bx, by - sy * bl)
        ctx.stroke()
      }
    }

    // ── D: Network cascade ───────────────────────────────────────────────
    if (this._cascade) {
      this._cascade.timer += delta
      let allDone = true
      for (const wave of this._cascade.waves) {
        if (!wave.fired && this._cascade.timer >= wave.delay) {
          wave.fired = true; wave.alpha = 1.0
        }
        if (wave.fired && wave.alpha > 0) {
          wave.alpha = Math.max(0, wave.alpha - delta * 5)
          allDone = false
          const a = wave.alpha * 0.38
          ctx.lineWidth = 1.8
          for (const idx of wave.idxs) {
            const n = this._nodes[idx]
            if (!n) continue
            ctx.strokeStyle = `rgba(${cr},${cg},${cb},${a})`
            ctx.beginPath(); ctx.arc(n.x, n.y, n.size * 1.2, 0, Math.PI * 2); ctx.stroke()
          }
        } else if (!wave.fired) {
          allDone = false
        }
      }
      if (allDone) this._cascade = null
    }

    // ── Accumulation circles — centered on repeated word's node ─────────
    if (this._accumActive) {
      this._accumTimer -= delta
      if (this._accumTimer <= 0) {
        this._accumTimer = 1.1
        const count = this._accumCircles.filter(c => !c.fading).length
        this._accumCircles.push({
          x: this._accumNodeX, y: this._accumNodeY,
          r: 8, target: 24 + count * 38,
          alpha: 0.65, fading: false,
          shape: this._accumNodeType,
        })
      }
    }
    // Draw + animate accumulation circles
    this._accumCircles = this._accumCircles.filter(c => c.alpha > 0)
    for (const c of this._accumCircles) {
      if (c.delay > 0) { c.delay -= delta; continue }
      if (c.beatDriven) {
        // Beat-driven: expansion speed pulses with kick
        const spd = 42 + (audio.kick ?? 0) * 130
        c.r += delta * spd
        c.alpha = Math.max(0, c.alpha - delta * (0.18 + c.r * 0.0025))
      } else if (c.fading) {
        c.alpha -= delta * 2.5
        c.r     += delta * 200
      } else {
        c.r = Math.min(c.target, c.r + delta * 80)
      }
      if (c.alpha <= 0) continue
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${c.alpha * 0.8})`
      ctx.lineWidth   = 1.2
      if (c.shape === 'box') {
        const s = c.r * 1.8
        ctx.strokeRect(c.x - s * 0.5, c.y - s * 0.5, s, s)
      } else {
        ctx.beginPath()
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2)
        ctx.stroke()
      }
    }

    // ── String melody arcs — orbital curved trails (ref: constellation UI) ──
    const stringSignal = (audio.pad ?? 0) * 0.65 + (audio.texture ?? 0) * 0.35
    const stringTarget = stringSignal > 0.25 ? Math.min(1, (stringSignal - 0.25) * 4.0) : 0
    const presSpd = stringTarget > this._stringPresence ? 2.0 : 0.5
    this._stringPresence += (stringTarget - this._stringPresence) * Math.min(1, delta * presSpd)

    // Spawn
    if (this._stringPresence > 0.15) {
      this._stringSpawnT -= delta
      if (this._stringSpawnT <= 0) {
        // Spawn rate faster when energy is high
        const energy = overall + (audio.melody ?? 0) * 0.5
        this._stringSpawnT = Math.max(1.2, 3.5 - energy * 1.8) + Math.random() * 1.5

        // Pitch at spawn → initial y-bias for direction angle
        const pitchBias = 1 - ((audio.treble ?? 0) * 0.6 + (audio.mid ?? 0) * 0.4)
        // Aim roughly toward pitch height from opposite side, ±60° spread
        const baseAngle  = Math.atan2(pitchBias * h - h * 0.5, w * 0.5)
        const angle      = baseAngle + (Math.random() - 0.5) * Math.PI * 1.2

        // Speed scales with energy — faster on intense sections
        const spd  = 80 + energy * 90 + Math.random() * 50
        // Curvature: more dramatic on high melody/treble
        const angV = (Math.random() - 0.5) * (0.6 + (audio.melody ?? 0) * 0.8)

        const edge = Math.floor(Math.random() * 4)
        let sx, sy
        if      (edge === 0) { sx = -10;    sy = Math.random() * h }
        else if (edge === 1) { sx = Math.random() * w; sy = -10    }
        else if (edge === 2) { sx = w + 10; sy = Math.random() * h }
        else                 { sx = Math.random() * w; sy = h + 10  }
        this._stringDots.push({
          x: sx, y: sy,
          vx: Math.cos(angle) * spd,
          vy: Math.sin(angle) * spd,
          angV,
          trail: [], alpha: 0, life: 0,
          maxLife: 5.0 + Math.random() * 4.0,
        })
      }
    }

    // Update + draw
    this._stringDots = this._stringDots.filter(d => d.life < d.maxLife + 3)
    ctx.save()
    for (const d of this._stringDots) {
      d.life += delta

      // Rotate velocity vector → creates curved orbital arc
      const cos = Math.cos(d.angV * delta), sin = Math.sin(d.angV * delta)
      const nvx = d.vx * cos - d.vy * sin
      const nvy = d.vx * sin + d.vy * cos
      d.vx = nvx; d.vy = nvy
      d.x += d.vx * delta
      d.y += d.vy * delta

      d.trail.push({ x: d.x, y: d.y })
      if (d.trail.length > 500) d.trail.shift()

      // Fade in → sustain → fade out
      const lr = d.life / d.maxLife
      if (lr < 0.08)      d.alpha = Math.min(1, d.alpha + delta * 5)
      else if (lr > 0.75) d.alpha = Math.max(0, d.alpha - delta * 0.9)

      const a = d.alpha * this._stringPresence
      if (a < 0.005) continue

      // Arc trail — power curve: bright head, fades to invisible tail
      if (d.trail.length > 1) {
        const tLen    = d.trail.length
        const visible = Math.min(tLen, 380)
        for (let i = tLen - visible + 1; i < tLen; i++) {
          const t  = (i - (tLen - visible)) / visible  // 0=old 1=head
          const ta = a * Math.pow(t, 2.2) * 0.75
          if (ta < 0.006) continue
          ctx.strokeStyle = `rgba(${cr},${cg},${cb},${ta})`
          ctx.lineWidth   = 0.6 + t * 1.0
          ctx.beginPath()
          ctx.moveTo(d.trail[i - 1].x, d.trail[i - 1].y)
          ctx.lineTo(d.trail[i].x,     d.trail[i].y)
          ctx.stroke()
        }
      }

      // Head dot
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${a * 0.9})`
      ctx.beginPath()
      ctx.arc(d.x, d.y, 2.0, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()

    // ── Mood garden — top-left, 2 rows of dots, stacking right ─────────
    if (this._moodChips.length > 0) {
      const total  = this._moodChips.length
      const gap    = 14   // center-to-center spacing
      const baseX  = 24
      const baseY  = 22
      this._moodChips.forEach((chip, i) => {
        chip.born = Math.min(1, (chip.born || 0) + delta * 2.5)
        const isNewest = i === total - 1
        const ageFade  = 0.2 + (i / total) * 0.7
        const a        = ageFade * chip.born
        const col = Math.floor(i / 2)
        const row = i % 2
        const cx = baseX + col * gap
        const cy = baseY + row * gap
        const r  = 3.5 + (chip.energy ?? 0.5) * 3.0   // 3.5 – 6.5 px
        // Soft glow
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.2)
        grd.addColorStop(0, `rgba(${chip.r},${chip.g},${chip.b},${a * 0.35})`)
        grd.addColorStop(1, `rgba(${chip.r},${chip.g},${chip.b},0)`)
        ctx.beginPath(); ctx.arc(cx, cy, r * 2.2, 0, Math.PI * 2)
        ctx.fillStyle = grd; ctx.fill()
        // Solid dot
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${chip.r},${chip.g},${chip.b},${a})`
        ctx.fill()
        if (isNewest) {
          ctx.beginPath(); ctx.arc(cx, cy, r + 2.5, 0, Math.PI * 2)
          ctx.strokeStyle = `rgba(${chip.r},${chip.g},${chip.b},${a * 0.45})`
          ctx.lineWidth = 0.8; ctx.stroke()
        }
      })
    }

    // ── Recommendation nodes — outer shell, always visible ───────────────
    for (const rn of this._recNodes) {
      if (rn.x == null) continue
      rn.alpha = Math.min(0.92, rn.alpha + delta * 0.6)
      const depth = rn._depth ?? 0.5
      const a     = rn.alpha * (depth * 0.7 + 0.3)
      const H     = rn.hue
      const R     = 10   // fixed small radius

      // Hover detection — brighten if mouse nearby
      const hovered = this._hoverX != null && Math.hypot(rn.x - this._hoverX, rn.y - this._hoverY) < 36

      // Glow
      const glowR = R * (hovered ? 4.5 : 3.0)
      const grd   = ctx.createRadialGradient(rn.x, rn.y, 0, rn.x, rn.y, glowR)
      grd.addColorStop(0, `hsla(${H},85%,65%,${a * (hovered ? 0.9 : 0.5)})`)
      grd.addColorStop(1, `hsla(${H},80%,55%,0)`)
      ctx.beginPath(); ctx.arc(rn.x, rn.y, glowR, 0, Math.PI * 2)
      ctx.fillStyle = grd; ctx.fill()

      // Dashed ring (detector style)
      ctx.save()
      ctx.setLineDash([3, 4])
      ctx.strokeStyle = `hsla(${H},80%,65%,${a * (hovered ? 0.9 : 0.45)})`
      ctx.lineWidth   = 0.8
      ctx.beginPath(); ctx.arc(rn.x, rn.y, R + 4, 0, Math.PI * 2); ctx.stroke()
      ctx.setLineDash([])
      ctx.restore()

      // Core dot
      ctx.beginPath(); ctx.arc(rn.x, rn.y, R * 0.55, 0, Math.PI * 2)
      ctx.fillStyle = `hsla(${H},90%,70%,${a})`
      ctx.fill()

      // Label — track name + artist (always shown, monospace)
      const fz   = hovered ? 9 : 8
      const goRight = rn.x < w * 0.6
      const lx   = goRight ? rn.x + R + 8 : rn.x - R - 8
      ctx.font      = `300 ${fz}px 'Courier New', monospace`
      ctx.textAlign = goRight ? 'left' : 'right'
      ctx.fillStyle = `hsla(${H},70%,72%,${a * (hovered ? 1.0 : 0.7)})`
      ctx.fillText(rn.label, lx, rn.y - 2)
      ctx.fillStyle = `hsla(${H},50%,55%,${a * (hovered ? 0.7 : 0.4)})`
      ctx.font      = `300 7px 'Courier New', monospace`
      ctx.fillText(rn.artist, lx, rn.y + 9)

      // Click hint on hover
      if (hovered) {
        ctx.font      = `300 6px 'Courier New', monospace`
        ctx.fillStyle = `hsla(${H},60%,65%,${a * 0.55})`
        ctx.fillText('▶ PLAY', lx, rn.y + 19)
      }
    }

    // ── Corner brackets ──────────────────────────────────────────────────
    const pad = 16, blen = 16
    const bA = 0.50 + overall * 0.15 + this._beatFlash * 0.20
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${bA})`
    ctx.lineWidth = 1.5
    for (const [x, y, sx, sy] of [[pad,pad,1,1],[w-pad,pad,-1,1],[pad,h-pad,1,-1],[w-pad,h-pad,-1,-1]]) {
      ctx.beginPath()
      ctx.moveTo(px(x+sx*blen), px(y))
      ctx.lineTo(px(x), px(y))
      ctx.lineTo(px(x), px(y+sy*blen))
      ctx.stroke()
    }

    // ── HUD text (geo viz / Pioneer plaque data display style) ───────────
    const frame  = String(Math.floor(this.time * 30)).padStart(6, '0')
    const code   = this._trackCode || 'SECTOR-00-0000'
    const hA     = 0.55 + overall * 0.15
    const nodeN  = this._nodes.length
    const edgeN  = this._edges.length
    const actN   = this._nodes.filter(n => n.state === 'active').length

    ctx.font = `400 9px 'Space Mono', 'Courier New', monospace`

    // Top-left data block
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${hA})`
    ctx.textAlign = 'left'
    const tlLines = [
      `OBJ / ${code}`,
      `NODES  ${String(nodeN).padStart(4)}`,
      `EDGES  ${String(edgeN).padStart(4)}`,
      `ACTIVE ${String(actN).padStart(4)}`,
    ]
    tlLines.forEach((ln, i) => ctx.fillText(ln, pad + 4, pad + 14 + i * 13))

    // Bottom-left: frame + beat indicator
    const beatIndicator = (bass > 0.5) ? '◆' : (bass > 0.25) ? '◇' : '·'
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${hA})`
    ctx.fillText(`FRM  ${frame}`, pad + 4, h - pad - 16)
    ctx.fillText(`LVL  ${beatIndicator} ${Math.round(overall * 100).toString().padStart(3)}`, pad + 4, h - pad - 4)

    // Bottom-center: track code
    ctx.textAlign = 'center'
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${hA * 0.8})`
    ctx.fillText(code, cx, h - pad - 4)

    ctx.textAlign = 'left'
    ctx.shadowBlur = 0

  }

  destroy() { this.canvas.remove() }
}
