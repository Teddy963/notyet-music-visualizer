// Canvas 2D dot-matrix human figure renderer
// Multi-layer glow: outer halo → mid glow → bright white core

const POINT_COUNT = 950

function scatterEllipse(pts, cx, cy, rx, ry, n, sz = 0.5) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const r = Math.sqrt(Math.random())
    pts.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r, sz + Math.random() * 0.4])
  }
}

function scatterLine(pts, x1, y1, x2, y2, thick, n, sz = 0.45) {
  for (let i = 0; i < n; i++) {
    const t = Math.random()
    const dx = x2 - x1, dy = y2 - y1
    const len = Math.sqrt(dx * dx + dy * dy) || 1
    const perp = (Math.random() - 0.5) * thick
    pts.push([
      x1 + dx * t - (dy / len) * perp,
      y1 + dy * t + (dx / len) * perp,
      sz + Math.random() * 0.4
    ])
  }
}

function buildPose(name, n) {
  const pts = []
  const f = r => Math.floor(n * r)

  if (name === 'standing') {
    scatterEllipse(pts,  0,    3.8,  0.52, 0.62, f(0.08))
    scatterLine(pts,     0,    3.2,  0,    2.88, 0.22, f(0.02))
    scatterEllipse(pts,  0,    1.55, 1.05, 1.40, f(0.25))
    scatterLine(pts, -1.12, 2.75, -1.58, 1.80, 0.24, f(0.062))
    scatterLine(pts, -1.58, 1.80, -1.38, 0.72, 0.20, f(0.056))
    scatterLine(pts,  1.12, 2.75,  1.58, 1.80, 0.24, f(0.062))
    scatterLine(pts,  1.58, 1.80,  1.38, 0.72, 0.20, f(0.056))
    scatterEllipse(pts,  0,    0.08, 0.80, 0.33, f(0.055))
    scatterLine(pts, -0.48,  0.00, -0.56, -1.92, 0.30, f(0.096))
    scatterLine(pts, -0.56, -1.92, -0.50, -3.70, 0.24, f(0.090))
    scatterLine(pts,  0.48,  0.00,  0.56, -1.92, 0.30, f(0.096))
    scatterLine(pts,  0.56, -1.92,  0.50, -3.70, 0.24, f(0.090))
    scatterEllipse(pts, -0.52, -3.88, 0.44, 0.19, f(0.025))
    scatterEllipse(pts,  0.52, -3.88, 0.44, 0.19, f(0.025))
  }

  else if (name === 'running') {
    scatterEllipse(pts,  0.18,  3.68, 0.52, 0.62, f(0.08))
    scatterLine(pts,     0.18,  3.10, 0.12, 2.82, 0.22, f(0.02))
    scatterEllipse(pts,  0.08,  1.50, 1.05, 1.32, f(0.22))
    scatterLine(pts, -1.20,  2.82, -0.38,  1.42, 0.22, f(0.056))
    scatterLine(pts, -0.38,  1.42, -0.18,  0.28, 0.18, f(0.050))
    scatterLine(pts,  1.08,  2.72,  1.72,  1.52, 0.22, f(0.056))
    scatterLine(pts,  1.72,  1.52,  1.32,  3.08, 0.18, f(0.050))
    scatterEllipse(pts,  0.00,  0.08, 0.75, 0.30, f(0.050))
    scatterLine(pts, -0.30,  0.02, -1.22, -1.52, 0.30, f(0.090))
    scatterLine(pts, -1.22, -1.52, -0.58, -3.25, 0.24, f(0.082))
    scatterEllipse(pts, -0.58, -3.40, 0.38, 0.18, f(0.025))
    scatterLine(pts,  0.50,  0.02,  1.02, -1.82, 0.30, f(0.090))
    scatterLine(pts,  1.02, -1.82,  1.32, -3.55, 0.24, f(0.082))
    scatterEllipse(pts,  1.32, -3.68, 0.38, 0.18, f(0.025))
  }

  else if (name === 'falling') {
    scatterEllipse(pts, -3.50,  0.38, 0.52, 0.60, f(0.08))
    scatterEllipse(pts, -1.45,  0.18, 1.30, 0.72, f(0.22))
    scatterLine(pts, -1.50,  1.15, -0.48,  2.18, 0.22, f(0.06))
    scatterLine(pts, -0.48,  2.18,  0.82,  2.52, 0.18, f(0.055))
    scatterLine(pts, -1.50, -0.82, -0.48, -1.82, 0.22, f(0.06))
    scatterLine(pts, -0.48, -1.82,  0.82, -2.20, 0.18, f(0.055))
    scatterEllipse(pts,  0.00,  0.00, 0.72, 0.30, f(0.050))
    scatterLine(pts,  0.30,  0.80,  1.82,  1.52, 0.28, f(0.09))
    scatterLine(pts,  1.82,  1.52,  3.52,  1.80, 0.22, f(0.085))
    scatterLine(pts,  0.30, -0.80,  1.82, -1.22, 0.28, f(0.09))
    scatterLine(pts,  1.82, -1.22,  3.52, -0.82, 0.22, f(0.085))
  }

  else if (name === 'curled') {
    scatterEllipse(pts, -0.80,  1.98, 0.52, 0.55, f(0.09))
    scatterEllipse(pts,  0.00,  0.75, 0.92, 0.92, f(0.28))
    scatterLine(pts, -0.90,  1.60, -1.42,  0.50, 0.22, f(0.07))
    scatterLine(pts, -1.42,  0.50, -0.78, -0.52, 0.18, f(0.06))
    scatterLine(pts,  0.90,  1.38,  1.32,  0.48, 0.22, f(0.07))
    scatterLine(pts,  1.32,  0.48,  0.68, -0.52, 0.18, f(0.06))
    scatterEllipse(pts, -0.20, -0.42, 0.65, 0.28, f(0.050))
    scatterLine(pts, -0.52, -0.52, -1.22, -1.82, 0.28, f(0.08))
    scatterLine(pts, -1.22, -1.82, -0.48, -2.82, 0.22, f(0.075))
    scatterLine(pts,  0.50, -0.52,  1.12, -1.62, 0.28, f(0.08))
    scatterLine(pts,  1.12, -1.62,  0.48, -2.62, 0.22, f(0.075))
  }

  else if (name === 'reaching') {
    scatterEllipse(pts,  0,    3.80, 0.52, 0.62, f(0.08))
    scatterLine(pts,     0,    3.20, 0,    2.90, 0.22, f(0.02))
    scatterEllipse(pts,  0,    1.55, 1.05, 1.40, f(0.24))
    scatterLine(pts, -1.10,  2.90, -0.90,  4.20, 0.22, f(0.07))
    scatterLine(pts, -0.90,  4.20, -0.50,  5.20, 0.18, f(0.06))
    scatterLine(pts,  1.10,  2.90,  0.90,  4.20, 0.22, f(0.07))
    scatterLine(pts,  0.90,  4.20,  0.50,  5.20, 0.18, f(0.06))
    scatterEllipse(pts,  0,    0.08, 0.78, 0.32, f(0.055))
    scatterLine(pts, -0.48,  0.00, -0.55, -1.90, 0.30, f(0.092))
    scatterLine(pts, -0.55, -1.90, -0.50, -3.65, 0.24, f(0.088))
    scatterLine(pts,  0.48,  0.00,  0.55, -1.90, 0.30, f(0.092))
    scatterLine(pts,  0.55, -1.90,  0.50, -3.65, 0.24, f(0.088))
  }

  else if (name === 'dispersed') {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const r = 1.8 + Math.random() * 3.5
      pts.push([Math.cos(a) * r * 1.6, Math.sin(a) * r, 0.3 + Math.random() * 0.5])
    }
  }

  else if (name === 'contracted') {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const r = Math.random() * 1.4
      pts.push([Math.cos(a) * r, Math.sin(a) * r * 1.3, 0.4 + Math.random() * 0.5])
    }
  }

  else {
    return buildPose('standing', n)
  }

  while (pts.length < n) pts.push([...pts[Math.floor(Math.random() * pts.length)]])
  return pts.slice(0, n)
}

export class FigureRenderer {
  constructor(container) {
    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:3;'
    container.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')

    // Offscreen canvas for blurred glow passes
    this._offA = document.createElement('canvas')  // outer halo
    this._offB = document.createElement('canvas')  // mid glow
    this._ctxA = this._offA.getContext('2d')
    this._ctxB = this._offB.getContext('2d')

    this.time    = 0
    this.color   = [180, 255, 120]

    this._poseName   = 'standing'
    this._pts        = buildPose('standing', POINT_COUNT)
    this._ptsTarget  = this._pts.map(p => [...p])
    this._morphT     = 1.0
    this._morphStart = -999
    this._morphDur   = 1.4

    // Hollow circle (30%) vs filled dot (70%) — stable per point
    this._hollow = Array.from({length: POINT_COUNT}, () => Math.random() > 0.70)

    this._resize()
    window.addEventListener('resize', () => this._resize())
  }

  _resize() {
    const w = window.innerWidth, h = window.innerHeight
    this.canvas.width  = w; this.canvas.height  = h
    this._offA.width   = w; this._offA.height   = h
    this._offB.width   = w; this._offB.height   = h
    this._scale = h * 0.42 / 4
    this._cx    = w / 2
    this._cy    = h / 2
  }

  setShape(poseName) {
    if (!poseName || poseName === this._poseName) return
    this._poseName  = poseName
    this._ptsTarget = buildPose(poseName, POINT_COUNT)
    this._morphStart = this.time
    this._morphT     = 0
  }

  setColor(r, g, b) { this.color = [r, g, b] }

  update(audio, delta) {
    this.time += delta
    const { ctx } = this
    const w = this.canvas.width, h = this.canvas.height
    const overall = audio.overall ?? 0
    const beat    = audio.beat    ?? false
    const kick    = audio.kick    ?? 0
    const [cr, cg, cb] = this.color

    ctx.clearRect(0, 0, w, h)

    // Morph
    if (this._morphStart >= 0) {
      const raw = (this.time - this._morphStart) / this._morphDur
      const t   = Math.min(1, raw)
      this._morphT = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2, 3)/2
      if (t >= 1) {
        this._pts        = this._ptsTarget.map(p => [...p])
        this._morphT     = 1.0
        this._morphStart = -999
      }
    }

    const mt         = this._morphT
    const scale      = this._scale
    const cx         = this._cx
    const cy         = this._cy
    const beatPulse  = 1 + (beat ? kick * 0.30 : 0) + overall * 0.12

    // Pre-compute all screen positions
    const pts = []
    for (let i = 0; i < POINT_COUNT; i++) {
      const base = this._pts[i]
      const targ = this._ptsTarget[i] ?? base
      const fx = base[0] + (targ[0] - base[0]) * mt
      const fy = base[1] + (targ[1] - base[1]) * mt
      const fs = base[2] + (targ[2] - base[2]) * mt
      const sx = cx + fx * scale
      const sy = cy - fy * scale
      if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue
      const dotR = (1.0 + fs * 2.0 + overall * 1.0) * beatPulse
      const alpha = Math.min(1, 0.55 + overall * 0.35 + (beat ? kick * 0.10 : 0))
      pts.push({ sx, sy, dotR, alpha, hollow: this._hollow[i] })
    }

    // ── Pass 1: outer soft halo (blurred, colored) ─────────────────────
    const ctxA = this._ctxA
    ctxA.clearRect(0, 0, w, h)
    for (const p of pts) {
      ctxA.fillStyle = `rgba(${cr},${cg},${cb},${p.alpha * 0.18})`
      ctxA.beginPath()
      ctxA.arc(p.sx, p.sy, p.dotR * 5.5, 0, Math.PI * 2)
      ctxA.fill()
    }
    ctx.save()
    ctx.filter = `blur(${22 + overall * 8}px)`
    ctx.globalCompositeOperation = 'screen'
    ctx.drawImage(this._offA, 0, 0)
    ctx.restore()

    // ── Pass 2: mid glow (moderately blurred, color→white blend) ───────
    const ctxB = this._ctxB
    ctxB.clearRect(0, 0, w, h)
    // Blend color with white: 60% color + 40% white
    const mr = Math.round(cr * 0.6 + 255 * 0.4)
    const mg = Math.round(cg * 0.6 + 255 * 0.4)
    const mb = Math.round(cb * 0.6 + 255 * 0.4)
    for (const p of pts) {
      ctxB.fillStyle = `rgba(${mr},${mg},${mb},${p.alpha * 0.42})`
      ctxB.beginPath()
      ctxB.arc(p.sx, p.sy, p.dotR * 2.5, 0, Math.PI * 2)
      ctxB.fill()
    }
    ctx.save()
    ctx.filter = `blur(${7 + overall * 3}px)`
    ctx.globalCompositeOperation = 'screen'
    ctx.drawImage(this._offB, 0, 0)
    ctx.restore()

    // ── Pass 3: bright white core dots ─────────────────────────────────
    ctx.save()
    ctx.filter = 'none'
    ctx.globalCompositeOperation = 'screen'
    // Tight glow on core
    ctx.shadowBlur  = 6 + overall * 4
    ctx.shadowColor = `rgba(${cr},${cg},${cb},0.9)`

    for (const p of pts) {
      if (p.hollow) {
        // Hollow ring — white with color tint
        ctx.strokeStyle = `rgba(${mr},${mg},${mb},${p.alpha * 0.80})`
        ctx.lineWidth   = 1.2
        ctx.beginPath()
        ctx.arc(p.sx, p.sy, p.dotR * 2.2, 0, Math.PI * 2)
        ctx.stroke()
      } else {
        // Filled white-hot core
        ctx.fillStyle = `rgba(255,255,255,${p.alpha})`
        ctx.beginPath()
        ctx.arc(p.sx, p.sy, p.dotR, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    ctx.restore()
  }

  destroy() {
    this.canvas.remove()
    this._offA.remove()
    this._offB.remove()
  }
}
