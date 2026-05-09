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

function stripKoParticle(word) {
  for (const p of KO_PARTICLES) {
    if (word.endsWith(p) && word.length > p.length) return word.slice(0, word.length - p.length)
  }
  return word
}

// Pronouns & light function words — kept in map but always small (no freq boost)
const CONNECTOR_WORDS = new Set([
  'i','me','my','you','your','we','our','he','she','his','her','it','its',
  'they','them','their','this','that','not','no','so','if','up','go',
  'do','does','did','am',
  '나','너','우리','저','나를','너를','내가','네가','그가','그녀',
])

function tokenize(text) {
  return text.split(/\s+/).map(raw => {
    const isKorean = /[가-힣]/.test(raw)
    // Hyphen buildup rule: "pin-pin-pin-pinky" → use last segment only
    let processRaw = raw
    if (!isKorean && raw.includes('-')) {
      const parts = raw.split('-').map(p => p.replace(/[^a-zA-Z']/g, '')).filter(p => p.length >= 1)
      if (parts.length >= 2) processRaw = parts[parts.length - 1]
    }
    let cleaned = isKorean
      ? stripKoParticle(raw.replace(/[^가-힣]/g, ''))
      : processRaw.replace(/[^a-zA-Z']/g, '').toLowerCase()
    if (cleaned.length < 1) return null
    // Allow single-char: known connectors (e.g. "i") OR original uppercase letter (e.g. "D", "E")
    if (cleaned.length < 2 && !CONNECTOR_WORDS.has(cleaned)) {
      if (!isKorean && /^[A-Z]$/.test(raw.replace(/[^a-zA-Z]/g, ''))) { /* keep */ }
      else return null
    }
    if (isKorean ? KO_STOPWORDS.has(cleaned) : STOPWORDS.has(cleaned)) return null
    if (!isKorean && isFiller(cleaned)) return null
    return cleaned
  }).filter(Boolean)
}


// standalone KO_STOPWORDS kept for whole-word particle lines
const KO_STOPWORDS = new Set(['을','를','이','가','은','는','과','와','의','에','도','만','로','으로','에서','까지','부터'])

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

// ── Poincaré disk helpers ─────────────────────────────────────────────────
// Move `focus` to origin: T_focus(z) = (z - focus) / (1 - conj(focus)·z)
function poincareMobius(z, focus) {
  const [zx,zy] = z, [fx,fy] = focus
  const nx = zx-fx, ny = zy-fy
  const cdx = fx*zx + fy*zy, cdy = fx*zy - fy*zx
  const dx = 1-cdx, dy = -cdy
  const d2 = dx*dx + dy*dy || 1e-9
  return [(nx*dx + ny*dy)/d2, (ny*dx - nx*dy)/d2]
}
// Move localPos from parent-centered frame to world frame (inverse Möbius)
function poincareFromLocal(local, parent) {
  const [lx,ly] = local, [px,py] = parent
  const nx = lx+px, ny = ly+py
  const cdx = px*lx + py*ly, cdy = px*ly - py*lx
  const dx = 1+cdx, dy = cdy
  const d2 = dx*dx + dy*dy || 1e-9
  return [(nx*dx + ny*dy)/d2, (ny*dx - nx*dy)/d2]
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
    this.canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:6;'
    container.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')

    this.time        = 0
    this._trackCode  = ''
    this._beatFlash  = 0

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

    // Hyperbolic focus (Poincaré disk)
    this._focus       = [0, 0]
    this._targetFocus = [0, 0]
    this._stRoot      = 0
    this._stChildren  = {}

    this._resize()
    window.addEventListener('resize', () => {
      this._resize()
      this._rebuildPositions()
      // Clear in-flight rings — their coordinates are stale after resize
      this._accumCircles = []
      this._prevLineTokens = new Set()
    })
  }

  _resize() {
    this.canvas.width  = window.innerWidth
    this.canvas.height = window.innerHeight
  }

  _rebuildPositions() {
    const w = this.canvas.width, h = this.canvas.height
    const pad = 60
    this._nodes.forEach((n, nodeIdx) => {
      const idx = n._nodeIdx ?? nodeIdx
      const h1 = wordHash(n.word, 1), h2 = wordHash(n.word, 2)
      const gx = (idx * 0.618034) % 1
      const gy = (idx * 0.381966) % 1
      n.x = pad + (h1 * 0.45 + gx * 0.55) * (w - pad * 2)
      n.y = pad + (h2 * 0.45 + gy * 0.55) * (h - pad * 2)
    })
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

    // Count all unique content words
    const freq = {}
    for (const line of lines) {
      const seen = new Set()
      for (const t of tokenize(line.words)) {
        if (!seen.has(t)) { freq[t] = (freq[t] || 0) + 1; seen.add(t) }
      }
    }

    const sorted   = Object.entries(freq).sort((a, b) => b[1] - a[1])
    const maxFreq  = sorted[0]?.[1] ?? 1
    const coreThr  = Math.max(2, Math.ceil(maxFreq * 0.4))
    const titleWords = this._titleWords ?? new Set()

    const totalNodes = sorted.length
    this._nodes = sorted.map(([word, count], nodeIdx) => {
      const h1 = wordHash(word, 1), h2 = wordHash(word, 2)
      const h3 = wordHash(word, 3), h4 = wordHash(word, 4)
      const isConnector = CONNECTOR_WORDS.has(word)
      const isAttach    = ATTACH_WORDS.has(word)
      const isTitle     = titleWords.has(word)
      const isBuildup   = buildupWords.has(word)
      const isCore      = isTitle || isBuildup || (!isConnector && !isAttach && count >= coreThr)
      const type        = (isConnector || isAttach) ? 'circle' : (h3 > 0.45 ? 'circle' : 'box')
      const freqScale   = (isConnector || isAttach) ? 0 : Math.log2(count + 1) / Math.log2(maxFreq + 1)
      const baseSize    = isAttach ? 4 + h4 * 3
                        : isConnector ? 5 + h4 * 4
                        : 8 + h4 * 10
      const freqBoost   = freqScale * 36
      const titleBoost  = isTitle ? 18 + (count / maxFreq) * 20 : 0
      const buildupBoost = isBuildup ? 22 : 0
      // Golden ratio lattice blended with word hash — breaks char-set clustering
      const gx = (nodeIdx * 0.618034) % 1
      const gy = (nodeIdx * 0.381966) % 1
      const px = h1 * 0.45 + gx * 0.55
      const py = h2 * 0.45 + gy * 0.55
      return {
        word, parts: [word], display: word.toUpperCase(),
        x: pad + px * (w - pad * 2), y: pad + py * (h - pad * 2),
        type, size: baseSize + freqBoost + titleBoost + buildupBoost,
        rot: (h3 - 0.5) * 0.6, freq: count,
        isCore, isBigram: false, isConnector, isAttach, isTitle,
        state: 'dormant', alpha: isTitle ? 0.3 : 0, activeTimer: 0,
        _nodeIdx: nodeIdx,
        hue: wordHash(word, 5) * 360,
      }
    })

    // ── Build edges → hyperbolic layout ──────────────────────────────────
    this._buildEdges(lines)
    this._computeHyperbolicLayout()
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
    for (const line of lines) {
      const tokens = tokenize(line.words)
      const lineIdxs = new Set()
      for (const t of tokens)
        for (const idx of (wordToIdx[t] || [])) lineIdxs.add(idx)
      const arr = [...lineIdxs]
      for (let i = 0; i < arr.length; i++)
        for (let j = i + 1; j < arr.length; j++) {
          const a = arr[i], b = arr[j]
          const key = a < b ? `${a}-${b}` : `${b}-${a}`
          if (!edgeSet.has(key)) { edgeSet.add(key); this._edges.push({ a, b }) }
        }
    }
    if (this._edges.length > 55) {
      this._edges = this._edges
        .sort((e, f) => {
          const wa = (this._nodes[e.a].isCore?1:0) + (this._nodes[e.b].isCore?1:0)
          const wb = (this._nodes[f.a].isCore?1:0) + (this._nodes[f.b].isCore?1:0)
          return wb - wa
        }).slice(0, 55)
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
          ? stripKoParticle(kw.replace(/[^가-힣]/g, ''))
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
    // Update hyperbolic focus toward centroid of active nodes
    const actNodes = this._nodes.filter(n => n.state === 'active')
    if (actNodes.length) {
      const hcx = actNodes.reduce((s,n) => s + (n.hx||0), 0) / actNodes.length
      const hcy = actNodes.reduce((s,n) => s + (n.hy||0), 0) / actNodes.length
      const hl  = Math.sqrt(hcx*hcx + hcy*hcy)
      this._targetFocus = hl > 0.88 ? [hcx*0.88/hl, hcy*0.88/hl] : [hcx, hcy]
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

  // ── Hyperbolic layout ────────────────────────────────────────────────────
  _computeHyperbolicLayout() {
    const nodes = this._nodes
    if (!nodes.length) return

    // Spanning tree via BFS from highest-freq root
    const rootIdx = nodes.reduce((b, n, i) => n.freq > nodes[b].freq ? i : b, 0)
    const adj = {}
    for (const e of this._edges) {
      ;(adj[e.a] = adj[e.a] || []).push(e.b)
      ;(adj[e.b] = adj[e.b] || []).push(e.a)
    }
    const children = {}, visited = new Set([rootIdx]), queue = [rootIdx]
    while (queue.length) {
      const u = queue.shift()
      children[u] = children[u] || []
      for (const v of (adj[u] || [])) {
        if (!visited.has(v)) { visited.add(v); children[u].push(v); queue.push(v) }
      }
    }
    // Disconnected nodes → attach directly to root
    nodes.forEach((_, i) => {
      if (!visited.has(i)) { (children[rootIdx] = children[rootIdx] || []).push(i) }
    })
    this._stRoot = rootIdx; this._stChildren = children

    // Recursive hyperbolic placement
    const H_STEP = 0.72  // hyperbolic radius per level
    const place = (idx, pos, parentAngle, sectorSpan) => {
      nodes[idx].hx = pos[0]; nodes[idx].hy = pos[1]
      const kids = children[idx] || []
      if (!kids.length) return
      const r_euc = Math.tanh(H_STEP / 2)
      const span  = Math.min(sectorSpan * 0.92, Math.PI * 1.85)
      const start = parentAngle + Math.PI - span / 2
      kids.forEach((kid, k) => {
        const angle = start + (k + 0.5) * span / kids.length
        let cp = poincareFromLocal([r_euc * Math.cos(angle), r_euc * Math.sin(angle)], pos)
        const cl = Math.sqrt(cp[0]**2 + cp[1]**2)
        if (cl > 0.93) { cp = [cp[0]*0.93/cl, cp[1]*0.93/cl] }
        place(kid, cp, angle, span / kids.length)
      })
    }
    place(rootIdx, [0, 0], 0, Math.PI * 2)

    // Assign cluster hues — each root-child subtree gets a distinct hue
    const rootKids = children[rootIdx] || []
    const assignHue = (idx, hue) => {
      nodes[idx].hue = ((hue + (wordHash(nodes[idx].word, 9) - 0.5) * 35) + 360) % 360
      for (const c of (children[idx] || [])) assignHue(c, hue)
    }
    rootKids.forEach((ki, k) => assignHue(ki, (k / Math.max(1, rootKids.length)) * 360))
    nodes[rootIdx].hue = 55  // root = gold

    // Override node sizes: hub = larger, leaf = smaller square
    nodes.forEach((n, i) => {
      const isHub = i === rootIdx || rootKids.includes(i)
      n.size = isHub ? 14 + n.freq * 1.2 : 5 + n.freq * 0.4
      if (!isHub) n.type = 'box'  // leaf nodes → small squares like reference
    })

    this._focus = [0, 0]; this._targetFocus = [0, 0]
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
    const cr = Math.round(this._cr), cg = Math.round(this._cg), cb = Math.round(this._cb)

    const { ctx } = this
    const w = this.canvas.width, h = this.canvas.height
    const cx = w * 0.5
    const overall = audio.overall ?? 0
    const bass    = audio.bass    ?? audio.kick ?? 0
    const treble  = audio.treble  ?? audio.texture ?? 0
    const mid     = audio.mid     ?? audio.melody  ?? 0
    const kick    = audio.kick    ?? bass
    const beat    = audio.beat    ?? false

    // ── Beat effect spawning ─────────────────────────────────────────────
    this._cascadeCd -= delta
    if (beat) {
      this._beatFlash = 1.0

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
    this._beatFlash *= Math.pow(0.80, delta * 60)

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



    // ── Hyperbolic focus lerp + Möbius projection ────────────────────────
    {
      const ls = 1 - Math.pow(0.005, delta)
      this._focus[0] += (this._targetFocus[0] - this._focus[0]) * ls
      this._focus[1] += (this._targetFocus[1] - this._focus[1]) * ls
      const diskR = Math.min(w, h) * 0.43
      for (const n of this._nodes) {
        if (n.hx == null) { n._projAlpha = 0; continue }
        const [px, py] = poincareMobius([n.hx, n.hy], this._focus)
        n.x = w * 0.5 + px * diskR
        n.y = h * 0.5 + py * diskR
        const d = Math.sqrt(px*px + py*py)
        n._projScale = Math.max(0.25, 1.0 - d * 0.60)
        n._projAlpha = Math.max(0.10, 1.0 - d * 0.70)
      }
    }

    ctx.clearRect(0, 0, w, h)

    // ── Poincaré disk boundary + inner rings ─────────────────────────────
    {
      const diskR = Math.min(w, h) * 0.43
      ctx.lineWidth = 0.8
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.18)`
      ctx.beginPath(); ctx.arc(w*0.5, h*0.5, diskR, 0, Math.PI*2); ctx.stroke()
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.05)`
      ctx.lineWidth = 0.4
      ctx.beginPath(); ctx.arc(w*0.5, h*0.5, diskR*0.65, 0, Math.PI*2); ctx.stroke()
      ctx.beginPath(); ctx.arc(w*0.5, h*0.5, diskR*0.32, 0, Math.PI*2); ctx.stroke()
    }

    // ── Scan line ────────────────────────────────────────────────────────
    const scanY = ((this.time * 0.09) % 1.05) * h
    const sg = ctx.createLinearGradient(0, scanY - 20, 0, scanY + 4)
    sg.addColorStop(0, `rgba(${cr},${cg},${cb},0)`)
    sg.addColorStop(1, `rgba(${cr},${cg},${cb},0.055)`)
    ctx.fillStyle = sg
    ctx.fillRect(0, scanY - 20, w, 24)
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.13)`
    ctx.lineWidth = 0.5
    ctx.beginPath(); ctx.moveTo(0, scanY); ctx.lineTo(w, scanY); ctx.stroke()

    // ── Network edges ────────────────────────────────────────────────────
    for (const edge of this._edges) {
      const na = this._nodes[edge.a], nb = this._nodes[edge.b]
      if (!na || !nb) continue

      const aActive = na.state === 'active', bActive = nb.state === 'active'
      const bothActive   = aActive && bActive
      const eitherActive = aActive || bActive

      let a, lw
      if (bothActive)        { a = 0.70 + this._beatFlash * 0.2; lw = 1.2 }
      else if (eitherActive) { a = 0.28; lw = 0.7 }
      else                   { a = Math.min(0.40, 0.07 * revealMult); lw = 0.4 }

      // Blend the two endpoint node hues for edge color
      const [r1,g1,b1] = hslToRgb((na.hue ?? 0) / 360, eitherActive ? 0.75 : 0.55, eitherActive ? 0.62 : 0.52)
      const [r2,g2,b2] = hslToRgb((nb.hue ?? 0) / 360, eitherActive ? 0.75 : 0.55, eitherActive ? 0.62 : 0.52)
      const eR = Math.round((r1 + r2) / 2 * 255)
      const eG = Math.round((g1 + g2) / 2 * 255)
      const eB = Math.round((b1 + b2) / 2 * 255)

      ctx.strokeStyle = `rgba(${eR},${eG},${eB},${a})`
      ctx.lineWidth   = lw
      ctx.beginPath(); ctx.moveTo(na.x, na.y); ctx.lineTo(nb.x, nb.y); ctx.stroke()

      if (eitherActive) {
        const dx = nb.x - na.x, dy = nb.y - na.y
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const ux = dx / len, uy = dy / len
        const tip = nb.size + 4
        const ax = nb.x - ux * tip, ay = nb.y - uy * tip
        const px = -uy * 4
        ctx.fillStyle = `rgba(${eR},${eG},${eB},${a})`
        ctx.beginPath()
        ctx.moveTo(ax - ux * 8 + px, ay - uy * 8 - ux * 4)
        ctx.lineTo(ax, ay)
        ctx.lineTo(ax - ux * 8 - px, ay - uy * 8 + ux * 4)
        ctx.fill()
      }
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
    const drawNodes = this._nodes
    for (const n of drawNodes) {
      n.activeTimer += delta

      if (n.state === 'dormant') {
        const target = n.isTitle    ? 0.55
                     : n.isCore     ? 0.32
                     : n.isConnector? 0.16
                     : n.isAttach   ? 0.13
                     :                0.22
        n.alpha += (target - n.alpha) * Math.min(1, delta * 1.8)
      } else if (n.state === 'active') {
        n.alpha = Math.min(0.92, n.alpha + delta * 4)
      } else if (n.state === 'neighbor') {
        n.alpha = Math.min(0.35, n.alpha + delta * 3)
      } else if (n.state === 'fading') {
        const floor = (n.isConnector || n.isAttach) ? 0 : 0.04 + (n.size / 48) * 0.03
        n.alpha = Math.max(floor, n.alpha - delta * 1.0)
        if (n.alpha <= 0.07) n.state = 'dormant'
      }

      const beatBoost  = n.state === 'active' ? this._beatFlash * 0.30 : 0
      const projAlpha  = n._projAlpha ?? 1
      const projScale  = n._projScale ?? 1
      const a = Math.min(1, (n.alpha + beatBoost) * projAlpha)
      const isActive  = n.state === 'active'
      const showLabel = isActive || n.isTitle || (n.isCore && n.alpha > 0.15) || (this._mapPinned && n.display)

      // Per-node color from hue
      const nSat = (n.isConnector || n.isAttach) ? 0.20 : 0.82
      const nLit = isActive ? 0.70 : (n.isCore ? 0.58 : 0.48)
      const [nr, ng, nb_] = hslToRgb((n.hue ?? 0) / 360, nSat, nLit)
      const nR = Math.round(nr * 255), nG = Math.round(ng * 255), nB = Math.round(nb_ * 255)

      const drawSize = Math.max(2, n.size * projScale)
      ctx.lineWidth   = isActive ? 1.5 + (drawSize / 40) * 0.8 : (this._mapPinned ? 0.8 : 0.5)
      ctx.strokeStyle = `rgba(${nR},${nG},${nB},${a})`

      // Glow on active nodes
      if (isActive) {
        ctx.shadowBlur  = 10 + drawSize * 0.5
        ctx.shadowColor = `hsl(${n.hue ?? 0},85%,65%)`
      }

      if (n.type === 'circle') {
        ctx.beginPath(); ctx.arc(n.x, n.y, drawSize, 0, Math.PI * 2)
        // Fill: active = semi-fill, core = very faint fill
        if (isActive) {
          ctx.fillStyle = `rgba(${nR},${nG},${nB},${a * 0.16})`
          ctx.fill()
        } else if (n.isCore && n.alpha > 0.2) {
          ctx.fillStyle = `rgba(${nR},${nG},${nB},${a * 0.05})`
          ctx.fill()
        }
        ctx.stroke()
        if (isActive) { ctx.shadowBlur = 0 }

        if (showLabel) {
          if (isActive) {
            const ch = drawSize * 0.5
            ctx.globalAlpha = a * 0.45
            ctx.beginPath()
            ctx.moveTo(n.x - ch, n.y); ctx.lineTo(n.x + ch, n.y)
            ctx.moveTo(n.x, n.y - ch); ctx.lineTo(n.x, n.y + ch)
            ctx.stroke()
            ctx.globalAlpha = 1
            ctx.beginPath(); ctx.arc(n.x, n.y, 2, 0, Math.PI * 2)
            ctx.fillStyle = `rgba(${nR},${nG},${nB},${a})`; ctx.fill()

            const goRight = n.x < w * 0.62
            const fz  = Math.max(7, 9 + Math.round(drawSize / 12))
            const dir = goRight ? 1 : -1
            const ax  = goRight ? n.x + drawSize : n.x - drawSize
            const ex  = ax + dir * (28 + drawSize * 0.4)
            ctx.lineWidth = 0.9; ctx.strokeStyle = `rgba(${nR},${nG},${nB},${a * 0.7})`
            ctx.beginPath(); ctx.moveTo(ax, n.y); ctx.lineTo(ex, n.y); ctx.stroke()
            ctx.beginPath()
            ctx.moveTo(ex - dir * 7, n.y - 4); ctx.lineTo(ex, n.y); ctx.lineTo(ex - dir * 7, n.y + 4)
            ctx.stroke()
            ctx.font = `bold ${fz}px Arial, sans-serif`
            ctx.fillStyle = `rgba(${nR},${nG},${nB},${a})`
            ctx.textAlign = goRight ? 'left' : 'right'
            ctx.fillText(n.display, ex + dir * 6, n.y + fz * 0.38)
          } else {
            ctx.font = `300 9px 'Courier New', monospace`
            ctx.fillStyle = `rgba(${nR},${nG},${nB},${a})`
            ctx.textAlign = 'center'
            ctx.fillText(n.display, n.x, n.y + n.size + 12)
          }
          ctx.textAlign = 'left'
        }

      } else {
        ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(n.rot)
        const half = drawSize * 0.7, tall = drawSize * 1.1
        if (isActive) {
          ctx.fillStyle = `rgba(${nR},${nG},${nB},${a * 0.14})`
          ctx.fillRect(-half, -tall * 0.5, half * 2, tall)
        }
        ctx.strokeRect(-half, -tall * 0.5, half * 2, tall)
        ctx.restore()
        if (isActive) { ctx.shadowBlur = 0 }

        if (showLabel) {
          if (isActive) {
            const fz = Math.max(7, 9 + Math.round(drawSize / 14))
            ctx.font = `bold ${fz}px Arial, sans-serif`
            ctx.fillStyle = `rgba(${nR},${nG},${nB},${a})`
            ctx.textAlign = 'center'
            ctx.fillText(n.display, n.x, n.y + tall * 0.5 + fz + 4)
          } else {
            ctx.font = `300 9px 'Courier New', monospace`
            ctx.fillStyle = `rgba(${nR},${nG},${nB},${a})`
            ctx.textAlign = 'center'
            ctx.fillText(n.display, n.x, n.y + tall * 0.5 + 14)
          }
          ctx.textAlign = 'left'
        }
      }
    }

    // ── A: Sonar pings ───────────────────────────────────────────────────
    for (let i = this._pings.length - 1; i >= 0; i--) {
      const p = this._pings[i]
      if (p._delay > 0) { p._delay -= delta; continue }
      p.r     += p.spd * delta
      p.alpha -= delta * 1.6
      if (p.alpha <= 0 || p.r >= p.maxR) { this._pings.splice(i, 1); continue }
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${p.alpha * 0.65})`
      ctx.lineWidth   = 0.8 + bass * 1.5
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke()
    }

    // ── C: Lock-on brackets ──────────────────────────────────────────────
    for (let i = this._lockOns.length - 1; i >= 0; i--) {
      const lo = this._lockOns[i]
      lo.r    += (lo.tr - lo.r) * Math.min(1, delta * 10)
      lo.alpha -= delta * 2.8
      if (lo.alpha <= 0) { this._lockOns.splice(i, 1); continue }
      const s = lo.r, bl = s * 0.38
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${lo.alpha})`
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
            if (n.type === 'circle') {
              ctx.beginPath(); ctx.arc(n.x, n.y, n.size * 1.35, 0, Math.PI * 2); ctx.stroke()
            } else {
              ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(n.rot)
              ctx.strokeRect(-n.size * 0.85, -n.size * 0.6, n.size * 1.7, n.size * 1.2)
              ctx.restore()
            }
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

    // ── Corner brackets ──────────────────────────────────────────────────
    const pad = 16, blen = 16
    const bA = 0.20 + overall * 0.08 + this._beatFlash * 0.12
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${bA})`
    ctx.lineWidth = 1
    for (const [x, y, sx, sy] of [[pad,pad,1,1],[w-pad,pad,-1,1],[pad,h-pad,1,-1],[w-pad,h-pad,-1,-1]]) {
      ctx.beginPath(); ctx.moveTo(x+sx*blen,y); ctx.lineTo(x,y); ctx.lineTo(x,y+sy*blen); ctx.stroke()
    }

    // ── HUD text ─────────────────────────────────────────────────────────
    const frame = String(Math.floor(this.time * 30)).padStart(6, '0')
    const code  = this._trackCode || 'SECTOR-00-0000'
    const hA    = 0.26 + overall * 0.10
    ctx.font      = `300 9px 'Courier New', monospace`
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${hA})`
    ctx.textAlign = 'left'
    ctx.fillText('CAM 1', pad + 2, pad + 12)
    ctx.textAlign = 'center'
    ctx.fillText(`${code}  ·  ${frame}`, cx, h - pad - 4)
    ctx.textAlign = 'left'
  }

  destroy() { this.canvas.remove() }
}
