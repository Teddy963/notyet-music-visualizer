// Web Audio API — real-time frequency + instrument analysis
export class AudioAnalyzer {
  constructor() {
    this.ctx = null
    this.analyser = null
    this.dataArray = null
    this.source = null
    this.running = false

    // Frequency bands
    this.bass    = 0
    this.mid     = 0
    this.treble  = 0
    this.overall = 0
    this.beat    = false

    // Instrument approximations from FFT
    this.kick    = 0  // sub-bass spike (kick drum)
    this.melody  = 0  // upper-mid (piano, vocals)
    this.texture = 0  // high-mid (guitar, strings)
    this.pad     = 0  // low-mid smooth (bass guitar, pads)

    // Timbre: not available from raw audio — set to null so panel can show N/A
    this.timbre = null
  }

  async startMic() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    this._init(stream)
  }

  async startSystem() {
    const stream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
    const audioTrack = stream.getAudioTracks()[0]
    if (!audioTrack) throw new Error('No audio track found. Enable "Share audio" in the screen share dialog.')
    stream.getVideoTracks().forEach(t => t.stop())
    this._init(new MediaStream([audioTrack]))
  }

  _init(stream) {
    this.ctx = new AudioContext()
    this.analyser = this.ctx.createAnalyser()
    this.analyser.fftSize = 2048
    this.analyser.smoothingTimeConstant = 0.6
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount)
    this.source = this.ctx.createMediaStreamSource(stream)
    this.source.connect(this.analyser)
    this.running = true
  }

  update() {
    if (!this.running || !this.analyser) return

    this.analyser.getByteFrequencyData(this.dataArray)

    const sampleRate = this.ctx.sampleRate
    const binSize = sampleRate / this.analyser.fftSize
    const bufLen = this.dataArray.length

    const hz = f => Math.min(Math.floor(f / binSize), bufLen - 1)

    // Gain boost — 1.5x with power curve to preserve dynamic range
    const gain = v => Math.min(1, Math.pow(v * 1.5, 0.9))

    this.bass    = gain(this._avg(hz(20),   hz(250))  / 255)
    this.mid     = gain(this._avg(hz(250),  hz(4000)) / 255)
    this.treble  = gain(this._avg(hz(4000), hz(16000))/ 255)
    this.overall = gain(this._avg(0,        bufLen)   / 255)

    // Instrument bands
    this.kick    = gain(this._avg(hz(20),   hz(80))   / 255)
    this.pad     = gain(this._avg(hz(80),   hz(800))  / 255)
    this.melody  = gain(this._avg(hz(800),  hz(3000)) / 255)
    this.texture = gain(this._avg(hz(3000), hz(8000)) / 255)

    this._detectBeat()
  }

  _avg(start, end) {
    if (start >= end) return 0
    let sum = 0
    for (let i = start; i < end; i++) sum += this.dataArray[i]
    return sum / (end - start)
  }

  _detectBeat() {
    if (!this._beatHistory) this._beatHistory = new Array(43).fill(0)
    this._beatHistory.shift()
    this._beatHistory.push(this.kick)
    const avg = this._beatHistory.reduce((a, b) => a + b) / this._beatHistory.length
    const variance = this._beatHistory.reduce((a, b) => a + (b - avg) ** 2, 0) / this._beatHistory.length
    this.beat = this.kick > Math.max(avg * 1.5, 0.08) && variance > 0.001
  }

  stop() {
    if (this.source) this.source.disconnect()
    if (this.ctx) this.ctx.close()
    this.running = false
  }
}
