import './style.css'
import { login, handleCallback, isLoggedIn, startPolling, initPlayer, transferPlayback, getLyrics, getPlaybackState, skipToNext, skipToPrevious } from './spotify.js'
import { analyzeLyrics } from './moodAnalyzer.js'
import { AudioSync } from './audioSync.js'
import { Visualizer } from './visualizer.js'
import { DataOverlay } from './overlay.js'
import { FigureRenderer } from './figureRenderer.js'
import { generatePoster } from './posterGenerator.js'

const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const app = document.getElementById('app')

// ── UI elements ──
const loginScreen = el('div', 'login-screen', `
  <h1>Notyet</h1><p>Music Visualizer</p>
  <button id="login-btn">Connect Spotify</button>
`)
loginScreen.id = 'login-screen'

const nowPlaying = el('div', 'now-playing', `
  <div class="track-row">
    <button class="skip-btn" id="skip-prev" title="Previous (←)">&#8249;</button>
    <div class="track-info">
      <div class="track"></div>
      <div class="artist"></div>
    </div>
    <button class="skip-btn" id="skip-next" title="Next (→)">&#8250;</button>
  </div>
`)
nowPlaying.id = 'now-playing'

const mapToggle = el('button', 'map-toggle', 'MAP')
mapToggle.id = 'map-toggle'
mapToggle.title = 'Word Map'

const invertBtn = el('button', 'invert-btn', '◑')
invertBtn.id = 'invert-btn'
invertBtn.title = 'Invert Colors'

const captureBtn = el('button', 'capture-btn', '⬡')
captureBtn.id = 'capture-btn'
captureBtn.title = 'Capture (⌘S)'

const posterBtn = el('button', 'capture-btn', '⊞')
posterBtn.id = 'poster-btn'
posterBtn.title = 'Poster'

const analysisToggle = el('button', 'analysis-toggle', '◈')
analysisToggle.id = 'analysis-toggle'
analysisToggle.title = 'Analysis'

const analysisPanel = el('div', null, `
  <div class="panel-section">
    <div class="panel-label">Instruments</div>
    ${meterHTML('kick',    'Kick')}
    ${meterHTML('melody',  'Melody')}
    ${meterHTML('texture', 'Texture')}
    ${meterHTML('pad',     'Pad')}
  </div>
  <div class="divider"></div>
  <div class="panel-section">
    <div class="panel-label">Frequency</div>
    ${meterHTML('bass',    'Bass')}
    ${meterHTML('mid',     'Mid')}
    ${meterHTML('treble',  'Treble')}
  </div>
  <div class="divider"></div>
  <div class="panel-section" id="info-section">
    <div class="panel-label">Track</div>
    ${infoHTML('energy',  'Energy',  '—')}
    ${infoHTML('valence', 'Valence', '—')}
    ${infoHTML('tempo',   'Tempo',   '—')}
    ${infoHTML('key',     'Key',     '—')}
  </div>
`)

analysisPanel.id = 'analysis-panel'

app.appendChild(loginScreen)
app.appendChild(nowPlaying)
app.appendChild(invertBtn)
app.appendChild(mapToggle)
app.appendChild(captureBtn)
app.appendChild(posterBtn)
app.appendChild(analysisToggle)
app.appendChild(analysisPanel)

// ── Map toggle ──
let overlayRef = null
mapToggle.addEventListener('mouseenter', () => {
  mapToggle.classList.add('active')
  overlayRef?.setMapPinned(true)
})
mapToggle.addEventListener('mouseleave', () => {
  mapToggle.classList.remove('active')
  overlayRef?.setMapPinned(false)
})

// ── Capture button — short press: screenshot, long press (500ms): poster ──
let _capturePressTimer = null
captureBtn.addEventListener('pointerdown', () => {
  _capturePressTimer = setTimeout(() => {
    _capturePressTimer = null
    capturePoster()
  }, 500)
})
captureBtn.addEventListener('pointerup', () => {
  if (_capturePressTimer) {
    clearTimeout(_capturePressTimer)
    _capturePressTimer = null
    captureVisuals()
  }
})
captureBtn.addEventListener('pointerleave', () => {
  if (_capturePressTimer) { clearTimeout(_capturePressTimer); _capturePressTimer = null }
})

// ── Invert ──
let _inverted = false
invertBtn.addEventListener('click', toggleInvert)

function toggleInvert() {
  _inverted = !_inverted
  document.body.classList.toggle('inverted', _inverted)
  invertBtn.classList.toggle('active', _inverted)
}

// ── Toggle ──
analysisToggle.addEventListener('click', () => {
  const open = analysisPanel.style.display === 'flex'
  analysisPanel.style.display = open ? 'none' : 'flex'
  analysisToggle.classList.toggle('active', !open)
})

// ── Boot ──
async function boot() {
  if (window.location.search.includes('code=')) {
    const ok = await handleCallback()
    if (!ok) { showLogin(); return }
  }
  if (!isLoggedIn()) { showLogin(); return }
  startSpotifyMode()
}

function showLogin() {
  loginScreen.style.display = 'flex'
  document.getElementById('login-btn').addEventListener('click', login)
}

// ── Spotify SDK mode ──
async function startSpotifyMode() {
  loginScreen.style.display = 'none'
  const statusEl = el('div', 'login-screen', `<h1>Notyet</h1><p>Connecting to Spotify...</p>`)
  app.appendChild(statusEl)

  try {
    await initPlayer(
      async (deviceId) => { await transferPlayback(deviceId) },
      () => {},
      (err) => {
        statusEl.querySelector('p').textContent = `Error: ${err}`
      }
    )

    statusEl.remove()
    const audioSync = new AudioSync()
    audioSync.start()
    launchVisualizer(audioSync)

  } catch (e) {
    if (app.contains(statusEl)) statusEl.querySelector('p').textContent = `Failed: ${e.message}`
  }
}

// ── Track state ──
let _currentTrack    = null
let _currentFeatures = null
let _currentAnalysis = null

// ── Lyrics state ──
let _lyrics       = null
let _moodMap      = null
let _lyricsPos    = 0
let _lyricsFetch  = performance.now()
let _lyricsActive = false
let _lastLine     = ''
let _lastLineIdx  = -1

function _findCurrentLine(posMs) {
  if (!_lyrics) return null
  let current = null
  let idx = -1
  for (let i = 0; i < _lyrics.length; i++) {
    if (_lyrics[i].startTimeMs <= posMs) { current = _lyrics[i]; idx = i }
    else break
  }
  return current ? { words: current.words, idx } : null
}

function _startPositionPolling(onPause) {
  async function poll() {
    try {
      const state = await getPlaybackState()
      if (state?.progress_ms != null) {
        _lyricsPos   = state.progress_ms
        _lyricsFetch = performance.now()
        const playing = !!state.is_playing
        if (!playing && _lastLine) onPause?.()
        _lyricsActive = playing && !!_lyrics?.length
      }
    } catch {}
  }
  poll()
  setInterval(poll, 1000)
}

// Detect word repetition in a lyric line → 0 (no repeat) to 1 (all same word)
function detectRepeatFactor(line) {
  const words = line.toLowerCase().replace(/[^\w가-힣\s]/g, '').split(/\s+/).filter(w => w.length > 1)
  if (words.length < 3) return 0
  const freq = {}
  for (const w of words) freq[w] = (freq[w] || 0) + 1
  const maxRep = Math.max(...Object.values(freq))
  const ratio = maxRep / words.length
  return ratio > 0.4 ? Math.min(1, (ratio - 0.4) * 2.5) : 0
}

// ── Launch ──
function launchVisualizer(audioSource) {
  const visualizer     = new Visualizer(app)
  const figureRenderer = new FigureRenderer(app)
  const overlay        = new DataOverlay(app)
  overlayRef = overlay

  nowPlaying.style.display     = 'block'
  mapToggle.style.display      = 'flex'
  captureBtn.style.display     = 'flex'
  posterBtn.style.display      = 'flex'
  analysisToggle.style.display = 'flex'

  document.getElementById('skip-prev').addEventListener('click', skipToPrevious)
  document.getElementById('skip-next').addEventListener('click', skipToNext)

  _startPositionPolling(() => {
    overlay.setSubtitle('')
    figureRenderer.setActiveLine('')
    _lastLine = ''
  })

  let _currentTrackId = null

  startPolling(async (track, features, analysis) => {
    const trackId = track.id ?? track.name
    _currentTrackId = trackId

    _currentTrack    = track
    _currentFeatures = features  ?? _currentFeatures
    _currentAnalysis = analysis  ?? _currentAnalysis

    nowPlaying.querySelector('.track').textContent  = track.name
    nowPlaying.querySelector('.artist').textContent = track.artists.map(a => a.name).join(', ')

    // Clear previous song state immediately
    _lyrics = null
    _moodMap = null
    _lyricsActive = false
    _lastLine = ''
    _lastLineIdx = -1
    overlay.setSubtitle('')
    overlay.setLines([])
    overlay.clearAccumRings()
    overlay.setTrack(track.name)
    figureRenderer.setActiveLine('')
    figureRenderer.setWords([])
    figureRenderer.setAlbumArt(track.album?.images?.[0]?.url ?? null)
    visualizer.resetMood()

    const lines = await getLyrics(track)
    // Guard: ignore if a newer track has already taken over
    if (_currentTrackId !== trackId) return

    console.log('[lyrics]', track.name, lines ? `${lines.length} lines` : 'not found')
    if (lines?.length) {
      _lyrics = lines
      _lyricsActive = true
      _lastLine = ''
      _lastLineIdx = -1
      visualizer.lyricsMode = true
      overlay.setLines(lines)
      figureRenderer.setWords(lines)
      // Analyze mood in background — no await, applies when ready
      analyzeLyrics(track.name, track.artists?.[0]?.name, lines).then(map => {
        if (map && _currentTrackId === trackId) {
          _moodMap = map
          console.log('[mood] ready', Object.keys(map).length, 'lines')
          overlay.refineWithKeywords(map)
        }
      })
    } else {
      visualizer.lyricsMode = false
    }

    if (features) {
      visualizer.setFeatures(features)
      updateInfoPanel(features)
    }
    if (analysis && audioSource.setAnalysis) audioSource.setAnalysis(analysis, features)
  })

  let lastTime = performance.now()
  function animate() {
    requestAnimationFrame(animate)
    const now   = performance.now()
    const delta = (now - lastTime) / 1000
    lastTime    = now
    audioSource.update()
    visualizer.setInvert(_inverted)
    visualizer.update(audioSource, delta)
    const color = _inverted ? [0, 0, 0] : visualizer.accentRGB
    overlay.setColor(...color)
    overlay.update(audioSource, delta)
    figureRenderer.setColor(...color)
    figureRenderer.update(audioSource, delta)
    updateMeters(audioSource)

    // Lyrics sync — extrapolate position between polls
    if (_lyricsActive) {
      const elapsed = performance.now() - _lyricsFetch
      const pos = _lyricsPos + elapsed
      const result = _findCurrentLine(pos)
      if (result && result.words !== _lastLine) {
        _lastLine = result.words
        _lastLineIdx = result.idx
        const mood = _moodMap?.[result.idx] ?? null
        const repeatFactor = detectRepeatFactor(result.words)
        visualizer.setLyricLine(result.words, mood)
        overlay.setRepeat(repeatFactor, result.words)
        overlay.setLineMood(mood)
        overlay.setSubtitle(result.words)
        figureRenderer.setActiveLine(result.words)


      }
    }
  }
  animate()
}

// ── Panel updates ──
function updateMeters(audio) {
  setMeter('kick',    audio.kick    ?? audio.bass)
  setMeter('melody',  audio.melody  ?? audio.mid)
  setMeter('texture', audio.texture ?? audio.treble)
  setMeter('pad',     audio.pad     ?? audio.overall)
  setMeter('bass',    audio.bass)
  setMeter('mid',     audio.mid)
  setMeter('treble',  audio.treble)
}

function setMeter(id, value) {
  const bar = document.getElementById(`meter-bar-${id}`)
  const val = document.getElementById(`meter-val-${id}`)
  if (!bar || !val) return
  const pct = Math.round((value ?? 0) * 100)
  bar.style.width = pct + '%'
  val.textContent = pct
}

function updateInfoPanel(features) {
  setInfo('energy',  Math.round(features.energy  * 100) / 100)
  setInfo('valence', Math.round(features.valence * 100) / 100)
  setInfo('tempo',   Math.round(features.tempo) + ' bpm')
  const key  = KEY_NAMES[features.key]  ?? '?'
  const mode = features.mode === 1 ? 'Maj' : 'Min'
  setInfo('key', `${key} ${mode}`)
}

function setInfo(id, value) {
  const el = document.getElementById(`info-val-${id}`)
  if (el) el.textContent = value
}

// ── Helpers ──
function el(tag, className, html = '') {
  const e = document.createElement(tag)
  if (className) e.className = className
  e.innerHTML = html
  return e
}

function meterHTML(id, label) {
  return `
    <div class="meter-row">
      <span class="meter-name">${label}</span>
      <div class="meter-bar-wrap"><div class="meter-bar" id="meter-bar-${id}" style="width:0%"></div></div>
      <span class="meter-val" id="meter-val-${id}">0</span>
    </div>`
}

function infoHTML(id, label, defaultVal) {
  return `
    <div class="info-row">
      <span class="info-key">${label}</span>
      <span class="info-value" id="info-val-${id}">${defaultVal}</span>
    </div>`
}

posterBtn.addEventListener('click', () => capturePoster())

// ── Poster ──
async function capturePoster() {
  captureBtn.classList.add('flash')
  setTimeout(() => captureBtn.classList.remove('flash'), 300)
  const poster = await generatePoster({
    track:    _currentTrack,
    features: _currentFeatures,
    moodMap:  _moodMap,
    lyrics:   _lyrics,
    analysis: _currentAnalysis,
  })
  const a = document.createElement('a')
  a.download = `notyet-poster-${Date.now()}.png`
  a.href = poster.toDataURL('image/png')
  a.click()
}

// ── Capture ──
function captureVisuals() {
  captureBtn.classList.add('flash')
  setTimeout(() => captureBtn.classList.remove('flash'), 300)
  const canvases = [...document.querySelectorAll('canvas')]
    .filter(c => c.style.display !== 'none' && c.width > 0 && c.height > 0)
  if (!canvases.length) return

  const out = document.createElement('canvas')
  out.width  = window.innerWidth
  out.height = window.innerHeight
  const ctx = out.getContext('2d')
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, out.width, out.height)
  for (const c of canvases) {
    try { ctx.drawImage(c, 0, 0, out.width, out.height) } catch {}
  }

  const a = document.createElement('a')
  a.download = `notyet-${Date.now()}.png`
  a.href = out.toDataURL('image/png')
  a.click()
}

// ── Keyboard shortcuts ──
document.addEventListener('keydown', e => {
  if (!isLoggedIn()) return
  if (e.key === 'ArrowRight') { e.preventDefault(); skipToNext() }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); skipToPrevious() }
  if (e.key === 's' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); captureVisuals() }
})

boot()
