// Lyric graph — orbital layout around central particle form
// Active lyric = glowing node + targeting circles near center
// Other lyrics = drift outward, connected by lines

export class LyricGraph {
  constructor(container) {
    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:6;'
    container.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')

    this.time       = 0
    this.color      = [255, 120, 80]
    this.redColor   = [255, 55, 55]

    this._lines     = []
    this._activeIdx = -1
    this._nodes     = []
    this._trackCode = 'SECTOR-00-0000'

    // 3 targeting rings on active node
    this._rings = [
      { r: 55,  rot: 0,  rotSpeed:  0.35, alpha: 0.65 },
      { r: 85,  rot: 0,  rotSpeed: -0.22, alpha: 0.45 },
      { r: 115, rot: 0,  rotSpeed:  0.15, alpha: 0.28 },
    ]

    this._resize()
    window.addEventListener('resize', () => { this._resize(); this._buildLayout() })
  }

  _resize() {
    this.canvas.width  = window.innerWidth
    this.canvas.height = window.innerHeight
  }

  setLines(lines) {
    this._lines = lines ?? []
    this._activeIdx = -1
    this._nodes = []
  }

  setActiveIndex(idx) {
    if (idx === this._activeIdx) return
    this._activeIdx = idx
    this._buildLayout()
  }

  setColor(r, g, b) { this.color = [r, g, b] }

  setTrack(name) {
    let h = 0
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff
    this._trackCode = `${String(Math.floor(h/1000)%100).padStart(2,'0')}-SECTOR-${String(h%10000).padStart(4,'0')}`
  }

  _buildLayout() {
    const w = this.canvas.width, h = this.canvas.height
    const cx = w * 0.5, cy = h * 0.5
    const idx = this._activeIdx
    if (!this._lines.length || idx < 0) return

    const PHI = 1.6180339887  // golden angle spread

    // Window: 4 past + active + 7 future
    const visible = []
    for (let i = idx - 4; i <= idx + 7; i++) {
      if (i >= 0 && i < this._lines.length) visible.push(i)
    }

    this._nodes = visible.map((li) => {
      const rel      = li - idx
      const isActive = rel === 0

      // Orbital position — each line has a stable angle derived from its index
      const angle   = li * PHI * 2.0             // stable angle per line
      const dist    = isActive ? 145
        : rel < 0
          ? 145 + Math.abs(rel) * 70 + Math.sin(li) * 25   // past → drift outward
          : 180 + rel * 55 + Math.cos(li * 1.3) * 20       // future → further ring
      const drift   = isActive ? 0 : Math.sin(this.time * 0.3 + li * 0.7) * 12

      const x = cx + Math.cos(angle) * (dist + drift)
      const y = cy + Math.sin(angle) * (dist + drift) * 0.75  // slightly squashed

      const size  = isActive ? 7 : Math.max(2.5, 6 - Math.abs(rel) * 0.7)
      const alpha = isActive ? 1.0
        : rel < 0
          ? Math.max(0.06, 0.65 - Math.abs(rel) * 0.12)
          : Math.max(0.04, 0.38 - rel * 0.06)

      return { li, x, y, size, alpha, isActive, rel, words: this._lines[li]?.words ?? '', angle, dist }
    })
  }

  update(audio, delta) {
    this.time += delta
    const { ctx } = this
    const w = this.canvas.width, h = this.canvas.height
    const cx = w * 0.5, cy = h * 0.5
    const overall = audio.overall ?? 0
    const beat    = audio.beat    ?? false
    const kick    = audio.kick    ?? 0
    const [cr, cg, cb] = this.color
    const [rr, rg, rb] = this.redColor

    ctx.clearRect(0, 0, w, h)

    // Drift nodes slowly over time
    const PHI = 1.6180339887
    if (this._activeIdx >= 0) {
      this._nodes.forEach(node => {
        if (node.isActive) return
        const drift = Math.sin(this.time * 0.3 + node.li * 0.7) * 12
        node.x = cx + Math.cos(node.angle) * (node.dist + drift)
        node.y = cy + Math.sin(node.angle) * (node.dist + drift) * 0.75
      })
    }

    const activeNode = this._nodes.find(n => n.isActive)

    // ── Lines: active → each other node ──────────────────────────────
    if (activeNode) {
      for (const node of this._nodes) {
        if (node.isActive) continue
        const a = node.alpha * (0.25 + overall * 0.15)
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${a})`
        ctx.lineWidth   = 0.5
        ctx.beginPath()
        ctx.moveTo(activeNode.x, activeNode.y)
        ctx.lineTo(node.x, node.y)
        ctx.stroke()
      }
    }

    // ── Targeting rings on active node ───────────────────────────────
    if (activeNode) {
      const pulse = 1.0 + kick * 0.2 + overall * 0.1
      for (const ring of this._rings) {
        ring.rot += delta * ring.rotSpeed
        const r = ring.r * pulse
        const a = ring.alpha * (0.5 + overall * 0.3)
        ctx.strokeStyle = `rgba(${rr},${rg},${rb},${a})`
        ctx.lineWidth   = 0.8
        ctx.beginPath()
        ctx.arc(activeNode.x, activeNode.y, r, 0, Math.PI * 2)
        ctx.stroke()

        // Notch marks
        for (let ni = 0; ni < 4; ni++) {
          const na = ring.rot + (ni / 4) * Math.PI * 2
          ctx.beginPath()
          ctx.moveTo(activeNode.x + Math.cos(na) * (r - 5), activeNode.y + Math.sin(na) * (r - 5))
          ctx.lineTo(activeNode.x + Math.cos(na) * (r + 7), activeNode.y + Math.sin(na) * (r + 7))
          ctx.stroke()
        }

        // Orbiting dot on outermost ring
        if (ring.r === 115) {
          ctx.beginPath()
          ctx.arc(activeNode.x + Math.cos(ring.rot) * r,
                  activeNode.y + Math.sin(ring.rot) * r, 2.5, 0, Math.PI * 2)
          ctx.fillStyle = `rgba(${rr},${rg},${rb},${a * 0.9})`
          ctx.fill()
        }
      }
    }

    // ── Nodes + text ──────────────────────────────────────────────────
    for (const node of this._nodes) {
      const beatPulse = node.isActive ? (1 + kick * 0.5 + overall * 0.2) : 1
      const r = node.size * beatPulse

      // Glow halo on active
      if (node.isActive) {
        const grd = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r * 7)
        grd.addColorStop(0, `rgba(${cr},${cg},${cb},${0.22 + overall * 0.12})`)
        grd.addColorStop(1, `rgba(${cr},${cg},${cb},0)`)
        ctx.fillStyle = grd
        ctx.beginPath()
        ctx.arc(node.x, node.y, r * 7, 0, Math.PI * 2)
        ctx.fill()
      }

      // Node dot
      ctx.beginPath()
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${node.alpha})`
      ctx.fill()

      // Text label — on opposite side from center
      const toCenter = Math.atan2(cy - node.y, cx - node.x)
      const labelAngle = toCenter + Math.PI  // away from center
      const labelDist  = r + 10
      const lx = node.x + Math.cos(labelAngle) * labelDist
      const ly = node.y + Math.sin(labelAngle) * labelDist

      const fontSize   = node.isActive ? 12 : Math.max(8, 11 - Math.abs(node.rel))
      const textAlpha  = node.isActive ? (0.88 + overall * 0.12) : node.alpha * 0.85
      ctx.font         = `${node.isActive ? '400' : '300'} ${fontSize}px "Helvetica Neue", Helvetica, sans-serif`
      ctx.fillStyle    = `rgba(${cr},${cg},${cb},${textAlpha})`
      ctx.textAlign    = lx < cx ? 'right' : 'left'
      ctx.fillText(node.words, lx, ly + 4)
    }

    // ── Grain ─────────────────────────────────────────────────────────
    const img = ctx.createImageData(w, h)
    const d = img.data
    for (let i = 0; i < d.length; i += 16) {  // sparse for perf
      const v = (Math.random() * 28 - 14) * (0.4 + overall * 0.5)
      d[i] = d[i+1] = d[i+2] = 128 + v; d[i+3] = 16
    }
    ctx.putImageData(img, 0, 0)

    // ── Corner brackets ───────────────────────────────────────────────
    const pad = 18, bl = 14, ba = 0.18 + overall * 0.08
    ctx.strokeStyle = `rgba(${rr},${rg},${rb},${ba})`
    ctx.lineWidth = 1
    for (const [x,y,sx,sy] of [[pad,pad,1,1],[w-pad,pad,-1,1],[pad,h-pad,1,-1],[w-pad,h-pad,-1,-1]]) {
      ctx.beginPath(); ctx.moveTo(x+sx*bl,y); ctx.lineTo(x,y); ctx.lineTo(x,y+sy*bl); ctx.stroke()
    }

    // ── HUD ───────────────────────────────────────────────────────────
    const frame = String(Math.floor(this.time * 30)).padStart(6, '0')
    ctx.font      = '9px "SF Mono", "Courier New", monospace'
    ctx.fillStyle = `rgba(${rr},${rg},${rb},${0.28 + overall * 0.12})`
    ctx.textAlign = 'center'
    ctx.fillText(`${this._trackCode}  ·  F:${frame}`, cx, h - 22)
    ctx.textAlign = 'left'
  }

  destroy() { this.canvas.remove() }
}
