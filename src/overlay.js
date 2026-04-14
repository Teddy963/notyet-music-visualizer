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
const KO_PARTICLES = [
  '에서도','으로서','에게서','이라는','이라고','라고','에서','까지','부터','이다','이야',
  '이랑','한테','에게','에도','으로','을','를','이','가','은','는','도','만','로',
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
    let cleaned = isKorean
      ? stripKoParticle(raw.replace(/[^가-힣]/g, ''))
      : raw.replace(/[^a-zA-Z']/g, '').toLowerCase()
    if (cleaned.length < 1) return null
    // Allow single-char only if it's a known connector (e.g. "i")
    if (cleaned.length < 2 && !CONNECTOR_WORDS.has(cleaned)) return null
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

// Stable deterministic hash → [0, 1)
function wordHash(word, salt = 0) {
  let h = salt
  for (let i = 0; i < word.length; i++) h = (h * 31 + word.charCodeAt(i)) & 0xffffff
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

    this._resize()
    window.addEventListener('resize', () => { this._resize(); this._rebuildPositions() })
    this._buildMapButton(container)
  }

  _buildMapButton(container) {
    const btn = document.createElement('button')
    btn.textContent = 'MAP'
    btn.style.cssText = `
      position:fixed; bottom:28px; right:72px; z-index:30;
      background:transparent; border:1px solid rgba(255,40,40,0.3);
      color:rgba(255,40,40,0.4); font:300 9px 'Courier New',monospace;
      letter-spacing:0.12em; padding:5px 10px; cursor:pointer;
      transition: border-color 0.2s, color 0.2s;
    `
    btn.addEventListener('mouseenter', () => { this._mapPinned = true })
    btn.addEventListener('mouseleave', () => { this._mapPinned = false })
    container.appendChild(btn)
    this._mapBtn = btn
  }

  _resize() {
    this.canvas.width  = window.innerWidth
    this.canvas.height = window.innerHeight
  }

  _rebuildPositions() {
    const w = this.canvas.width, h = this.canvas.height
    const pad = 60
    for (const n of this._nodes) {
      n.x = pad + wordHash(n.word, 1) * (w - pad * 2)
      n.y = pad + wordHash(n.word, 2) * (h - pad * 2)
    }
  }

  // ── Called once per song ─────────────────────────────────────────────────────
  setLines(lines) {
    if (!lines?.length) return
    this._lines = lines
    const w = this.canvas.width, h = this.canvas.height
    const pad = 60

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

    this._nodes = sorted.map(([word, count]) => {
      const h1 = wordHash(word, 1), h2 = wordHash(word, 2)
      const h3 = wordHash(word, 3), h4 = wordHash(word, 4)
      const isConnector = CONNECTOR_WORDS.has(word)
      const isAttach    = ATTACH_WORDS.has(word)
      const isTitle     = titleWords.has(word)
      const isCore      = isTitle || (!isConnector && !isAttach && count >= coreThr)
      const type        = (isConnector || isAttach) ? 'circle' : (h3 > 0.45 ? 'circle' : 'box')
      const freqScale   = (isConnector || isAttach) ? 0 : Math.log2(count + 1) / Math.log2(maxFreq + 1)
      const baseSize    = isAttach ? 4 + h4 * 3
                        : isConnector ? 5 + h4 * 4
                        : 8 + h4 * 10
      const freqBoost   = freqScale * 36
      const titleBoost  = isTitle ? 18 + (count / maxFreq) * 20 : 0
      return {
        word, parts: [word], display: word.toUpperCase(),
        x: pad + h1 * (w - pad * 2), y: pad + h2 * (h - pad * 2),
        type, size: baseSize + freqBoost + titleBoost,
        rot: (h3 - 0.5) * 0.6, freq: count,
        isCore, isBigram: false, isConnector, isAttach, isTitle,
        state: 'dormant', alpha: isTitle ? 0.3 : 0, activeTimer: 0,
      }
    })

    // ── Repulsion + edges ─────────────────────────────────────────────────
    this._applyRepulsion()
    this._buildEdges(lines)
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

    // Collect Claude-identified keywords
    const kwSet = new Set()
    for (const mood of Object.values(moodMap)) {
      for (const kw of (mood.keywords || [])) {
        const clean = /[가-힣]/.test(kw)
          ? stripKoParticle(kw.replace(/[^가-힣]/g, ''))
          : kw.toLowerCase().replace(/[^a-z']/g, '')
        if (clean.length >= 2) kwSet.add(clean)
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
        this._moodChips.push({ r: this._tr, g: this._tg, b: this._tb, born: 0 })
        if (this._moodChips.length > 16) this._moodChips.shift()
      }
    } else {
      this._moodColor = false  // fall back to visualizer accent
    }
  }

  setSubtitle(text) { this._lastActiveWords = text; this.setActiveLine(text) }

  setActiveLine(words) {
    if (!words) return

    // Deactivate previously active/neighbor nodes
    for (const n of this._nodes) {
      if (n.state === 'active' || n.state === 'neighbor') n.state = 'fading'
    }

    // Determine token set + per-token repeat count for this line
    let lineTokens
    if (this._pendingKeywords) {
      lineTokens = this._pendingKeywords.map(w => w.toLowerCase().replace(/[^a-z가-힣']/g, ''))
      this._pendingKeywords = null
    } else {
      lineTokens = tokenize(words)
    }
    const tokenSet = new Set(lineTokens)
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

  // Spread nodes so they don't overlap — simple repulsion simulation
  _applyRepulsion() {
    const w   = this.canvas.width, h = this.canvas.height
    const pad = 60
    const nodes = this._nodes
    const n = nodes.length
    if (n < 2) return

    for (let iter = 0; iter < 160; iter++) {
      for (let i = 0; i < n; i++) {
        const a = nodes[i]
        for (let j = i + 1; j < n; j++) {
          const b    = nodes[j]
          const dx   = b.x - a.x
          const dy   = b.y - a.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.1
          const min  = a.size + b.size + 20   // desired gap between node edges
          if (dist >= min) continue
          const push = (min - dist) / min * 0.5
          const fx   = (dx / dist) * push * min * 0.5
          const fy   = (dy / dist) * push * min * 0.5
          a.x -= fx;  a.y -= fy
          b.x += fx;  b.y += fy
        }
        // Keep within canvas
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
    for (let l = 0; l < 2; l++) {
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

    // Sync MAP button color
    if (this._mapBtn) {
      const c = `rgba(${cr},${cg},${cb},`
      this._mapBtn.style.borderColor = c + (this._mapPinned ? '0.7)' : '0.3)')
      this._mapBtn.style.color       = c + (this._mapPinned ? '0.9)' : '0.4)')
    }

    ctx.clearRect(0, 0, w, h)

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
      if (bothActive)        { a = 0.65 + this._beatFlash * 0.2; lw = 1.0 }
      else if (eitherActive) { a = 0.22; lw = 0.6 }
      else                   { a = Math.min(0.40, 0.08 * revealMult); lw = 0.4 }

      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${a})`
      ctx.lineWidth   = lw
      ctx.beginPath(); ctx.moveTo(na.x, na.y); ctx.lineTo(nb.x, nb.y); ctx.stroke()

      if (eitherActive) {
        const dx = nb.x - na.x, dy = nb.y - na.y
        const len = Math.sqrt(dx * dx + dy * dy) || 1
        const ux = dx / len, uy = dy / len
        const tip = nb.size + 4
        const ax = nb.x - ux * tip, ay = nb.y - uy * tip
        const px = -uy * 4
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`
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
    for (const n of this._nodes) {
      n.activeTimer += delta

      if (n.state === 'dormant') {
        const base = n.isTitle    ? 0.22
                   : n.isCore     ? 0.10
                   : n.isConnector? 0
                   : n.isAttach   ? 0
                   :                0.07
        n.alpha = this._mapPinned
          ? (n.isCore ? 0.85 : n.isConnector ? 0.45 : 0.60)
          : Math.min(0.55, (base + (n.size / 80) * 0.03) * revealMult)
      } else if (n.state === 'active') {
        n.alpha = Math.min(0.92, n.alpha + delta * 4)
      } else if (n.state === 'neighbor') {
        n.alpha = Math.min(0.35, n.alpha + delta * 3)
      } else if (n.state === 'fading') {
        const floor = (n.isConnector || n.isAttach) ? 0 : 0.04 + (n.size / 48) * 0.03
        n.alpha = Math.max(floor, n.alpha - delta * 1.0)
        if (n.alpha <= 0.07) n.state = 'dormant'
      }

      const beatBoost = n.state === 'active' ? this._beatFlash * 0.25 : 0
      const a = Math.min(1, n.alpha + beatBoost)
      const isActive  = n.state === 'active'
      const showLabel = isActive || n.isTitle || (n.isCore && n.alpha > 0.15) || (this._mapPinned && n.display)

      ctx.lineWidth   = isActive ? 1.2 + (n.size / 48) * 0.8 : (this._mapPinned ? 0.8 : 0.5)
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${a})`

      if (n.type === 'circle') {
        ctx.beginPath(); ctx.arc(n.x, n.y, n.size, 0, Math.PI * 2); ctx.stroke()

        if (showLabel) {
          if (isActive) {
            const ch = n.size * 0.5
            ctx.globalAlpha = a * 0.45
            ctx.beginPath()
            ctx.moveTo(n.x - ch, n.y); ctx.lineTo(n.x + ch, n.y)
            ctx.moveTo(n.x, n.y - ch); ctx.lineTo(n.x, n.y + ch)
            ctx.stroke()
            ctx.globalAlpha = 1
            ctx.beginPath(); ctx.arc(n.x, n.y, 2, 0, Math.PI * 2)
            ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`; ctx.fill()

            const goRight = n.x < w * 0.62
            const fz  = 9 + Math.round(n.size / 12)
            const dir = goRight ? 1 : -1
            const ax  = goRight ? n.x + n.size : n.x - n.size
            const ex  = ax + dir * (28 + n.size * 0.4)
            ctx.lineWidth = 0.9; ctx.strokeStyle = `rgba(${cr},${cg},${cb},${a * 0.7})`
            ctx.beginPath(); ctx.moveTo(ax, n.y); ctx.lineTo(ex, n.y); ctx.stroke()
            ctx.beginPath()
            ctx.moveTo(ex - dir * 7, n.y - 4); ctx.lineTo(ex, n.y); ctx.lineTo(ex - dir * 7, n.y + 4)
            ctx.stroke()
            ctx.font = `bold ${fz}px Arial, sans-serif`
            ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`
            ctx.textAlign = goRight ? 'left' : 'right'
            ctx.fillText(n.display, ex + dir * 6, n.y + fz * 0.38)
          } else {
            ctx.font = `300 9px 'Courier New', monospace`
            ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`
            ctx.textAlign = 'center'
            ctx.fillText(n.display, n.x, n.y + n.size + 12)
          }
          ctx.textAlign = 'left'
        }

      } else {
        ctx.save(); ctx.translate(n.x, n.y); ctx.rotate(n.rot)
        const half = n.size * 0.7, tall = n.size * 1.1
        ctx.strokeRect(-half, -tall * 0.5, half * 2, tall)
        ctx.restore()

        if (showLabel) {
          if (isActive) {
            const fz = 9 + Math.round(n.size / 14)
            ctx.font = `bold ${fz}px Arial, sans-serif`
            ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`
            ctx.textAlign = 'center'
            ctx.fillText(n.display, n.x, n.y + tall * 0.5 + fz + 4)
          } else {
            ctx.font = `300 9px 'Courier New', monospace`
            ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`
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
          wave.alpha = Math.max(0, wave.alpha - delta * 4)
          allDone = false
          const a = wave.alpha * 0.75
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

    // ── Mood color chips ─────────────────────────────────────────────────
    if (this._moodChips.length > 0) {
      const chipCx = 52, chipCy = h - 52
      const chipR  = 24   // arrangement radius
      const chipSz = 4.5
      const total  = this._moodChips.length
      this._moodChips.forEach((chip, i) => {
        chip.born = Math.min(1, (chip.born || 0) + delta * 3)
        const spread = Math.min(total, 16)
        const angle = (i / spread) * Math.PI * 2 - Math.PI * 0.5
        const cx = chipCx + Math.cos(angle) * chipR
        const cy = chipCy + Math.sin(angle) * chipR
        const isNewest = i === total - 1
        const ageFade  = 0.3 + (i / total) * 0.6
        const a        = ageFade * chip.born
        ctx.beginPath()
        ctx.arc(cx, cy, isNewest ? chipSz * 1.5 : chipSz, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${chip.r},${chip.g},${chip.b},${a})`
        ctx.fill()
        if (isNewest && chip.born > 0.5) {
          ctx.strokeStyle = `rgba(${chip.r},${chip.g},${chip.b},${a * 0.5})`
          ctx.lineWidth = 1
          ctx.stroke()
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
