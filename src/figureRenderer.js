// Audio-reactive canvas renderer — three combined layers:
//   B. Sparse character scatter  — freq energy gates character visibility
//   C. Corner spectrum bars      — bass bottom-left, treble bottom-right
//   D. Grid distortion           — faint grid warps with audio

const SCATTER_COLS = 60   // frequency resolution
const SCATTER_ROWS = 28   // vertical cells
const CHARS = ' .:-=+*#@'
const NC    = CHARS.length

export class FigureRenderer {
  constructor(container) {
    this.canvas = document.createElement('canvas')
    this.canvas.id = 'ascii-viz'
    this.canvas.style.cssText =
      'position:fixed;inset:0;pointer-events:none;z-index:3;mix-blend-mode:screen;'
    container.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')

    this.r = 255; this.g = 255; this.b = 255
    this.beatFlash = 0
    this.colVals   = new Float32Array(SCATTER_COLS)
    this._cells      = []
    this._gridPts    = null
    this._time       = 0
    this._lyric = ''
    this._artData  = null   // { w, h, brightness: Float32Array }
    this._artAlpha = 0      // current rendered opacity (fades in)

    this._resize()
    window.addEventListener('resize', () => this._resize())
  }

  _resize() {
    this.canvas.width  = window.innerWidth
    this.canvas.height = window.innerHeight
    this._buildCells()
    this._buildGrid()
  }

  // ── B: scatter cell positions ────────────────────────────────────────────────
  _buildCells() {
    const w = this.canvas.width, h = this.canvas.height
    const pad = 50
    this._cells = []
    for (let row = 0; row < SCATTER_ROWS; row++) {
      for (let col = 0; col < SCATTER_COLS; col++) {
        const tx = col / (SCATTER_COLS - 1)
        const ty = row / (SCATTER_ROWS - 1)
        // Jitter so it doesn't look like a rigid grid
        const jx = (Math.random() - 0.5) * (w / SCATTER_COLS) * 0.65
        const jy = (Math.random() - 0.5) * (h / SCATTER_ROWS) * 0.65
        this._cells.push({
          x:     pad + tx * (w - pad * 2) + jx,
          y:     pad + ty * (h - pad * 2) + jy,
          freqT: tx,
          // Cells near bottom are denser (bass stronger there)
          densityBias: 0.5 + ty * 0.5,
        })
      }
    }
  }

  // ── D: grid intersection points ──────────────────────────────────────────────
  _buildGrid() {
    const w = this.canvas.width, h = this.canvas.height
    const sp = 85
    const gc = Math.ceil(w / sp) + 2
    const gr = Math.ceil(h / sp) + 2
    const pts = []
    for (let r = 0; r < gr; r++)
      for (let c = 0; c < gc; c++)
        pts.push({ bx: c * sp - sp * 0.5, by: r * sp - sp * 0.5 })
    this._gridPts = { cols: gc, rows: gr, pts }
  }

  // ── Public API ───────────────────────────────────────────────────────────────
  setColor(r, g, b)       { this.r = r; this.g = g; this.b = b }
  setWords()              {}
  setActiveLine(words)    { this._lyric = words || '' }

  setAlbumArt(url) {
    this._artData  = null
    this._artAlpha = 0
    if (!url) return
    console.log('[art] loading', url)
    const ART_W = 140, ART_H = 79
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      console.log('[art] loaded', img.width, img.height)
      try {
        const off = document.createElement('canvas')
        off.width = ART_W; off.height = ART_H
        const octx = off.getContext('2d')
        octx.drawImage(img, 0, 0, ART_W, ART_H)
        const data = octx.getImageData(0, 0, ART_W, ART_H).data
        const raw = new Float32Array(ART_W * ART_H)
        for (let i = 0; i < ART_W * ART_H; i++) {
          const r = data[i*4], g = data[i*4+1], b = data[i*4+2]
          raw[i] = (r * 0.299 + g * 0.587 + b * 0.114) / 255
        }
        // Contrast stretch: find 10th/90th percentile and remap
        const sorted = Float32Array.from(raw).sort()
        const lo = sorted[Math.floor(ART_W * ART_H * 0.10)]
        const hi = sorted[Math.floor(ART_W * ART_H * 0.90)]
        const range = hi - lo || 1
        const brightness = new Float32Array(ART_W * ART_H)
        for (let i = 0; i < raw.length; i++) {
          // Stretch contrast then apply power curve to emphasize subjects
          const stretched = Math.max(0, Math.min(1, (raw[i] - lo) / range))
          brightness[i] = Math.pow(stretched, 1.6)  // darken background, pop subjects
        }
        this._artData = { w: ART_W, h: ART_H, brightness }
        console.log('[art] pixel data ready')
      } catch (e) {
        console.warn('[art] getImageData failed (CORS?):', e)
      }
    }
    img.onerror = (e) => console.warn('[art] load error:', e)
    img.src = url
  }

  // ── Spectrum ─────────────────────────────────────────────────────────────────
  _getSpectrum(audio) {
    const out = new Float32Array(SCATTER_COLS)
    if (audio.dataArray) {
      const data = audio.dataArray, N = data.length
      const sr   = audio.ctx?.sampleRate ?? 44100
      const bHz  = sr / (N * 2)
      const minL = Math.log10(40), maxL = Math.log10(18000)
      for (let c = 0; c < SCATTER_COLS; c++) {
        const freq = Math.pow(10, minL + (c / (SCATTER_COLS - 1)) * (maxL - minL))
        const bin  = Math.min(Math.floor(freq / bHz), N - 1)
        const w    = Math.max(1, Math.floor(bin * 0.08))
        let sum = 0, cnt = 0
        for (let b = Math.max(0, bin - w); b <= Math.min(N - 1, bin + w); b++) { sum += data[b]; cnt++ }
        out[c] = Math.min(1, Math.pow((sum / cnt) / 255 * 1.6, 0.75))
      }
    } else {
      const zones = [
        { val: audio.kick,    lo: 0.00, hi: 0.08 },
        { val: audio.pad,     lo: 0.08, hi: 0.30 },
        { val: audio.melody,  lo: 0.30, hi: 0.65 },
        { val: audio.texture, lo: 0.65, hi: 0.88 },
        { val: audio.treble,  lo: 0.88, hi: 1.00 },
      ]
      for (let c = 0; c < SCATTER_COLS; c++) {
        const t = c / (SCATTER_COLS - 1)
        for (const z of zones) {
          if (t >= z.lo && t < z.hi) {
            const center = (z.lo + z.hi) / 2
            const sigma  = (z.hi - z.lo) / 2.5
            out[c] = z.val * Math.exp(-0.5 * ((t - center) / sigma) ** 2)
            break
          }
        }
      }
    }
    return out
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  update(audio, delta) {
    this._time += delta
    const ctx = this.ctx
    const w   = this.canvas.width, h = this.canvas.height
    const [cr, cg, cb] = [this.r, this.g, this.b]

    const spectrum = this._getSpectrum(audio)
    for (let c = 0; c < SCATTER_COLS; c++) {
      const d = spectrum[c] - this.colVals[c]
      this.colVals[c] += d * (d > 0 ? 0.72 : 0.11)
    }

    if (audio.beat) this.beatFlash = 1.0
    this.beatFlash *= Math.pow(0.84, delta * 60)

    const overall = audio.overall ?? 0
    ctx.clearRect(0, 0, w, h)

    // ── Album art ASCII background ─────────────────────────────────────────────
    if (this._artData) {
      const TARGET_ALPHA = 0.07
      this._artAlpha += (TARGET_ALPHA - this._artAlpha) * Math.min(1, delta * 4.0)
      const { w: aw, h: ah, brightness } = this._artData
      const cellW = w / aw, cellH = h / ah
      const fs = Math.max(7, Math.floor(cellH * 0.75))
      ctx.font      = `${fs}px "Courier New", monospace`
      ctx.textAlign = 'left'
      for (let row = 0; row < ah; row++) {
        for (let col = 0; col < aw; col++) {
          const lum = brightness[row * aw + col]
          if (lum < 0.25) continue  // skip background — show only subjects
          const charIdx = Math.max(1, Math.floor(lum * (NC - 1)))
          const a = this._artAlpha * lum * (1 + overall * 0.25)
          ctx.fillStyle = `rgba(${cr},${cg},${cb},${a.toFixed(3)})`
          ctx.fillText(CHARS[charIdx], col * cellW, row * cellH + cellH * 0.85)
        }
      }
    }

    // ── D: Grid ────────────────────────────────────────────────────────────────
    const { cols: gc, rows: gr, pts } = this._gridPts
    const distAmp = (0.6 + overall * 2.0 + this.beatFlash * 2.5) * 7
    const t = this._time
    const displaced = pts.map(({ bx, by }) => ({
      x: bx + Math.sin(by * 0.018 + t * 0.22) * distAmp,
      y: by + Math.sin(bx * 0.018 + t * 0.18) * distAmp,
    }))

    ctx.strokeStyle = `rgba(${cr},${cg},${cb},${0.035 + overall * 0.025})`
    ctx.lineWidth   = 0.5

    for (let r = 0; r < gr; r++) {
      ctx.beginPath()
      for (let c = 0; c < gc; c++) {
        const p = displaced[r * gc + c]
        c === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
      }
      ctx.stroke()
    }
    for (let c = 0; c < gc; c++) {
      ctx.beginPath()
      for (let r = 0; r < gr; r++) {
        const p = displaced[r * gc + c]
        r === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)
      }
      ctx.stroke()
    }

    // ── B: Scatter characters ──────────────────────────────────────────────────
    ctx.font      = '10px "Courier New", monospace'
    ctx.textAlign = 'left'
    const flash = this.beatFlash

    for (const cell of this._cells) {
      const ci      = Math.round(cell.freqT * (SCATTER_COLS - 1))
      const energy  = Math.min(1, this.colVals[ci] * cell.densityBias)
      const boosted = Math.min(1, energy + flash * 0.25)

      if (boosted < 0.04) continue

      const charIdx = Math.max(1, Math.floor(boosted * (NC - 1)))
      const alpha   = Math.min(0.75, boosted * 1.1)
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`
      ctx.fillText(CHARS[charIdx], cell.x, cell.y)
    }

    // ── Lyric text ─────────────────────────────────────────────────────────────
    if (this._lyric) {
      ctx.font        = `300 13px 'Courier New', monospace`
      ctx.textAlign   = 'center'
      ctx.shadowColor = 'rgba(0,0,0,0.85)'
      ctx.shadowBlur  = 6
      ctx.fillStyle   = '#ffffff'
      ctx.fillText(this._lyric, w * 0.5, h * 0.05)
      ctx.shadowBlur  = 0
      ctx.textAlign   = 'left'
    }
  }
}
