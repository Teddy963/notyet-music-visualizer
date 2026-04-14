import './style.css'
import { login, handleCallback, isLoggedIn, startPolling, initPlayer, transferPlayback, getLyrics, getPlaybackState } from './spotify.js'
import { analyzeLyrics } from './moodAnalyzer.js'
import { AudioSync } from './audioSync.js'
import { Visualizer } from './visualizer.js'
import { DataOverlay } from './overlay.js'
import { LyricGraph } from './lyricGraph.js'
import { FigureRenderer } from './figureRenderer.js'

const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const app = document.getElementById('app')

// ── UI elements ──
const loginScreen = el('div', 'login-screen', `
  <h1>Notyet</h1><p>Music Visualizer</p>
  <button id="login-btn">Connect Spotify</button>
`)
loginScreen.id = 'login-screen'

const nowPlaying = el('div', 'now-playing', `<div class="track"></div><div class="artist"></div>`)
nowPlaying.id = 'now-playing'

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
app.appendChild(analysisToggle)
app.appendChild(analysisPanel)

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

// ── Lyrics state ──
let _lyrics       = null
let _moodMap      = null   // index → mood params from Claude
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

function _startPositionPolling() {
  async function poll() {
    try {
      const state = await getPlaybackState()
      if (state?.progress_ms != null) {
        _lyricsPos   = state.progress_ms
        _lyricsFetch = performance.now()
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
  const lyricGraph     = new LyricGraph(app)
  lyricGraph.canvas.style.display = 'none'

  nowPlaying.style.display    = 'block'
  analysisToggle.style.display = 'flex'

  _startPositionPolling()

  let _currentTrackId = null

  startPolling(async (track, features, analysis) => {
    const trackId = track.id ?? track.name
    _currentTrackId = trackId

    nowPlaying.querySelector('.track').textContent  = track.name
    nowPlaying.querySelector('.artist').textContent = track.artists.map(a => a.name).join(', ')

    // Clear previous song state
    _lyrics = null
    _lyricsActive = false
    _lastLine = ''
    overlay.setSubtitle('')
    figureRenderer.setActiveLine('')
    overlay.clearAccumRings()
    overlay.setTrack(track.name)
    lyricGraph.setTrack(track.name)
    figureRenderer.setRandomShape()
    figureRenderer.setAlbumArt(track.album?.images?.[0]?.url ?? null)

    const lines = await getLyrics(track)
    // Guard: ignore if a newer track has already taken over
    if (_currentTrackId !== trackId) return

    console.log('[lyrics]', track.name, lines ? `${lines.length} lines` : 'not found')
    _moodMap = null
    if (lines?.length) {
      _lyrics = lines
      _lyricsActive = true
      _lastLine = ''
      _lastLineIdx = -1
      visualizer.lyricsMode = true
      lyricGraph.setLines(lines)
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
    visualizer.update(audioSource, delta)
    overlay.setColor(...visualizer.accentRGB)
    overlay.update(audioSource, delta)
    figureRenderer.setColor(...visualizer.accentRGB)
    figureRenderer.update(audioSource, delta)
    lyricGraph.update(audioSource, delta)
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
        figureRenderer.setLineMood(mood)

        lyricGraph.setActiveIndex(result.idx)
        lyricGraph.setColor(...visualizer.accentRGB)
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

boot()
