const CLIENT_ID = '809ab25495f2458d9327cafde9974c09'
const REDIRECT_URI = 'http://127.0.0.1:5173/callback'
const SCOPES = [
  'user-read-currently-playing',
  'user-read-playback-state',
  'streaming',
  'user-modify-playback-state',
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

export function logout() {
  localStorage.removeItem('access_token')
  localStorage.removeItem('refresh_token')
  localStorage.removeItem('token_expires')
  localStorage.removeItem('pkce_verifier')
}

// API calls
async function apiFetch(path) {
  const token = await getToken()
  const res = await fetch(`https://api.spotify.com/v1${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (res.status === 204 || res.status === 404 || res.status === 403) return null
  if (!res.ok) return null
  return res.json()
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

export async function getLyrics(trackId) {
  try {
    const token = await getToken()
    const res = await fetch(
      `https://spclient.wg.spotify.com/color-lyrics/v2/track/${trackId}?format=json&vocalRemoval=false&market=from_token`,
      { headers: { Authorization: `Bearer ${token}`, 'app-platform': 'WebPlayer' } }
    )
    if (!res.ok) return null
    const data = await res.json()
    return data?.lyrics?.lines ?? null
  } catch {
    return null
  }
}

// Poll current track + features, call onUpdate(track, features, analysis) when track changes
export function startPolling(onUpdate) {
  let lastTrackId = null

  async function poll() {
    try {
      const playing = await getCurrentTrack()
      if (!playing?.item) return

      const trackId = playing.item.id
      if (trackId === lastTrackId) return
      lastTrackId = trackId

      const [features, analysis] = await Promise.all([
        getAudioFeatures(trackId).catch(() => null),
        getAudioAnalysis(trackId).catch(() => null),
      ])
      onUpdate(playing.item, features, analysis)
    } catch (e) {
      console.warn('Spotify poll error:', e)
    }
  }

  poll()
  return setInterval(poll, 5000)
}

// Web Playback SDK
export function initPlayer(onReady, onStateChange, onError) {
  return new Promise((resolve) => {
    const ready = () => {
      getToken().then(token => {
        const player = new window.Spotify.Player({
          name: 'Notyet Visualizer',
          getOAuthToken: cb => getToken().then(cb),
          volume: 0.8,
        })

        player.addListener('ready', ({ device_id }) => {
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

    if (window.Spotify) {
      ready()
    } else {
      window.onSpotifyWebPlaybackSDKReady = ready
    }
  })
}

// Transfer playback to the browser player
export async function transferPlayback(deviceId) {
  const token = await getToken()
  await fetch('https://api.spotify.com/v1/me/player', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ device_ids: [deviceId], play: true }),
  })
}
