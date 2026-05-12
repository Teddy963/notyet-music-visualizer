const CLIENT_ID = '809ab25495f2458d9327cafde9974c09'

const isLocal =
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname === 'localhost'

const REDIRECT_URI = isLocal
  ? 'http://127.0.0.1:5173/callback'
  : 'https://notyet-music-visualizer.vercel.app/callback'
const SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'streaming',
  'user-modify-playback-state',
  'user-library-modify',
  'user-library-read',
].join(' ')

// PKCE helpers
function generateRandomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const arr = new Uint8Array(length)
  crypto.getRandomValues(arr)
  return Array.from(arr).map(v => chars[v % chars.length]).join('')
}

async function sha256(plain) {
  const encoder = new TextEncoder()
  const data = encoder.encode(plain)
  return crypto.subtle.digest('SHA-256', data)
}

function base64urlEncode(buffer) {
  const bytes = new Uint8Array(buffer)
  let str = ''
  bytes.forEach(b => { str += String.fromCharCode(b) })
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// Auth
export async function login() {
  const verifier = generateRandomString(64)
  const challenge = base64urlEncode(await sha256(verifier))
  localStorage.setItem('pkce_verifier', verifier)

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
  })

  window.location.href = `https://accounts.spotify.com/authorize?${params}`
}

export async function handleCallback() {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('code')
  if (!code) return false

  const verifier = localStorage.getItem('pkce_verifier')
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    }),
  })

  const data = await res.json()
  if (!data.access_token) return false

  localStorage.setItem('access_token', data.access_token)
  localStorage.setItem('refresh_token', data.refresh_token)
  localStorage.setItem('token_expires', Date.now() + data.expires_in * 1000)

  window.history.replaceState({}, '', '/')
  return true
}

async function refreshToken() {
  const token = localStorage.getItem('refresh_token')
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: token,
    }),
  })
  const data = await res.json()
  if (data.access_token) {
    localStorage.setItem('access_token', data.access_token)
    localStorage.setItem('token_expires', Date.now() + data.expires_in * 1000)
    if (data.refresh_token) localStorage.setItem('refresh_token', data.refresh_token)
  }
}

export async function getToken() {
  const expires = parseInt(localStorage.getItem('token_expires') || '0')
  if (Date.now() > expires - 60000) await refreshToken()
  return localStorage.getItem('access_token')
}

export function isLoggedIn() {
  return !!localStorage.getItem('access_token')
}

// Validate token by hitting /me — returns false if token is bad
export async function validateToken() {
  const token = await getToken()
  if (!token) return false
  const res = await fetch('https://api.spotify.com/v1/me', {
    headers: { Authorization: `Bearer ${token}` },
  })
  return res.ok
}

export function logout() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  localStorage.removeItem('token_expires')
  localStorage.removeItem('pkce_verifier')
}

// API calls
const getRateLimit = () => parseInt(localStorage.getItem('rl_until') || '0')
const setRateLimit = (until) => localStorage.setItem('rl_until', String(until))

async function apiFetch(path) {
  if (Date.now() < getRateLimit()) return null  // still in backoff
  const token = await getToken()
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 204) return null
  if (res.status === 429) {
    const retry = parseInt(res.headers.get('Retry-After') || '10')
    setRateLimit(Date.now() + retry * 1000)
    console.warn(`[spotify] 429 rate limited — backing off ${retry}s`)
    return null
  }
  if (res.status === 403 || res.status === 404) return null
  if (!res.ok) { console.warn(`[spotify] ${res.status} on ${path}`); return null }
  return res.json()
}

async function apiPost(path) {
  if (Date.now() < getRateLimit()) return
  const token = await getToken()
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 429) {
    const retry = parseInt(res.headers.get('Retry-After') || '10')
    setRateLimit(Date.now() + retry * 1000)
  }
}

async function apiPut(path, body) {
  if (Date.now() < getRateLimit()) return
  const token = await getToken()
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.status === 429) {
    const retry = parseInt(res.headers.get('Retry-After') || '10')
    setRateLimit(Date.now() + retry * 1000)
  }
}

export const skipToNext     = () => apiPost('/me/player/next')
export const skipToPrevious = () => apiPost('/me/player/previous')
export const togglePlay     = () => getPlayer()?.togglePlay()
export const saveTrack      = (id) => apiPut(`/me/tracks?ids=${id}`, {})
export const unsaveTrack    = async (id) => {
  const token = await getToken()
  await fetch(`https://api.spotify.com/v1/me/tracks?ids=${id}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  })
}
export const isTrackSaved   = async (id) => {
  const data = await apiFetch(`/me/tracks/contains?ids=${id}`)
  return Array.isArray(data) ? data[0] : false
}

export async function getRecommendations(track, keywords = []) {
  // /recommendations (404) and top-tracks (403) blocked for new apps.
  // Lyrics-based: search by Claude-extracted mood keywords. Fallback: artist name.
  const query = keywords.length
    ? keywords.slice(0, 4).join(' ')
    : `artist:${track?.artists?.[0]?.name ?? ''}`
  if (!query.trim()) return []
  const params = new URLSearchParams({ q: query, type: 'track', limit: 8 })
  const data = await apiFetch(`/search?${params}`)
  const tracks = data?.tracks?.items ?? []
  return tracks.filter(t => t.id !== track.id).slice(0, 7)
}

export function playTrack(trackUri) {
  return apiPut('/me/player/play', { uris: [trackUri] })
}

export async function getCurrentTrack() {
  return apiFetch('/me/player/currently-playing')
}

export async function getAudioFeatures(trackId) {
  return apiFetch(`/audio-features/${trackId}`)
}

export async function getAudioAnalysis(trackId) {
  return apiFetch(`/audio-analysis/${trackId}`)
}

export async function getPlaybackState() {
  return apiFetch('/me/player')
}

// lrclib.net — free synced lyrics, no CORS issues
export async function getLyrics(track) {
  try {
    const artist   = track.artists?.[0]?.name ?? ''
    const name     = track.name ?? ''
    const album    = track.album?.name ?? ''
    const duration = Math.round((track.duration_ms ?? 0) / 1000)

    const params = new URLSearchParams({ artist_name: artist, track_name: name, album_name: album, duration })
    const res = await fetch(`https://lrclib.net/api/get?${params}`)
    if (!res.ok) return null

    const data = await res.json()
    const lrc  = data.syncedLyrics || data.plainLyrics
    if (!lrc) return null

    // Parse LRC format: [mm:ss.xx] text  OR plain text lines
    if (data.syncedLyrics) {
      return lrc.split('\n')
        .map(line => {
          const m = line.match(/^\[(\d+):(\d+\.\d+)\]\s*(.*)$/)
          if (!m) return null
          const ms = (parseInt(m[1]) * 60 + parseFloat(m[2])) * 1000
          return { startTimeMs: ms, words: m[3] }
        })
        .filter(l => l && l.words.trim())
    } else {
      // Unsyced — return as single block, no timing
      return lrc.split('\n').filter(l => l.trim()).map((words, i) => ({ startTimeMs: i * 4000, words }))
    }
  } catch {
    return null
  }
}

let _player = null
export const getPlayer = () => _player

// SDK-native polling — uses player_state_changed event (no HTTP) for track changes.
// Audio features/analysis still use REST but only once per track change.
export function startPolling(onUpdate) {
  let lastTrackId = null

  async function handleState(state) {
    if (!state) return
    const sdkTrack = state.track_window?.current_track
    if (!sdkTrack) return
    const trackId = sdkTrack.id
    if (!trackId || trackId === lastTrackId) return
    lastTrackId = trackId

    // Convert SDK track format to REST-compatible shape
    const track = {
      id: sdkTrack.id,
      name: sdkTrack.name,
      uri: sdkTrack.uri,
      duration_ms: sdkTrack.duration_ms,
      artists: sdkTrack.artists,
      album: sdkTrack.album,
    }

    const [features, analysis] = await Promise.all([
      getAudioFeatures(trackId).catch(() => null),
      getAudioAnalysis(trackId).catch(() => null),
    ])
    onUpdate(track, features, analysis)
  }

  return handleState  // caller attaches this to player_state_changed
}

// Web Playback SDK
export function initPlayer(onReady, onStateChange, onError) {
  return new Promise((resolve) => {
    const ready = () => {
      getToken().then(() => {
        const player = new window.Spotify.Player({
          name: 'Notyet Visualizer',
          getOAuthToken: cb => getToken().then(cb),
          volume: 0.8,
        })

        player.addListener('ready', ({ device_id }) => {
          _player = player
          onReady(device_id)
          resolve({ player, device_id })
        })

        player.addListener('player_state_changed', onStateChange)

        player.addListener('initialization_error', ({ message }) => onError('init: ' + message))
        player.addListener('authentication_error', ({ message }) => onError('auth: ' + message))
        player.addListener('account_error', ({ message }) => onError('account: ' + message))
        player.addListener('playback_error', ({ message }) => onError('playback: ' + message))

        player.connect()
      })
    }

    window.onSpotifyWebPlaybackSDKReady = ready

    if (!document.querySelector('script[src*="spotify-player"]')) {
      const script = document.createElement('script')
      script.src = 'https://sdk.scdn.co/spotify-player.js'
      document.head.appendChild(script)
    }
  })
}

// Transfer playback to the browser player
export async function transferPlayback(deviceId) {
  await apiPut('/me/player', { device_ids: [deviceId], play: true })
}
