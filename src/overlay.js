// Canvas 2D data overlay — scan lines, radiating lines, floating coordinates
export class DataOverlay {
  constructor(container) {
    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;'
    container.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')

    this.time    = 0
    this.color   = [220, 255, 80]   // accent color (yellow-green default)
    this.scanX   = 0                // moving vertical scan cursor
    this._nodes  = []               // floating data nodes

    this._resize()
    window.addEventListener('resize', () => this._resize())
    this._seedNodes()
  }

  _resize() {
    this.canvas.width  = window.innerWidth
    this.canvas.height = window.innerHeight
  }

  // Set accent color from music mood [r,g,b] 0-255
  setColor(r, g, b) { this.color = [r, g, b] }

  _seedNodes() {
    this._nodes = []
    const count = 28
    const w = window.innerWidth, h = window.innerHeight
    for (let i = 0; i < count; i++) {
      this._nodes.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        val: Math.floor(Math.random() * 999999).toString().padStart(6, '0'),
        alpha: Math.random() * 0.4 + 0.1,
        life: Math.random() * Math.PI * 2,
        size: Math.random() > 0.7 ? 'big' : 'small',
      })
    }
  }

  update(audio, delta) {
    this.time += delta
    const { ctx } = this
    const w = this.canvas.width, h = this.canvas.height
    const [cr, cg, cb] = this.color
    const overall = audio.overall ?? 0
    const beat    = audio.beat    ?? false

    ctx.clearRect(0, 0, w, h)

    // ── Radiating lines from center ──────────────────────────────────
    const cx = w * 0.5, cy = h * 0.5
    const lineCount = 20
    for (let i = 0; i < lineCount; i++) {
      const angle = (i / lineCount) * Math.PI * 2 + this.time * 0.04
      const maxLen = Math.sqrt(w * w + h * h) * 0.6
      const len    = maxLen * (0.25 + overall * 0.75)
      const alpha  = (0.04 + overall * 0.07) * (i % 3 === 0 ? 2 : 1)

      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(angle) * len, cy + Math.sin(angle) * len)
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha})`
      ctx.lineWidth = i % 5 === 0 ? 0.8 : 0.3
      ctx.stroke()
    }

    // ── Beat flash: radial burst ──────────────────────────────────────
    if (beat) {
      ctx.beginPath()
      ctx.arc(cx, cy, 8 + overall * 20, 0, Math.PI * 2)
      ctx.strokeStyle = `rgba(${cr},${cg},${cb},0.6)`
      ctx.lineWidth = 1
      ctx.stroke()
    }

    // ── Moving vertical scan cursor ───────────────────────────────────
    this.scanX = (this.scanX + (0.8 + overall * 2)) % w
    const scanAlpha = 0.12 + overall * 0.1
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${scanAlpha})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(this.scanX, 0)
    ctx.lineTo(this.scanX, h)
    ctx.stroke()

    // ── Floating data nodes ───────────────────────────────────────────
    for (const node of this._nodes) {
      node.x  += node.vx
      node.y  += node.vy
      node.life += delta * (0.4 + overall * 0.6)

      // Wrap
      if (node.x < -60) node.x = w + 60
      if (node.x > w + 60) node.x = -60
      if (node.y < -20) node.y = h + 20
      if (node.y > h + 20) node.y = -20

      // Pulse alpha
      const pulse = Math.sin(node.life) * 0.15
      const a     = Math.max(0, node.alpha + pulse + overall * 0.15)
      const fs    = node.size === 'big' ? '9px' : '7px'

      ctx.font      = `${fs} 'SF Mono', 'Courier New', monospace`
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${a})`
      ctx.fillText(node.val, node.x, node.y)

      // Occasionally refresh value
      if (Math.random() < 0.002 + (beat ? 0.05 : 0)) {
        node.val = Math.floor(Math.random() * 999999).toString().padStart(6, '0')
      }
    }

    // ── Corner bracket markers ────────────────────────────────────────
    const pad = 20, len2 = 16, bracketAlpha = 0.15 + overall * 0.1
    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${bracketAlpha})`
    ctx.lineWidth = 1
    const corners = [[pad,pad,1,1],[w-pad,pad,-1,1],[pad,h-pad,1,-1],[w-pad,h-pad,-1,-1]]
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath(); ctx.moveTo(x+sx*len2,y); ctx.lineTo(x,y); ctx.lineTo(x,y+sy*len2); ctx.stroke()
    }

    // ── Frame counter (bottom right of center) ────────────────────────
    const frame = Math.floor(this.time * 30).toString().padStart(8, '0')
    ctx.font      = '8px "SF Mono", "Courier New", monospace'
    ctx.fillStyle = `rgba(${cr},${cg},${cb},${0.2 + overall * 0.15})`
    ctx.fillText(`F:${frame}`, cx + 12, cy + 6)
  }

  destroy() {
    this.canvas.remove()
    window.removeEventListener('resize', this._resize)
  }
}
