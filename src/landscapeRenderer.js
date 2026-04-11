// Procedural scene background — mood-driven environment
// Scene type determined by hue + energy from Claude mood analysis
// z-index: 1 (above Three.js at z:0, below figureRenderer at z:3)

// Scene types mapped from mood hue + energy:
//   field    — hue 60-140, low-mid energy  (green/yellow, calm nature)
//   rain     — hue 180-240, low energy     (blue, melancholic)
//   embers   — hue 0-50 or 320-360, high   (warm, intense)
//   void     — hue 200-280, low energy     (dark blue/purple, lonely)
//   aurora   — hue 140-200, mid energy     (cyan/teal, ethereal)
//   city     — any hue, very high energy   (urban, geometric)

function hslToRgb(h, s, l) {
  s /= 100; l /= 100
  const k = n => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return [Math.round(f(0)*255), Math.round(f(8)*255), Math.round(f(4)*255)]
}

export class LandscapeRenderer {
  constructor(container) {
    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1;'
    container.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')

    this.time   = 0
    this.color  = [180, 255, 120]

    this._scene      = 'field'
    this._sceneNext  = null
    this._sceneT     = 1.0   // transition progress 0→1
    this._mood       = null

    // Scene-specific generated data
    this._blades  = []  // field
    this._drops   = []  // rain
    this._embers  = []  // embers
    this._stars   = []  // void/aurora
    this._lines   = []  // city

    this._resize()
    this._buildScene(this._scene)
    window.addEventListener('resize', () => { this._resize(); this._buildScene(this._scene) })
  }

  _resize() {
    this.canvas.width  = window.innerWidth
    this.canvas.height = window.innerHeight
  }

  setColor(r, g, b) { this.color = [r, g, b] }

  setMood(mood) {
    if (!mood) return
    this._mood = mood

    const hue    = mood.hue    ?? 120
    const energy = mood.energy ?? 0.5

    let next
    if (energy > 0.78)                         next = 'city'
    else if (hue >= 320 || hue < 50)           next = energy > 0.5 ? 'embers' : 'void'
    else if (hue >= 50  && hue < 140)          next = 'field'
    else if (hue >= 140 && hue < 200)          next = 'aurora'
    else if (hue >= 200 && hue < 260)          next = 'rain'
    else                                        next = 'void'

    if (next !== this._scene && next !== this._sceneNext) {
      this._sceneNext = next
      this._sceneT    = 0
      this._buildScene(next)
    }
  }

  _buildScene(type) {
    const w = this.canvas.width, h = this.canvas.height

    if (type === 'field') {
      this._blades = []
      const count = Math.floor(w * 0.85)
      for (let i = 0; i < count; i++) {
        const layer = Math.random()
        this._blades.push({
          x: Math.random() * w,
          baseY: h * 0.60 + layer * h * 0.42,
          height: 12 + layer * 48 + Math.random() * 18,
          lean: (Math.random() - 0.5) * 0.5,
          width: 0.4 + layer * 1.4,
          phase: Math.random() * Math.PI * 2,
          layer,
        })
      }
      this._blades.sort((a, b) => a.layer - b.layer)
    }

    if (type === 'rain') {
      this._drops = []
      for (let i = 0; i < 320; i++) {
        this._drops.push({
          x: Math.random() * w,
          y: Math.random() * h,
          len: 8 + Math.random() * 22,
          speed: 280 + Math.random() * 280,
          alpha: 0.08 + Math.random() * 0.22,
          width: 0.4 + Math.random() * 0.6,
        })
      }
    }

    if (type === 'embers') {
      this._embers = []
      for (let i = 0; i < 180; i++) {
        this._embers.push({
          x: Math.random() * w,
          y: h * 0.5 + Math.random() * h * 0.5,
          vx: (Math.random() - 0.5) * 18,
          vy: -(12 + Math.random() * 30),
          life: Math.random(),
          size: 1 + Math.random() * 2.5,
          alpha: 0.4 + Math.random() * 0.5,
        })
      }
    }

    if (type === 'void' || type === 'aurora') {
      this._stars = []
      const count = type === 'aurora' ? 120 : 280
      for (let i = 0; i < count; i++) {
        this._stars.push({
          x: Math.random() * w,
          y: Math.random() * h * 0.72,
          r: 0.5 + Math.random() * 1.8,
          alpha: 0.08 + Math.random() * 0.35,
          phase: Math.random() * Math.PI * 2,
          speed: 0.3 + Math.random() * 0.8,
        })
      }
    }

    if (type === 'city') {
      this._lines = []
      for (let i = 0; i < 40; i++) {
        const y = h * 0.3 + Math.random() * h * 0.65
        this._lines.push({
          y,
          x1: Math.random() * w * 0.3,
          x2: w * 0.6 + Math.random() * w * 0.4,
          alpha: 0.04 + Math.random() * 0.16,
          width: 0.5 + Math.random() * 1.5,
          phase: Math.random() * Math.PI * 2,
          speed: 0.2 + Math.random() * 0.6,
        })
      }
    }
  }

  _drawScene(type, alpha, audio) {
    const { ctx } = this
    const w = this.canvas.width, h = this.canvas.height
    const overall = audio.overall ?? 0
    const beat    = audio.beat    ?? false
    const [cr, cg, cb] = this.color

    ctx.save()
    ctx.globalAlpha = alpha

    if (type === 'field') {
      const horizon = h * 0.60
      // Ground
      const ground = ctx.createLinearGradient(0, horizon - 10, 0, h)
      ground.addColorStop(0,    `rgba(${Math.round(cr*0.08)},${Math.round(cg*0.20)},${Math.round(cb*0.06)},0.78)`)
      ground.addColorStop(0.5,  `rgba(${Math.round(cr*0.03)},${Math.round(cg*0.09)},${Math.round(cb*0.02)},0.88)`)
      ground.addColorStop(1,    `rgba(0,0,0,0.95)`)
      ctx.fillStyle = ground
      ctx.fillRect(0, horizon - 10, w, h - horizon + 10)
      // Horizon glow
      const mist = ctx.createLinearGradient(0, horizon - 40, 0, horizon + 50)
      mist.addColorStop(0,   `rgba(${cr},${cg},${cb},0)`)
      mist.addColorStop(0.5, `rgba(${cr},${cg},${cb},${0.02 + overall * 0.025})`)
      mist.addColorStop(1,   `rgba(${cr},${cg},${cb},0)`)
      ctx.fillStyle = mist
      ctx.fillRect(0, horizon - 40, w, 90)
      // Grass
      const wind = Math.sin(this.time * 0.7) * 2.8 + Math.sin(this.time * 1.4) * 1.1
      ctx.lineCap = 'round'
      for (const b of this._blades) {
        const d = b.layer
        const a = (0.10 + d * 0.40 + overall * d * 0.08)
        const br = Math.round(cr * (0.04 + d * 0.10))
        const bg = Math.round(cg * (0.10 + d * 0.35))
        const bb = Math.round(cb * (0.03 + d * 0.08))
        const sway = (wind + Math.sin(this.time * 0.9 + b.phase) * 1.2) * (0.2 + d * 0.8) * (1 + overall * 0.35)
        ctx.strokeStyle = `rgba(${br},${bg},${bb},${a})`
        ctx.lineWidth   = b.width
        ctx.beginPath()
        ctx.moveTo(b.x, b.baseY)
        ctx.quadraticCurveTo(b.x + sway * 0.4, b.baseY - b.height * 0.55, b.x + b.lean * b.height + sway, b.baseY - b.height)
        ctx.stroke()
      }
    }

    else if (type === 'rain') {
      // Dark sky gradient
      const sky = ctx.createLinearGradient(0, 0, 0, h)
      sky.addColorStop(0, `rgba(${Math.round(cr*0.04)},${Math.round(cg*0.06)},${Math.round(cb*0.12)},0.72)`)
      sky.addColorStop(1, `rgba(0,0,0,0.88)`)
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, h)
      // Rain drops
      ctx.lineCap = 'round'
      for (const d of this._drops) {
        d.y += d.speed * (1 + overall * 0.6) * 0.016
        if (d.y > h + d.len) { d.y = -d.len; d.x = Math.random() * w }
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${d.alpha})`
        ctx.lineWidth   = d.width
        ctx.beginPath()
        ctx.moveTo(d.x, d.y)
        ctx.lineTo(d.x - 2, d.y + d.len)
        ctx.stroke()
      }
    }

    else if (type === 'embers') {
      // Dark warm gradient at bottom
      const ground = ctx.createLinearGradient(0, h * 0.55, 0, h)
      ground.addColorStop(0, `rgba(${Math.round(cr*0.12)},${Math.round(cg*0.04)},0,0.0)`)
      ground.addColorStop(1, `rgba(${Math.round(cr*0.10)},${Math.round(cg*0.03)},0,0.72)`)
      ctx.fillStyle = ground; ctx.fillRect(0, h * 0.55, w, h * 0.45)
      // Embers rising
      for (const e of this._embers) {
        e.life += 0.008 + overall * 0.012
        if (e.life > 1) {
          e.life = 0; e.x = Math.random() * w
          e.y = h * 0.7 + Math.random() * h * 0.3
          e.vx = (Math.random() - 0.5) * 18
        }
        e.y += e.vy * 0.016
        e.x += e.vx * 0.016 + Math.sin(this.time * 1.2 + e.life * 6) * 0.4
        const fa = e.alpha * (1 - e.life * e.life)
        ctx.beginPath()
        ctx.arc(e.x, e.y, e.size * (1 - e.life * 0.5), 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${cr},${Math.round(cg*0.4)},0,${fa})`
        ctx.fill()
      }
    }

    else if (type === 'void') {
      // Deep dark gradient
      const bg = ctx.createRadialGradient(w*0.5, h*0.4, 0, w*0.5, h*0.4, h*0.7)
      bg.addColorStop(0, `rgba(${Math.round(cr*0.04)},${Math.round(cg*0.04)},${Math.round(cb*0.10)},0.45)`)
      bg.addColorStop(1, `rgba(0,0,0,0.90)`)
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h)
      // Sparse stars
      for (const s of this._stars) {
        const pulse = Math.sin(this.time * s.speed + s.phase) * 0.3
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${s.alpha + pulse * 0.1})`
        ctx.fill()
      }
    }

    else if (type === 'aurora') {
      // Sweeping horizontal light bands
      for (let i = 0; i < 4; i++) {
        const bandY = h * (0.15 + i * 0.12) + Math.sin(this.time * 0.3 + i * 1.2) * h * 0.04
        const bandH = h * 0.08
        const band = ctx.createLinearGradient(0, bandY, 0, bandY + bandH)
        const ba = (0.04 + overall * 0.06) * (1 - i * 0.18)
        band.addColorStop(0,   `rgba(${cr},${cg},${cb},0)`)
        band.addColorStop(0.5, `rgba(${cr},${cg},${cb},${ba})`)
        band.addColorStop(1,   `rgba(${cr},${cg},${cb},0)`)
        ctx.fillStyle = band
        ctx.fillRect(0, bandY, w, bandH)
      }
      // Stars
      for (const s of this._stars) {
        const pulse = Math.sin(this.time * s.speed + s.phase) * 0.25
        ctx.beginPath()
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${cr},${cg},${cb},${s.alpha + pulse * 0.08})`
        ctx.fill()
      }
    }

    else if (type === 'city') {
      // Dark gradient
      const bg = ctx.createLinearGradient(0, 0, 0, h)
      bg.addColorStop(0, `rgba(0,0,0,0.60)`)
      bg.addColorStop(1, `rgba(${Math.round(cr*0.06)},${Math.round(cg*0.06)},${Math.round(cb*0.12)},0.85)`)
      ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h)
      // Horizontal light streaks
      ctx.lineCap = 'butt'
      for (const l of this._lines) {
        const pulse = Math.sin(this.time * l.speed + l.phase) * 0.5 + 0.5
        const a = l.alpha * (0.5 + pulse * 0.5 + overall * 0.3)
        ctx.strokeStyle = `rgba(${cr},${cg},${cb},${a})`
        ctx.lineWidth   = l.width
        ctx.beginPath()
        ctx.moveTo(l.x1, l.y); ctx.lineTo(l.x2, l.y)
        ctx.stroke()
      }
    }

    ctx.restore()
  }

  update(audio, delta) {
    this.time += delta
    const { ctx } = this
    const w = this.canvas.width, h = this.canvas.height

    ctx.clearRect(0, 0, w, h)

    if (this._sceneNext) {
      this._sceneT = Math.min(1, this._sceneT + delta / 2.5)  // 2.5s crossfade
      this._drawScene(this._scene,     1 - this._sceneT, audio)
      this._drawScene(this._sceneNext, this._sceneT,     audio)
      if (this._sceneT >= 1) {
        this._scene     = this._sceneNext
        this._sceneNext = null
      }
    } else {
      this._drawScene(this._scene, 1, audio)
    }
  }

  destroy() { this.canvas.remove() }
}
