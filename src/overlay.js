// Canvas 2D — targeting circles + HUD text (machine-vision annotation aesthetic)
export class DataOverlay {
  constructor(container) {
    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;'
    container.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')

    this.time    = 0
    this.color   = [255, 60, 60]   // red targeting circles
    this._rings  = []              // active targeting rings
    this._label  = 'SECTOR-0-0000'
    this._trackCode = ''

    this._resize()
    window.addEventListener('resize', () => this._resize())
    this._spawnRings(6)
  }

  _resize() {
    this.canvas.width  = window.innerWidth
    this.canvas.height = window.innerHeight
  }

  setColor(r, g, b) { this.color = [r, g, b] }

  setTrack(name) {
    // Generate a deterministic sector code from track name
    let hash = 0
    for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff
    const sector = String(Math.floor(hash / 1000) % 100).padStart(2, '0')
    const id     = String(hash % 10000).padStart(4, '0')
    this._trackCode = `SECTOR-${sector}-${id}`
  }

  _spawnRings(count) {
    const w = window.innerWidth, h = window.innerHeight
    const cx = w * 0.5, cy = h * 0.5
    this._rings = []
    for (let i = 0; i < count; i++) {
      const angle  = Math.random() * Math.PI * 2
      const dist   = 60 + Math.random() * Math.min(w, h) * 0.28
      this._rings.push({
        x:      cx + Math.cos(angle) * dist,
        y:      cy + Math.sin(angle) * dist,
        r:      18 + Math.random() * 38,
        alpha:  Math.random() * 0.5 + 0.15,
        life:   Math.random() * Math.PI * 2,
        speed:  0.3 + Math.random() * 0.4,
        label:  String(Math.floor(Math.random() * 999)).padStart(3, '0'),
        dot:    Math.random() > 0.5,
      })
    }
  }

  update(audio, delta) {
    this.time += delta
    const { ctx } = this
    const w = this.canvas.width, h = this.canvas.height
    const cx = w * 0.5, cy = h * 0.5
    const overall = audio.overall ?? 0
    const beat    = audio.beat    ?? false
    const [cr, cg, cb] = this.color

    ctx.clearRect(0, 0, w, h)

    // On beat — briefly spawn a new ring or pulse existing ones
    if (beat && Math.random() > 0.4) {
      const angle = Math.random() * Math.PI * 2
      const dist  = 40 + Math.random() * Math.min(w, h) * 0.32
      // Replace the dimmest ring
      let minIdx = 0
      for (let i = 1; i < this._rings.length; i++)
        if (this._rings[i].alpha < this._rings[minIdx].alpha) minIdx = i
      this._rings[minIdx] = {
        x:     cx + Math.cos(angle) * dist,
        y:     cy + Math.sin(angle) * dist,
        r:     20 + Math.random() * 35,
        alpha: 0.7,
        life:  0,
        speed: 0.4 + Math.random() * 0.5,
        label: String(Math.floor(Math.random() * 999)).padStart(3, '0'),
        dot:   true,
      }
    }

    // ── Targeting rings ──────────────────────────────────────────────────
    for (const ring of this._rings) {
      ring.life += delta * ring.speed
      const pulse = Math.sin(ring.life) * 0.12
      const a     = Math.max(0.04, ring.alpha + pulse + overall * 0.08)

      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${a})`
      ctx.lineWidth   = 0.8

      // Main circle
      ctx.beginPath()
      ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2)
      ctx.stroke()

      // Inner dot
      if (ring.dot) {
        ctx.beginPath()
        ctx.arc(ring.x, ring.y, 2, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${a * 0.8})`
        ctx.fill()
      }

      // Small gap notches on the ring
      const notches = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5]
      for (const angle of notches) {
        const nx = ring.x + Math.cos(angle) * (ring.r + 5)
        const ny = ring.y + Math.sin(angle) * (ring.r + 5)
        ctx.beginPath()
        ctx.moveTo(ring.x + Math.cos(angle) * (ring.r - 4), ring.y + Math.sin(angle) * (ring.r - 4))
        ctx.lineTo(nx, ny)
        ctx.stroke()
      }

      // Label
      ctx.font      = '7px "SF Mono", "Courier New", monospace'
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${a * 0.7})`
      ctx.fillText(ring.label, ring.x + ring.r + 6, ring.y + 3)
    }

    // ── Corner brackets ──────────────────────────────────────────────────
    const pad = 18, blen = 14
    const bAlpha = 0.18 + overall * 0.08
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${bAlpha})`
    ctx.lineWidth = 1
    for (const [x, y, sx, sy] of [[pad,pad,1,1],[w-pad,pad,-1,1],[pad,h-pad,1,-1],[w-pad,h-pad,-1,-1]]) {
      ctx.beginPath(); ctx.moveTo(x+sx*blen,y); ctx.lineTo(x,y); ctx.lineTo(x,y+sy*blen); ctx.stroke()
    }

    // ── Bottom HUD text ──────────────────────────────────────────────────
    const frame = String(Math.floor(this.time * 30)).padStart(6, '0')
    const code  = this._trackCode || 'SECTOR-00-0000'
    ctx.font      = '9px "SF Mono", "Courier New", monospace'
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${0.25 + overall * 0.15})`
    ctx.textAlign = 'center'
    ctx.fillText(`${code}  ·  F:${frame}`, cx, h - 22)
    ctx.textAlign = 'left'
  }

  destroy() {
    this.canvas.remove()
  }
}
