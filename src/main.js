import './style.css'
import { login, handleCallback, isLoggedIn, startPolling, initPlayer, transferPlayback } from './spotify.js'
import { AudioAnalyzer } from './audio.js'
import { AudioSync } from './audioSync.js'
import { Visualizer } from './visualizer.js'
// import { DataOverlay } from './overlay.js'

const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const app = document.getElementById('app')

// ── UI elements ──
const loginScreen = el('div', 'login-screen', `
  <h1>Notyet</h1><p>Music Visualizer</p>
  <button id="login-btn">Connect Spotify</button>
`)
loginScreen.id = 'login-screen'

const audioSource = el('div', 'audio-source', `
  <h2>Audio Source</h2>
  <button class="source-btn" id="btn-spotify">Spotify App<small>Sync with Spotify playback (Premium required)</small></button>
  <button class="source-btn" id="btn-system">System Audio<small>Share screen with audio</small></button>
  <button class="source-btn" id="btn-mic">Microphone<small>Capture via mic</small></button>
`)
audioSource.id = 'audio-source'

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
app.appendChild(audioSource)
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
  showAudioSourcePicker()
}

function showLogin() {
  loginScreen.style.display = 'flex'
  document.getElementById('login-btn').addEventListener('click', login)
}

function showAudioSourcePicker() {
  loginScreen.style.display = 'none'
  audioSource.style.display = 'flex'
  document.getElementById('btn-spotify').addEventListener('click', startSpotifyMode)
  document.getElementById('btn-system').addEventListener('click', () => startAudioMode('system'))
  document.getElementById('btn-mic').addEventListener('click',    () => startAudioMode('mic'))
}

// ── Spotify SDK mode ──
async function startSpotifyMode() {
  audioSource.style.display = 'none'
  const statusEl = el('div', 'login-screen', `<h1>Notyet</h1><p>Connecting to Spotify...</p>`)
  app.appendChild(statusEl)

  try {
    await initPlayer(
      async (deviceId) => { await transferPlayback(deviceId) },
      () => {},
      (err) => {
        statusEl.querySelector('p').textContent = `Error: ${err}`
        if (err.includes('account')) {
          statusEl.innerHTML += `<p style="color:rgba(255,255,255,0.4);font-size:.75rem;margin-top:8px">Spotify Basic may not support Web Playback SDK.</p>`
          const btn = document.createElement('button')
          btn.id = 'login-btn'; btn.textContent = 'Use System Audio'
          btn.addEventListener('click', () => { statusEl.remove(); showAudioSourcePicker() })
          statusEl.appendChild(btn)
        }
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

// ── Mic / System mode ──
async function startAudioMode(sourceType) {
  audioSource.style.display = 'none'
  const analyzer = new AudioAnalyzer()
  try {
    if (sourceType === 'mic') await analyzer.startMic()
    else await analyzer.startSystem()
  } catch (e) {
    alert(`Audio error: ${e.message}`)
    showAudioSourcePicker()
    return
  }
  launchVisualizer(analyzer)
}

// ── Launch ──
function launchVisualizer(audioSource) {
  const visualizer = new Visualizer(app)

  nowPlaying.style.display    = 'block'
  analysisToggle.style.display = 'flex'

  startPolling((track, features, analysis) => {
    nowPlaying.querySelector('.track').textContent  = track.name
    nowPlaying.querySelector('.artist').textContent = track.artists.map(a => a.name).join(', ')
    visualizer._drawGhost(track.name)

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
    updateMeters(audioSource)
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
