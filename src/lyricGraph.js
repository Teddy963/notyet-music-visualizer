// Lyric word network — full song vocabulary as persistent node map
// Active line words light up; edges connect co-occurring words

const STOP = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'i','you','me','my','your','it','its','is','are','was','were','be','been',
  'being','have','has','had','do','does','did','will','would','could','should',
  'may','might','shall','can','not','no','so','if','as','up','out','by',
  'from','that','this','these','those','he','she','we','they','him','her',
  'us','them','all','just','like','get','got','go','gonna','wanna','im',
  "i'm","i've","i'll","i'd","you're","don't","can't","won't","it's","that's",
])

function wordKey(raw) {
  const k = raw.replace(/[^a-zA-Z']/g, '').toLowerCase()
  return k.length < 2 ? '' : k
}

function stablePos(word, w, h, pad) {
  let h1 = 0, h2 = 0
  for (let i = 0; i < word.length; i++) {
    h1 = (h1 * 31  + word.charCodeAt(i)) & 0xfffff
    h2 = (h2 * 127 + word.charCodeAt(i)) & 0xfffff
  }
  return [
    pad + (h1 % 10000) / 10000 * (w - pad * 2),
    pad + (h2 % 10000) / 10000 * (h - pad * 2),
  ]
}

export class LyricGraph {
  constructor(container) {
    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:6;'
    container.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')

    this.time       = 0
    this.color      = [180, 255, 120]
    this._lines     = []
    this._activeIdx = -1
    this._wordNodes = []   // {word, x, y, count, lineSet, brightness}
    this._edges     = []   // {a, b} indices into _wordNodes
    this._activeSet = new Set()
    this._trackCode = 'SECTOR-00-0000'

    this._resize()
    window.addEventListener('resize', () => { this._resize(); this._rebuildPositions() })
  }

  _resize() {
    this.canvas.width  = window.innerWidth
    this.canvas.height = window.innerHeight
  }

  setLines(lines) {
    this._lines = lines ?? []
    this._activeIdx = -1
    this._activeSet = new Set()
    this._buildWordGraph()
  }

  _buildWordGraph() {
    const w = this.canvas.width, h = this.canvas.height
    const pad = 70

    // Collect unique meaningful words + their line memberships
    const wordData = new Map() // key → {display, count, lineSet}

    this._lines.forEach((line, li) => {
      const tokens = line.words.split(/\s+/).filter(Boolean)
      let i = 0
      while (i < tokens.length) {
        const key = wordKey(tokens[i])
        // Merge article/preposition with next word
        if (STOP.has(key) && i + 1 < tokens.length) {
          const nextKey = wordKey(tokens[i + 1])
          if (!STOP.has(nextKey)) {
            const mergedKey   = key + '_' + nextKey
            const mergedDisplay = (tokens[i] + ' ' + tokens[i + 1]).toUpperCase()
            if (!wordData.has(mergedKey)) wordData.set(mergedKey, { display: mergedDisplay, count: 0, lineSet: new Set() })
            const e = wordData.get(mergedKey)
            e.count++; e.lineSet.add(li)
            i += 2; continue
          }
        }
        if (!STOP.has(key) && key.length > 1) {
          if (!wordData.has(key)) wordData.set(key, { display: tokens[i].toUpperCase(), count: 0, lineSet: new Set() })
          const e = wordData.get(key)
          e.count++; e.lineSet.add(li)
        }
        i++
      }
    })

    // Build node list with stable positions
    this._wordNodes = []
    const nodeIdx = new Map()
    for (const [key, data] of wordData) {
      const [x, y] = stablePos(key, w, h, pad)
      nodeIdx.set(key, this._wordNodes.length)
      this._wordNodes.push({
        key, display: data.display,
        x, y,
        count: data.count,
        lineSet: data.lineSet,
        brightness: 0,   // 0=dim, 1=active (lerped)
      })
    }

    // Build edges: consecutive non-stop words in same line
    const edgeSet = new Set()
    this._edges = []
    this._lines.forEach((line, li) => {
      const tokens = line.words.split(/\s+/).filter(Boolean)
      const keys = []
      let i = 0
      while (i < tokens.length) {
        const k = wordKey(tokens[i])
        if (STOP.has(k) && i + 1 < tokens.length) {
          const nk = wordKey(tokens[i+1])
          if (!STOP.has(nk)) { keys.push(k + '_' + nk); i += 2; continue }
        }
        if (!STOP.has(k) && k.length > 1) keys.push(k)
        i++
      }
      for (let j = 0; j < keys.length - 1; j++) {
        const a = nodeIdx.get(keys[j])
        const b = nodeIdx.get(keys[j+1])
        if (a === undefined || b === undefined || a === b) continue
        const eKey = a < b ? `${a}-${b}` : `${b}-${a}`
        if (!edgeSet.has(eKey)) {
          edgeSet.add(eKey)
          this._edges.push({ a, b })
        }
      }
    })
  }

  _rebuildPositions() {
    const w = this.canvas.width, h = this.canvas.height
    const pad = 70
    for (const node of this._wordNodes) {
      const [x, y] = stablePos(node.key, w, h, pad)
      node.x = x; node.y = y
    }
  }

  setActiveIndex(idx) {
    if (idx === this._activeIdx) return
    this._activeIdx = idx

    // Find which word keys belong to this line
    const newActive = new Set()
    if (idx >= 0 && this._lines[idx]) {
      const tokens = this._lines[idx].words.split(/\s+/).filter(Boolean)
      let i = 0
      while (i < tokens.length) {
        const k = wordKey(tokens[i])
        if (STOP.has(k) && i + 1 < tokens.length) {
          const nk = wordKey(tokens[i+1])
          if (!STOP.has(nk)) { newActive.add(k + '_' + nk); i += 2; continue }
        }
        if (!STOP.has(k) && k.length > 1) newActive.add(k)
        i++
      }
    }
    this._activeSet = newActive
  }

  setColor(r, g, b) { this.color = [r, g, b] }

  setTrack(name) {
    let h = 0
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff
    this._trackCode = `${String(Math.floor(h/1000)%100).padStart(2,'0')}-SECTOR-${String(h%10000).padStart(4,'0')}`
  }

  update(audio, delta) {
    this.time += delta
    const { ctx } = this
    const w = this.canvas.width, h = this.canvas.height
    const cx = w * 0.5
    const overall = audio.overall ?? 0
    const beat    = audio.beat ?? false
    const kick    = audio.kick ?? 0
    const [cr, cg, cb] = this.color

    ctx.clearRect(0, 0, w, h)

    if (!this._wordNodes.length) return

    // Lerp brightness toward target
    const lerpSpeed = delta * 3.5
    for (const node of this._wordNodes) {
      const target = this._activeSet.has(node.key) ? 1.0 : 0.0
      node.brightness += (target - node.brightness) * lerpSpeed
    }

    // ── Edges: word-to-word chain ──────────────────────────────────────
    const wordNodes = this._wordNodes.filter(n => n.brightness > 0.05)
    for (let i = 0; i < wordNodes.length - 1; i++) {
      const edgeA = 0.35 + overall * 0.2
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${edgeA})`
      ctx.lineWidth = 0.8
      ctx.beginPath()
      ctx.moveTo(wordNodes[i].x, wordNodes[i].y)
      ctx.lineTo(wordNodes[i+1].x, wordNodes[i+1].y)
      ctx.stroke()

      // Arrow head pointing to next word
      const angle = Math.atan2(wordNodes[i+1].y - wordNodes[i].y, wordNodes[i+1].x - wordNodes[i].x)
      const al = 7
      ctx.beginPath()
      ctx.moveTo(wordNodes[i+1].x, wordNodes[i+1].y)
      ctx.lineTo(wordNodes[i+1].x - al * Math.cos(angle - 0.4), wordNodes[i+1].y - al * Math.sin(angle - 0.4))
      ctx.moveTo(wordNodes[i+1].x, wordNodes[i+1].y)
      ctx.lineTo(wordNodes[i+1].x - al * Math.cos(angle + 0.4), wordNodes[i+1].y - al * Math.sin(angle + 0.4))
      ctx.stroke()
    }

    // Dim background edges for all non-active connections
    for (const { a, b } of this._edges) {
      const na = this._wordNodes[a], nb = this._wordNodes[b]
      const bright = Math.max(na.brightness, nb.brightness)
      if (bright >= 0.05) continue
      const baseA = 0.04 + bright * 0.35 + overall * bright * 0.1
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${baseA})`
      ctx.lineWidth = 0.5 + bright * 0.8
      ctx.beginPath()
      ctx.moveTo(na.x, na.y)
      ctx.lineTo(nb.x, nb.y)
      ctx.stroke()
    }

    // ── Nodes ──────────────────────────────────────────────────────────
    const maxCount = Math.max(1, ...this._wordNodes.map(n => n.count))

    // Draw inactive nodes first (dim pass)
    ctx.shadowBlur = 4
    for (const node of this._wordNodes) {
      const bright = node.brightness
      if (bright > 0.05) continue  // active nodes drawn separately below
      const freq   = node.count / maxCount

      const dimA   = 0.04 + freq * 0.12
      const alpha  = dimA

      if (alpha < 0.015) continue

      const dotR = 1.5 + freq * 2
      ctx.shadowColor = `rgba(${cr},${cg},${cb},0.3)`
      ctx.beginPath()
      ctx.arc(node.x, node.y, dotR, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`
      ctx.fill()

      const fz = Math.round(8 + freq * 8)
      ctx.font = `300 ${fz}px Georgia, "Times New Roman", serif`
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha * 0.95})`
      ctx.textAlign = 'left'
      ctx.fillText(node.display, node.x + dotR + 4, node.y + fz * 0.36)
    }

    // Draw active nodes with glow
    ctx.shadowColor = `rgba(${cr},${cg},${cb},0.9)`
    ctx.shadowBlur = 14
    for (const node of this._wordNodes) {
      const bright = node.brightness
      if (bright <= 0.05) continue
      const freq   = node.count / maxCount

      const dimA   = 0.04 + freq * 0.12
      const activeA = 0.85 + overall * 0.15
      const alpha  = dimA + (activeA - dimA) * bright

      if (alpha < 0.015) continue

      // Glow halo for active nodes
      if (bright > 0.3) {
        const glowR = 20 + freq * 20 + kick * bright * 10
        const grd = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowR)
        grd.addColorStop(0, `rgba(${cr},${cg},${cb},${bright * (0.2 + overall * 0.1)})`)
        grd.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
        ctx.fillStyle = grd
        ctx.beginPath()
        ctx.arc(node.x, node.y, glowR, 0, Math.PI * 2)
        ctx.fill()
      }

      // Dot
      const dotR = 1.5 + freq * 2 + bright * (3 + kick * 2)
      ctx.beginPath()
      ctx.arc(node.x, node.y, dotR, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`
      ctx.fill()

      // Text — size scales with frequency + activation
      const fz = Math.min(28, Math.max(16, w / 46))
      const weight = bright > 0.5 ? '500' : '300'
      ctx.font = `${weight} ${fz}px Georgia, "Times New Roman", serif`
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha * 0.95})`
      ctx.textAlign = 'left'
      ctx.fillText(node.display, node.x + dotR + 4, node.y + fz * 0.36)
    }
    ctx.shadowBlur = 0

    // ── Corner brackets ────────────────────────────────────────────────
    const pad = 18, bl = 14, ba = 0.12 + overall * 0.06
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${ba})`
    ctx.lineWidth = 1
    for (const [x,y,sx,sy] of [[pad,pad,1,1],[w-pad,pad,-1,1],[pad,h-pad,1,-1],[w-pad,h-pad,-1,-1]]) {
      ctx.beginPath(); ctx.moveTo(x+sx*bl,y); ctx.lineTo(x,y); ctx.lineTo(x,y+sy*bl); ctx.stroke()
    }

    // ── HUD ────────────────────────────────────────────────────────────
    const frame = String(Math.floor(this.time * 30)).padStart(6, '0')
    ctx.font      = '300 9px Georgia,"Times New Roman",serif'
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${0.22 + overall * 0.1})`
    ctx.textAlign = 'center'
    ctx.fillText(`${this._trackCode}  ·  F:${frame}`, cx, h - 22)
  }

  destroy() { this.canvas.remove() }
}
