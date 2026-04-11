import { getPlaybackState } from './spotify.js'

export class AudioSync {
  constructor() {
    this.analysis = null
    this.features = null

    // Frequency bands
    this.bass    = 0
    this.mid     = 0
    this.treble  = 0
    this.overall = 0
    this.beat    = false

    // Instrument values (from timbre + pitch analysis)
    this.kick    = 0  // percussive attack
    this.melody  = 0  // brightness / melodic content
    this.texture = 0  // flatness / textural complexity
    this.pad     = 0  // smooth sustained energy

    // Raw timbre array for panel display (12 values, normalized 0-1)
    this.timbre = new Array(12).fill(0)

    this._position     = 0
    this._lastFetch    = 0
    this._lastFetchPos = 0
    this._isPlaying    = false
    this._beatIndex    = 0
    this._barIndex     = 0
    this._segmentIndex = 0
    this._prevBeat     = false

    this.running = false
    this._pollInterval = null
  }

  setAnalysis(analysis, features) {
    this.analysis = analysis
    this.features = features
    this._beatIndex    = 0
    this._barIndex     = 0
    this._segmentIndex = 0
  }

  start() {
    this.running = true
    this._pollPosition()
    this._pollInterval = setInterval(() => this._pollPosition(), 2000)
  }

  stop() {
    this.running = false
    clearInterval(this._pollInterval)
  }

  async _pollPosition() {
    try {
      const state = await getPlaybackState()
      if (!state) return
      this._lastFetchPos = state.progress_ms
      this._lastFetch    = performance.now()
      this._isPlaying    = state.is_playing
    } catch (e) { /* silent */ }
  }

  update() {
    if (!this.running) return

    const elapsed = this._isPlaying ? (performance.now() - this._lastFetch) : 0
    this._position = this._lastFetchPos + elapsed
    const t = this._position / 1000

    if (this.analysis) {
      this._updateBeat(t)
      this._updateSegment(t)
    } else if (this._isPlaying) {
      // No analysis available — simulate basic rhythmic values
      this._simulateAudio(t)
    }
  }

  _simulateAudio(t) {
    // ~120 BPM pulse
    const bpm = (this.features?.tempo ?? 120)
    const beatPeriod = 60 / bpm
    const phase = (t % beatPeriod) / beatPeriod

    const beatPulse = Math.max(0, 1 - phase * 8)
    this.kick    = beatPulse
    this.beat    = phase < 0.06 && !this._prevBeat
    this._prevBeat = phase < 0.06

    this.overall = 0.45 + Math.sin(t * 1.3) * 0.15 + beatPulse * 0.3
    this.bass    = 0.4  + beatPulse * 0.4
    this.mid     = 0.35 + Math.sin(t * 2.1 + 1) * 0.2
    this.treble  = 0.25 + Math.sin(t * 3.7 + 2) * 0.15
    this.melody  = 0.3  + Math.sin(t * 1.7) * 0.2
    this.texture = 0.25 + Math.sin(t * 2.3 + 0.5) * 0.15
    this.pad     = 0.4  + Math.sin(t * 0.8) * 0.2
  }

  _updateBeat(t) {
    const beats = this.analysis.beats
    if (!beats?.length) return

    while (this._beatIndex < beats.length - 1 && t >= beats[this._beatIndex + 1].start)
      this._beatIndex++

    const beat     = beats[this._beatIndex]
    const progress = (t - beat.start) / beat.duration

    const onBeat = progress < 0.07 && beat.confidence > 0.4
    this.beat      = onBeat && !this._prevBeat
    this._prevBeat = onBeat

    // kick: pulse at beat start weighted by confidence
    this.kick = Math.max(0, (1 - progress * 3)) * beat.confidence
  }

  _updateSegment(t) {
    const segs = this.analysis.segments
    if (!segs?.length) return

    while (this._segmentIndex < segs.length - 1 && t >= segs[this._segmentIndex + 1].start)
      this._segmentIndex++

    const seg    = segs[this._segmentIndex]
    const pitches = seg.pitches  || new Array(12).fill(0)
    const timbre  = seg.timbre   || new Array(12).fill(0)

    // Loudness → overall
    const loudness = seg.loudness_max ?? -30
    this.overall = Math.max(0, Math.min(1, (loudness + 60) / 60))

    // Pitch → freq bands
    this.bass   = pitches.slice(0, 3).reduce((a, b) => a + b, 0) / 3
    this.mid    = pitches.slice(3, 8).reduce((a, b) => a + b, 0) / 5
    this.treble = pitches.slice(8).reduce((a, b)  => a + b, 0) / 4

    // Timbre → instrument proxies
    // t[0]: loudness (large positive = loud), t[1]: brightness, t[3]: attack
    // Spotify timbre range is roughly -200 to +200 per coefficient
    const tn = v => Math.max(0, Math.min(1, (v + 100) / 200))

    this.melody  = tn(timbre[1])                          // brightness → melodic/piano
    this.texture = tn(timbre[2])                          // flatness   → guitar/texture
    this.pad     = this.overall * (1 - tn(timbre[3]))     // smooth non-percussive → pad

    // Normalized timbre array for display
    this.timbre = timbre.map(tn)
  }
}
