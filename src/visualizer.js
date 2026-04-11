import * as THREE from 'three'

// ── Simplex noise GLSL ───────────────────────────────────────────────────────
const NOISE_GLSL = `
vec3 mod289v3(vec3 x){return x-floor(x*(1./289.))*289.;}
vec4 mod289v4(vec4 x){return x-floor(x*(1./289.))*289.;}
vec4 permute(vec4 x){return mod289v4(((x*34.)+1.)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1./6.,1./3.);const vec4 D=vec4(0.,.5,1.,2.);
  vec3 i=floor(v+dot(v,C.yyy)),x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz),l=1.-g;
  vec3 i1=min(g.xyz,l.zxy),i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx,x2=x0-i2+C.yyy,x3=x0-D.yyy;
  i=mod289v3(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.,i1.z,i2.z,1.))+i.y+vec4(0.,i1.y,i2.y,1.))+i.x+vec4(0.,i1.x,i2.x,1.));
  float n_=.142857142857;vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.*floor(p*ns.z*ns.z),x_=floor(j*ns.z),y_=floor(j-7.*x_);
  vec4 x=x_*ns.x+ns.yyyy,y=y_*ns.x+ns.yyyy,h=1.-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy),b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.+1.,s1=floor(b1)*2.+1.,sh=-step(h,vec4(0.));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy,a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x),p1=vec3(a0.zw,h.y),p2=vec3(a1.xy,h.z),p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.);m=m*m;
  return 42.*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}
`

// ── Particle shader ──────────────────────────────────────────────────────────
const particleVert = NOISE_GLSL + `
  attribute float aSize;
  attribute vec3  aColor;
  attribute float aOffset;
  attribute float aRadius;
  attribute vec3  aTarget;

  uniform float uTime;
  uniform float uBeat;
  uniform float uOverall;
  uniform float uInstrument;
  uniform float uReact;
  uniform float uRotSpeed;
  uniform float uSpread;
  uniform float uSpeed;
  uniform float uMorph;
  uniform float uNoiseScale;

  varying vec3  vColor;
  varying float vAlpha;

  void main(){
    vColor = aColor;
    // Morph between sphere position and target pose
    vec3 pos = mix(position, aTarget, uMorph);

    // Spread: contract (0) ↔ expand (1) — scales the whole form
    float spreadScale = 0.78 + uSpread * 0.44;
    pos *= spreadScale;

    // True 3D morphing — speed controlled by uSpeed
    float t = uTime * (0.06 + uSpeed * 0.1);
    float energy = (0.18 + uInstrument * uReact * 0.7 + uBeat * uReact * 0.2) * (0.6 + uSpread * 0.8);
    vec3 nb = pos * 0.35 + vec3(t);
    pos.x += snoise(nb + vec3(17.3,  0.0,  0.0)) * uNoiseScale * energy;
    pos.y += snoise(nb + vec3( 0.0, 31.7,  0.0)) * uNoiseScale * energy;
    pos.z += snoise(nb + vec3( 0.0,  0.0, 53.1)) * uNoiseScale * 0.8 * energy;

    // Second octave
    vec3 nb2 = pos * 0.8 + vec3(t * 1.6 + 5.3);
    pos.x += snoise(nb2 + vec3(7.1, 0.0, 0.0)) * 0.1 * energy;
    pos.y += snoise(nb2 + vec3(0.0, 11.4, 0.0)) * 0.1 * energy;

    // Breathing — speed-driven
    float breathe = sin(uTime * (0.7 + uSpeed * 0.8) + aOffset * 0.5) * 0.04;
    pos *= 1.0 + breathe;

    // Drift
    float drift = uInstrument * uReact * 0.3;
    float dAngle = uTime * uRotSpeed + aOffset;
    pos.x += sin(dAngle) * drift;
    pos.y += cos(dAngle * 0.7) * drift;
    pos.z += sin(dAngle * 0.5 + 1.0) * drift * 0.4;

    vAlpha = 0.03 + uOverall * 0.28 + uBeat * uReact * 0.18;

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * (380.0 / -mvPos.z) * (1.0 + uInstrument * uReact * 1.2 + uBeat * uReact * 0.8);
    gl_Position = projectionMatrix * mvPos;
  }
`

const particleFrag = `
  uniform float uOverall;
  varying vec3 vColor; varying float vAlpha;
  void main(){
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if(d > 0.5) discard;
    // Gray base — color bleeds in with energy
    float lum = dot(vColor, vec3(0.299, 0.587, 0.114));
    vec3 gray = vec3(lum * 0.55);
    float colorize = smoothstep(0.05, 0.7, uOverall);
    vec3 finalColor = mix(gray, vColor, colorize);
    gl_FragColor = vec4(finalColor, smoothstep(0.5, 0.0, d) * vAlpha);
  }
`

// ── Glitch post-process shader ───────────────────────────────────────────────
const glitchVert = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position,1.0); }`

const glitchFrag = `
  uniform sampler2D uScene;
  uniform float uTime;
  uniform float uBass;
  uniform float uBeat;
  uniform float uOverall;
  uniform float uMid;
  uniform float uEnergy;
  varying vec2 vUv;

  float rand(vec2 co){ return fract(sin(dot(co,vec2(12.9898,78.233)))*43758.5453); }

  void main(){
    vec2 uv = vUv;

    // ── Subtle chromatic aberration ──
    float aber = uBeat * 0.003 + uBass * 0.0015 + uOverall * 0.001;
    float r = texture2D(uScene, uv + vec2( aber, aber * 0.3)).r;
    float g = texture2D(uScene, uv                          ).g;
    float b = texture2D(uScene, uv - vec2( aber, aber * 0.3)).b;
    vec3 col = vec3(r, g, b);

    // ── Fine film grain ──
    float grain = (rand(vUv + fract(uTime * 0.5)) - 0.5) * 0.028 * (0.5 + uOverall * 0.5);
    col += grain;

    // ── Vignette ──
    vec2 vig = vUv * 2.0 - 1.0;
    col *= 1.0 - dot(vig, vig) * 0.42;

    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  }
`

// ── Layer config ─────────────────────────────────────────────────────────────
// figure=true  → tight pose, no rotation, small particles (silhouette reads)
// figure=false → additive glow, free rotation
const LAYERS = [
  { name:'rings',      count:500,  pose:null,       poseScale:1.0,  sizeRange:[0.2,0.7],  react:0.35, rotSpeed:0.10, ring:true,  instrument:'texture', figure:false, noiseScale:0.35 },
  { name:'atmosphere', count:2200, pose:'dispersed',poseScale:3.2,  sizeRange:[0.25,0.9], react:0.08, rotSpeed:0.03, ring:false, instrument:'pad',     figure:false, noiseScale:0.35 },
]

// ── Pose generators ──────────────────────────────────────────────────────────
function randSphere(r){ const th=Math.random()*Math.PI*2,ph=Math.acos(2*Math.random()-1);return[r*Math.sin(ph)*Math.cos(th),r*Math.sin(ph)*Math.sin(th),r*Math.cos(ph)] }
function randEllipsoid(rx,ry,rz){ const [x,y,z]=randSphere(1);return[x*rx,y*ry,z*rz] }
function randCylinder(r,h){ const a=Math.random()*Math.PI*2,t=(Math.random()-.5)*h;return[r*Math.cos(a),t,r*Math.sin(a)] }

function generatePose(name, count) {
  const pts = new Float32Array(count * 3)
  const w = (x,y,z,i)=>{ pts[i*3]=x; pts[i*3+1]=y; pts[i*3+2]=z }

  for (let i = 0; i < count; i++) {
    let p
    const t = i / count

    if (name === 'standing') {
      // Head 8%, torso 35%, arms 20%, legs 37%
      if (t < 0.08)      { p = randSphere(0.22); p[1] += 1.35 }
      else if (t < 0.43) { p = randEllipsoid(0.22, 0.45, 0.18); p[1] += 0.7 }
      else if (t < 0.63) {
        const side = t < 0.53 ? -1 : 1
        p = randEllipsoid(0.35, 0.1, 0.1)
        p[0] = p[0] * 0.5 + side * 0.38; p[1] += 0.75
      }
      else {
        const side = t < 0.815 ? -1 : 1
        p = randEllipsoid(0.1, 0.48, 0.1)
        p[0] += side * 0.12; p[1] -= 0.25
      }
    }
    else if (name === 'running') {
      if (t < 0.08)      { p = randSphere(0.22); p[1] += 1.35; p[0] -= 0.1 }
      else if (t < 0.43) { p = randEllipsoid(0.22, 0.42, 0.18); p[1] += 0.68; p[0] -= 0.08 }
      else if (t < 0.53) { p = randEllipsoid(0.3,0.1,0.1); p[0] -= 0.5; p[1] += 1.0 }   // front arm
      else if (t < 0.63) { p = randEllipsoid(0.3,0.1,0.1); p[0] += 0.45; p[1] += 0.45 }  // back arm
      else if (t < 0.815){ p = randEllipsoid(0.1,0.45,0.1); p[0] += 0.15; p[1] -= 0.15; p[2] += 0.2 } // front leg
      else               { p = randEllipsoid(0.1,0.42,0.1); p[0] -= 0.12; p[1] -= 0.35; p[2] -= 0.25 } // back leg
    }
    else if (name === 'falling') {
      if (t < 0.08)      { p = randSphere(0.22); p[1] += 0.5; p[0] -= 0.8 }
      else if (t < 0.43) { p = randEllipsoid(0.45, 0.22, 0.18); p[0] -= 0.2; p[1] += 0.1 }
      else if (t < 0.63) { p = randEllipsoid(0.4,0.1,0.1); p[1] += (t<0.53 ? 0.35 : -0.1); p[0] += (t<0.53 ? 0.3 : -0.6) }
      else               { p = randEllipsoid(0.1,0.48,0.1); p[0] += (t<0.815 ? 0.5 : -0.1); p[1] -= 0.5 }
    }
    else if (name === 'curled') {
      if (t < 0.1)       { p = randSphere(0.22); p[1] += 0.3; p[0] -= 0.3; p[2] += 0.15 }
      else if (t < 0.5)  { p = randEllipsoid(0.28, 0.28, 0.22); p[1] -= 0.1 }
      else               { p = randEllipsoid(0.12, 0.35, 0.12); const a=(t-.5)*Math.PI*2.5; p[0]=Math.cos(a)*0.4; p[1]=Math.sin(a)*0.3-.2; p[2]=0.1 }
    }
    else if (name === 'reaching') {
      if (t < 0.08)      { p = randSphere(0.22); p[1] += 1.5 }
      else if (t < 0.43) { p = randEllipsoid(0.22, 0.45, 0.18); p[1] += 0.75 }
      else if (t < 0.63) { p = randEllipsoid(0.1, 0.5, 0.1); p[0] += (t<0.53 ? -0.35 : 0.35); p[1] += 1.25 }
      else               { const s=t<0.815?-1:1; p=randEllipsoid(0.1,0.48,0.1); p[0]+=s*0.12; p[1]-=0.25 }
    }
    else if (name === 'dispersed') {
      p = randSphere(2.0 + Math.random() * 2.0)
    }
    else if (name === 'contracted') {
      p = randSphere(0.5 + Math.random() * 0.3)
    }
    else { // default sphere
      p = randSphere(0.5 + Math.random() * 1.2)
    }

    w(p[0], p[1], p[2], i)
  }
  return pts
}

function hsl(h,s,l){
  h=((h%360)+360)%360;s/=100;l/=100
  const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l)
  const f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)))
  return[f(0),f(8),f(4)]
}

function buildLayer(cfg){
  const {count,pose,poseScale,sizeRange,react,rotSpeed,ring,figure,noiseScale}=cfg
  const pos=new Float32Array(count*3),col=new Float32Array(count*3)
  const sz=new Float32Array(count),off=new Float32Array(count),rad=new Float32Array(count)
  const tgt=new Float32Array(count*3)

  // Initial positions: pose-based or ring/sphere fallback
  if(pose){
    const pts=generatePose(pose,count)
    for(let i=0;i<count;i++){
      pos[i*3]  =pts[i*3]  *poseScale
      pos[i*3+1]=pts[i*3+1]*poseScale
      pos[i*3+2]=pts[i*3+2]*poseScale
    }
  } else {
    for(let i=0;i<count;i++){
      const theta=Math.random()*Math.PI*2
      const r=2.0+Math.random()*1.2
      if(ring){pos[i*3]=r*Math.cos(theta);pos[i*3+1]=(Math.random()-.5)*.2;pos[i*3+2]=r*Math.sin(theta)}
      else{const phi=Math.acos(2*Math.random()-1);pos[i*3]=r*Math.sin(phi)*Math.cos(theta);pos[i*3+1]=r*Math.sin(phi)*Math.sin(theta);pos[i*3+2]=r*Math.cos(phi)}
    }
  }

  for(let i=0;i<count;i++){
    col[i*3]=1;col[i*3+1]=1;col[i*3+2]=1
    sz[i]=sizeRange[0]+Math.random()*(sizeRange[1]-sizeRange[0])
    off[i]=Math.random()*Math.PI*2
    const p=pos.slice(i*3,i*3+3)
    rad[i]=Math.sqrt(p[0]*p[0]+p[1]*p[1]+p[2]*p[2])
  }
  const geo=new THREE.BufferGeometry()
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3))
  geo.setAttribute('aTarget', new THREE.BufferAttribute(tgt,3))
  geo.setAttribute('aColor',  new THREE.BufferAttribute(col,3))
  geo.setAttribute('aSize',   new THREE.BufferAttribute(sz,1))
  geo.setAttribute('aOffset', new THREE.BufferAttribute(off,1))
  geo.setAttribute('aRadius', new THREE.BufferAttribute(rad,1))
  const uniforms={
    uTime:{value:0},uBeat:{value:0},uOverall:{value:0},
    uInstrument:{value:0},uReact:{value:react},uRotSpeed:{value:rotSpeed},
    uSpread:{value:0.5},uSpeed:{value:0.5},uMorph:{value:0},
    uNoiseScale:{value:noiseScale??0.35},
  }
  const blending = figure ? THREE.NormalBlending : THREE.AdditiveBlending
  const mat=new THREE.ShaderMaterial({
    vertexShader:particleVert,fragmentShader:particleFrag,uniforms,
    transparent:true,depthWrite:false,blending,
  })
  const pts = new THREE.Points(geo,mat)
  pts.renderOrder = figure ? 1 : 0
  return{cfg,points:pts,uniforms,colorAttr:geo.getAttribute('aColor'),targetAttr:geo.getAttribute('aTarget'),count}
}

// ── Visualizer ───────────────────────────────────────────────────────────────
export class Visualizer {
  constructor(container){
    this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:true})
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2))
    this.renderer.setSize(window.innerWidth,window.innerHeight)
    this.renderer.setClearColor(0x000000,0)
    container.appendChild(this.renderer.domElement)

    // Main scene
    this.scene=new THREE.Scene()
    this.camera=new THREE.PerspectiveCamera(75,window.innerWidth/window.innerHeight,0.1,1000)
    this.camera.position.z=3.2

    // Render target for glitch pass
    this._rt=new THREE.WebGLRenderTarget(window.innerWidth,window.innerHeight,{
      minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,
    })

    // Glitch post-process scene
    this._glitchUniforms={
      uScene:    {value:this._rt.texture},
      uTime:     {value:0},
      uBass:     {value:0},
      uBeat:     {value:0},
      uOverall:  {value:0},
      uMid:      {value:0},
      uEnergy:   {value:0.5},
    }
    const glitchMesh=new THREE.Mesh(
      new THREE.PlaneGeometry(2,2),
      new THREE.ShaderMaterial({
        vertexShader:glitchVert,fragmentShader:glitchFrag,
        uniforms:this._glitchUniforms,depthWrite:false,
      })
    )
    this._glitchScene=new THREE.Scene()
    this._glitchScene.add(glitchMesh)
    this._glitchCam=new THREE.OrthographicCamera(-1,1,1,-1,0,1)

    this.time=0
    this.audioState={kick:0,melody:0,texture:0,pad:0,overall:0,beat:0,bass:0,mid:0,treble:0}
    this.features={energy:0.5,valence:0.5,danceability:0.5,acousticness:0.5,tempo:120}

    this._layers=LAYERS.map(cfg=>{const l=buildLayer(cfg);this.scene.add(l.points);return l})
    this._layers[0].points.rotation.x=Math.PI*0.18
    this._layers[0].points.rotation.z=Math.PI*0.06

    // Ghost text background
    this._ghostCanvas = document.createElement('canvas')
    this._ghostCanvas.width = 512; this._ghostCanvas.height = 512
    this._ghostTex = new THREE.CanvasTexture(this._ghostCanvas)
    const ghostMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.MeshBasicMaterial({ map: this._ghostTex, transparent: true, opacity: 1, depthWrite: false })
    )
    ghostMesh.position.z = -4
    ghostMesh.visible = false
    this.scene.add(ghostMesh)
    this._ghostMesh = ghostMesh
    this._ghostTrack = ''
    this._drawGhost('NOTYET')

    this.lyricsMode = false
    this._lyricEntryTime = -999
    this._ghostScale = 1.0
    // Mood state (from Claude analysis)
    this._mood = { hue: 200, sat: 65, energy: 0.5, spread: 0.5, speed: 0.5 }
    this._moodTarget = null
    this._moodLerp = 0
    // Pose morphing state
    this._morphStart = undefined
    this._morphDuration = 1.5
    this._morphHold = 4.0
    // Expose accent color for overlay
    this.accentRGB=[220,255,80]

    this._onResize=this._onResize.bind(this)
    window.addEventListener('resize',this._onResize)
  }

  setFeatures(features){
    if (!features) return
    // Guard against NaN values from Spotify
    const clean = {}
    for (const [k, v] of Object.entries(features)) {
      if (v !== null && v !== undefined && !isNaN(v)) clean[k] = v
    }
    if (Object.keys(clean).length === 0) return
    this._spotifyFeatures = true
    this.features = { ...this.features, ...clean }
    this._updateColors()
  }

  setLyricLine(text, moodParams) {
    this._lyricEntryTime = this.time
    if (moodParams) {
      this._moodTarget = moodParams
      this._moodLerp = 0
      if (moodParams.shape) this.setShape(moodParams.shape)
    }
  }

  setShape(poseName) {
    this._layers.forEach(layer => {
      const newTargets = generatePose(poseName, layer.count)
      layer.targetAttr.array.set(newTargets)
      layer.targetAttr.needsUpdate = true
    })
    this._morphStart = this.time
  }

  _tickMood(delta) {
    if (!this._moodTarget) return
    this._moodLerp = Math.min(1, this._moodLerp + delta * 1.2) // ~0.8s transition
    const t = this._moodLerp
    const lerp = (a, b) => a + (b - a) * t
    this._mood.hue    = lerp(this._mood.hue,    this._moodTarget.hue)
    this._mood.sat    = lerp(this._mood.sat,    this._moodTarget.sat)
    this._mood.energy = lerp(this._mood.energy, this._moodTarget.energy)
    this._mood.spread = lerp(this._mood.spread, this._moodTarget.spread)
    this._mood.speed  = lerp(this._mood.speed,  this._moodTarget.speed)
    if (t >= 1) this._moodTarget = null

    // Apply mood colors to particles
    const accentHue = (this._mood.hue + 150) % 360
    const [ar, ag, ab] = hsl(accentHue, this._mood.sat, 60)
    this.accentRGB = [Math.round(ar*255), Math.round(ag*255), Math.round(ab*255)]

    const palette = [
      { hue: accentHue,        sat: this._mood.sat * 0.9,  lb: 48, lv: 12 },
      { hue: this._mood.hue,   sat: this._mood.sat * 0.7,  lb: 18, lv: 10 },
    ]
    this._layers.forEach((layer, li) => {
      const { hue, sat: s, lb, lv } = palette[li]
      const arr = layer.colorAttr.array
      for (let i = 0; i < layer.count; i++) {
        const t2 = i / layer.count
        const l = lb + Math.sin(t2 * Math.PI * 13 + i * 0.09) * lv
        const [r, g, b] = hsl(hue, s, Math.max(0, Math.min(100, l)))
        arr[i*3]=r; arr[i*3+1]=g; arr[i*3+2]=b
      }
      layer.colorAttr.needsUpdate = true
    })
  }

  _drawGhost(text) {
    const c = this._ghostCanvas
    const ctx = c.getContext('2d')
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(210,210,210,1)'

    const upper = text.toUpperCase()
    const maxW  = 460

    // Try large size first, shrink if too wide
    let fontSize = 150
    ctx.font = `bold ${fontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    while (ctx.measureText(upper).width > maxW && fontSize > 40) {
      fontSize -= 8
      ctx.font = `bold ${fontSize}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    }

    // Word-wrap into lines
    const wordList = upper.split(' ')
    const lines = []
    let cur = ''
    for (const w of wordList) {
      const test = cur ? cur + ' ' + w : w
      if (ctx.measureText(test).width > maxW && cur) {
        lines.push(cur); cur = w
      } else { cur = test }
    }
    if (cur) lines.push(cur)

    const lineH = fontSize * 1.1
    const totalH = lines.length * lineH
    const startY = (512 - totalH) / 2 + fontSize * 0.85

    lines.forEach((line, i) => {
      ctx.fillText(line, 256, startY + i * lineH)
    })

    this._ghostTex.needsUpdate = true
  }

  _autoColorFromAudio(audio) {
    if (!this._colorTimer) this._colorTimer = 0
    this._colorTimer += 0.016
    if (this._colorTimer < 0.4) return // update every ~400ms
    this._colorTimer = 0

    const bass = audio.bass ?? 0
    const treble = audio.treble ?? 0
    const overall = audio.overall ?? 0
    if (overall < 0.015) return

    // Bass-heavy = warm (red/orange), treble-heavy = cool (cyan/blue)
    const bassRatio = bass / (bass + treble + 0.001)
    const mainHue = 10 + (1 - bassRatio) * 220  // 10 (red) → 230 (blue)
    const sat = 60 + overall * 35
    const accentHue = (mainHue + 150) % 360

    const [ar, ag, ab] = hsl(accentHue, sat, 62)
    this.accentRGB = [Math.round(ar*255), Math.round(ag*255), Math.round(ab*255)]

    const palette = [
      {hue:accentHue, sat:sat*0.9, lb:48, lv:12},
      {hue:mainHue,   sat:sat*0.7, lb:18, lv:10},
    ]
    this._layers.forEach((layer, li) => {
      const {hue, sat:s, lb, lv} = palette[li]
      const arr = layer.colorAttr.array
      for (let i = 0; i < layer.count; i++) {
        const t = i / layer.count
        const l = lb + Math.sin(t * Math.PI * 13 + i * 0.09) * lv
        const [r, g, b] = hsl(hue, s, Math.max(0, Math.min(100, l)))
        arr[i*3]=r; arr[i*3+1]=g; arr[i*3+2]=b
      }
      layer.colorAttr.needsUpdate = true
    })
  }

  _updateColors(){
    const {valence,energy,acousticness}=this.features
    const mainHue=valence<0.5?240-(valence/0.5)*60:180-((valence-0.5)/0.5)*155
    const sat=55+energy*40
    const accentHue=(mainHue+150+acousticness*30)%360

    // Accent color for overlay (convert hsl to 0-255)
    const [ar,ag,ab]=hsl(accentHue,sat,60)
    this.accentRGB=[Math.round(ar*255),Math.round(ag*255),Math.round(ab*255)]

    const palette=[
      {hue:accentHue, sat:sat*0.9, lb:45, lv:12},
      {hue:mainHue,   sat:sat*0.7, lb:18, lv:10},
    ]
    this._layers.forEach((layer,li)=>{
      const {hue,sat:s,lb,lv}=palette[li]
      const arr=layer.colorAttr.array
      for(let i=0;i<layer.count;i++){
        const t=i/layer.count
        const l=lb+Math.sin(t*Math.PI*13+i*0.09)*lv
        const [r,g,b]=hsl(hue,s,Math.max(0,Math.min(100,l)))
        arr[i*3]=r;arr[i*3+1]=g;arr[i*3+2]=b
      }
      layer.colorAttr.needsUpdate=true
    })
  }

  update(audio,delta){
    this.time+=delta
    const lerp=(a,b,t)=>a+(b-a)*t
    const s=this.audioState
    s.kick   =lerp(s.kick,   audio.kick   ??audio.bass,   0.4)
    s.melody =lerp(s.melody, audio.melody ??audio.mid,    0.25)
    s.texture=lerp(s.texture,audio.texture??audio.treble, 0.28)
    s.pad    =lerp(s.pad,    audio.pad    ??audio.overall,0.2)
    s.overall=lerp(s.overall,audio.overall,               0.2)
    s.bass   =lerp(s.bass,   audio.bass,                  0.35)
    s.mid    =lerp(s.mid,    audio.mid,                   0.25)
    s.beat   =lerp(s.beat,   audio.beat?1:0,              audio.beat?0.8:0.12)

    // Particle uniforms
    this._layers.forEach(({cfg,uniforms})=>{
      uniforms.uTime.value      =this.time
      uniforms.uBeat.value      =s.beat
      uniforms.uOverall.value   =s.overall
      uniforms.uInstrument.value=s[cfg.instrument]??s.overall
      uniforms.uSpread.value    =this._mood.spread
      uniforms.uSpeed.value     =this._mood.speed
      // noiseScale: figure layers stay tight, glow layers breathe freely
      uniforms.uNoiseScale.value=cfg.noiseScale??0.35
    })

    // Glitch uniforms — energy drives intensity
    const gu=this._glitchUniforms
    gu.uTime.value   =this.time
    gu.uBass.value   =s.bass
    gu.uBeat.value   =s.beat
    gu.uOverall.value=s.overall
    gu.uMid.value    =s.mid
    gu.uEnergy.value =this.features.energy

    // Rotations
    const [rings,atmo]=this._layers.map(l=>l.points)
    const tempo=this.features.tempo/120
    const sp = 0.5 + this._mood.speed * 1.0
    rings.rotation.y+=(0.001 +s.texture*0.003)*tempo*sp
    rings.rotation.z+=0.0005*sp
    atmo.rotation.y +=0.0005*sp
    atmo.rotation.x -=0.0002*sp

    this.camera.position.x=Math.sin(this.time*0.07)*0.5
    this.camera.position.y=Math.cos(this.time*0.045)*0.3
    this.camera.lookAt(0,0,0)

    // Ghost text animation
    if (this.lyricsMode) {
      const age = this.time - this._lyricEntryTime
      // Entrance: scale 0.88 → 1.0 over 0.4s, then settle + beat pulse
      const entryScale = age < 0.4 ? 0.88 + (age / 0.4) * 0.12 : 1.0
      const beatScale  = 1.0 + s.beat * 0.04
      this._ghostMesh.scale.setScalar(entryScale * beatScale)
      // Opacity: fade in over 0.25s, pulse with beat
      const entryAlpha = Math.min(1, age / 0.25)
      this._ghostMesh.material.opacity = entryAlpha * (0.5 + s.beat * 0.2)
      // Slight vertical drift with audio
      this._ghostMesh.position.y = Math.sin(this.time * 0.6) * 0.15 * s.overall
    } else {
      this._ghostMesh.scale.setScalar(1.0)
      this._ghostMesh.position.y = 0
      this._ghostMesh.material.opacity = Math.max(0, 0.07 - s.overall * 0.12)
    }

    // Mood transition tick
    if (this._moodTarget) this._tickMood(delta)
    else if (!this._spotifyFeatures) this._autoColorFromAudio(audio)

    // Pose morph animation
    if (this._morphStart !== undefined) {
      const elapsed = this.time - this._morphStart
      let morphVal
      if (elapsed < this._morphDuration) {
        const t = elapsed / this._morphDuration
        morphVal = t * t * (3 - 2 * t)  // smoothstep ease
      } else if (elapsed < this._morphDuration + this._morphHold) {
        morphVal = 1.0
      } else {
        const t = (elapsed - this._morphDuration - this._morphHold) / this._morphDuration
        morphVal = Math.max(0, 1.0 - t * t * (3 - 2 * t))
        if (morphVal <= 0) this._morphStart = undefined
      }
      this._layers.forEach(({uniforms}) => { uniforms.uMorph.value = morphVal ?? 0 })
    }

    // 1. Render particles → render target
    this.renderer.setRenderTarget(this._rt)
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.clear(true, true, true)
    this.renderer.render(this.scene, this.camera)

    // 2. Glitch post-process → screen
    this.renderer.setRenderTarget(null)
    this.renderer.clear(true, true, true)
    this.renderer.render(this._glitchScene, this._glitchCam)
  }

  _onResize(){
    this.camera.aspect=window.innerWidth/window.innerHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(window.innerWidth,window.innerHeight)
    this._rt.setSize(window.innerWidth,window.innerHeight)
  }

  destroy(){
    window.removeEventListener('resize',this._onResize)
    this._rt.dispose()
    this.renderer.dispose()
  }
}
