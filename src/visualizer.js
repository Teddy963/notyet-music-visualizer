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

  uniform float uTime;
  uniform float uBeat;
  uniform float uOverall;
  uniform float uInstrument;
  uniform float uReact;
  uniform float uRotSpeed;

  varying vec3  vColor;
  varying float vAlpha;

  void main(){
    vColor = aColor;
    vec3 pos = position;

    // True 3D morphing — each axis independently displaced with uncorrelated noise
    float energy = 0.18 + uInstrument * uReact * 0.7 + uBeat * uReact * 0.2;
    vec3 nb = pos * 0.35 + vec3(uTime * 0.09);
    pos.x += snoise(nb + vec3(17.3,  0.0,  0.0)) * 0.35 * energy;
    pos.y += snoise(nb + vec3( 0.0, 31.7,  0.0)) * 0.35 * energy;
    pos.z += snoise(nb + vec3( 0.0,  0.0, 53.1)) * 0.28 * energy;

    // Second octave — finer detail
    vec3 nb2 = pos * 0.8 + vec3(uTime * 0.15 + 5.3);
    pos.x += snoise(nb2 + vec3(7.1, 0.0, 0.0)) * 0.1 * energy;
    pos.y += snoise(nb2 + vec3(0.0, 11.4, 0.0)) * 0.1 * energy;

    // Breathing
    float breathe = sin(uTime * 0.9 + aOffset * 0.5) * 0.04;
    pos *= 1.0 + breathe;

    // Drift
    float drift = uInstrument * uReact * 0.3;
    float dAngle = uTime * uRotSpeed + aOffset;
    pos.x += sin(dAngle) * drift;
    pos.y += cos(dAngle * 0.7) * drift;
    pos.z += sin(dAngle * 0.5 + 1.0) * drift * 0.4;

    vAlpha = 0.10 + uOverall * 0.65 + uBeat * uReact * 0.5;

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * (420.0 / -mvPos.z) * (1.0 + uInstrument * uReact * 1.6 + uBeat * uReact * 1.2);
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

    // ── Horizontal row displacement ──
    float rowH    = 1.0 / 100.0;
    float row     = floor(uv.y / rowH) * rowH;
    float rn      = rand(vec2(row, floor(uTime * 6.0)));
    float rowOn  = step(0.65 + (1.0 - uBass) * 0.2, rn);  // more rows on bass
    float shift  = (rn - 0.5) * (uBass * 0.14 + uBeat * 0.10) * rowOn;
    uv.x += shift;

    // ── Block corruption on beat ──
    float blockSeed = floor(uTime * 3.0);
    float blockY    = rand(vec2(blockSeed, 0.3));
    float blockH2   = 0.03 + rand(vec2(blockSeed, 0.7)) * 0.08;
    float inBlk    = step(blockY, uv.y) * step(uv.y, blockY + blockH2) * uBeat;
    float blockShift= (rand(vec2(blockSeed, 1.2)) - 0.5) * 0.12 * inBlk;
    uv.x = mix(uv.x, uv.x + blockShift, inBlk);

    // Clamp uv
    uv = clamp(uv, 0.0, 1.0);

    // ── Chromatic aberration ──
    float aber = uBeat * 0.09 + uBass * 0.03 + uEnergy * 0.012;
    float r = texture2D(uScene, uv + vec2( aber, 0.0)).r;
    float g = texture2D(uScene, uv                   ).g;
    float b = texture2D(uScene, uv - vec2( aber, 0.0)).b;
    vec3 col = vec3(r, g, b);

    // ── Scan lines ──
    float scan = sin(vUv.y * 700.0) * 0.04 * (0.3 + uOverall * 0.7);
    col -= scan;

    // ── Pixel noise grain ──
    float grain = (rand(vUv + fract(uTime)) - 0.5) * 0.07 * (0.4 + uOverall * 0.6);
    col += grain;

    // ── Vignette ──
    vec2 vig = vUv * 2.0 - 1.0;
    col *= 1.0 - dot(vig, vig) * 0.35;

    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
  }
`

// ── Layer config ─────────────────────────────────────────────────────────────
const LAYERS = [
  { name:'core',       count:600,  radiusRange:[0.0,0.45], sizeRange:[1.0,2.5], react:1.0,  rotSpeed:1.4,  ring:false, instrument:'kick'    },
  { name:'shell',      count:2800, radiusRange:[1.0,1.9],  sizeRange:[0.4,1.4], react:0.6,  rotSpeed:0.4,  ring:false, instrument:'melody'  },
  { name:'rings',      count:900,  radiusRange:[2.1,2.5],  sizeRange:[0.3,0.9], react:0.35, rotSpeed:0.12, ring:true,  instrument:'texture' },
  { name:'atmosphere', count:1800, radiusRange:[3.0,5.0],  sizeRange:[0.6,1.8], react:0.12, rotSpeed:0.05, ring:false, instrument:'pad'     },
]

function hsl(h,s,l){
  h=((h%360)+360)%360;s/=100;l/=100
  const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l)
  const f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)))
  return[f(0),f(8),f(4)]
}

function buildLayer(cfg){
  const {count,radiusRange,sizeRange,react,rotSpeed,ring}=cfg
  const pos=new Float32Array(count*3),col=new Float32Array(count*3)
  const sz=new Float32Array(count),off=new Float32Array(count),rad=new Float32Array(count)
  for(let i=0;i<count;i++){
    const theta=Math.random()*Math.PI*2
    const r=radiusRange[0]+Math.random()*(radiusRange[1]-radiusRange[0])
    let x,y,z
    if(ring){x=r*Math.cos(theta);y=(Math.random()-.5)*.2;z=r*Math.sin(theta)}
    else{const phi=Math.acos(2*Math.random()-1);x=r*Math.sin(phi)*Math.cos(theta);y=r*Math.sin(phi)*Math.sin(theta);z=r*Math.cos(phi)}
    pos[i*3]=x;pos[i*3+1]=y;pos[i*3+2]=z
    col[i*3]=1;col[i*3+1]=1;col[i*3+2]=1
    sz[i]=sizeRange[0]+Math.random()*(sizeRange[1]-sizeRange[0])
    off[i]=Math.random()*Math.PI*2;rad[i]=r
  }
  const geo=new THREE.BufferGeometry()
  geo.setAttribute('position',new THREE.BufferAttribute(pos,3))
  geo.setAttribute('aColor',  new THREE.BufferAttribute(col,3))
  geo.setAttribute('aSize',   new THREE.BufferAttribute(sz,1))
  geo.setAttribute('aOffset', new THREE.BufferAttribute(off,1))
  geo.setAttribute('aRadius', new THREE.BufferAttribute(rad,1))
  const uniforms={
    uTime:{value:0},uBeat:{value:0},uOverall:{value:0},
    uInstrument:{value:0},uReact:{value:react},uRotSpeed:{value:rotSpeed},
  }
  const mat=new THREE.ShaderMaterial({
    vertexShader:particleVert,fragmentShader:particleFrag,uniforms,
    transparent:true,depthWrite:false,blending:THREE.AdditiveBlending,
  })
  return{cfg,points:new THREE.Points(geo,mat),uniforms,colorAttr:geo.getAttribute('aColor'),count}
}

// ── Visualizer ───────────────────────────────────────────────────────────────
export class Visualizer {
  constructor(container){
    this.renderer=new THREE.WebGLRenderer({antialias:true})
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,2))
    this.renderer.setSize(window.innerWidth,window.innerHeight)
    this.renderer.setClearColor(0x000000,1)
    container.appendChild(this.renderer.domElement)

    // Main scene
    this.scene=new THREE.Scene()
    this.camera=new THREE.PerspectiveCamera(60,window.innerWidth/window.innerHeight,0.1,1000)
    this.camera.position.z=6.5

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
    this._layers[2].points.rotation.x=Math.PI*0.18
    this._layers[2].points.rotation.z=Math.PI*0.06

    // Ghost text background
    this._ghostCanvas = document.createElement('canvas')
    this._ghostCanvas.width = 512; this._ghostCanvas.height = 512
    this._ghostTex = new THREE.CanvasTexture(this._ghostCanvas)
    const ghostMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.MeshBasicMaterial({ map: this._ghostTex, transparent: true, opacity: 1, depthWrite: false })
    )
    ghostMesh.position.z = -4
    this.scene.add(ghostMesh)
    this._ghostMesh = ghostMesh
    this._ghostTrack = ''
    this._drawGhost('NOTYET')

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

  _drawGhost(text) {
    const c = this._ghostCanvas
    const ctx = c.getContext('2d')
    ctx.clearRect(0, 0, c.width, c.height)
    const words = text.toUpperCase().split(' ')
    ctx.textAlign = 'center'
    ctx.fillStyle = 'rgba(200,200,200,1)'
    if (words.length >= 2) {
      ctx.font = `bold 160px "Helvetica Neue", Helvetica, Arial, sans-serif`
      ctx.fillText(words[0], 256, 200)
      ctx.font = `bold 110px "Helvetica Neue", Helvetica, Arial, sans-serif`
      ctx.fillText(words.slice(1).join(' '), 256, 340)
    } else {
      ctx.font = `bold 170px "Helvetica Neue", Helvetica, Arial, sans-serif`
      ctx.fillText(words[0] || '', 256, 290)
    }
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
      {hue:mainHue,   sat:sat*0.3, lb:85, lv:8 },
      {hue:mainHue,   sat:sat,     lb:52, lv:15},
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
      {hue:mainHue,   sat:sat*0.3, lb:88, lv:8 },
      {hue:mainHue,   sat:sat,     lb:52, lv:15},
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
    const [core,shell,rings,atmo]=this._layers.map(l=>l.points)
    const tempo=this.features.tempo/120
    core.rotation.y +=(0.005+s.kick   *0.015)*tempo
    core.rotation.x +=(0.003+s.texture*0.010)*tempo
    shell.rotation.y+=(0.0018+s.melody*0.005)*tempo
    shell.rotation.x+=0.0009
    rings.rotation.y+=(0.001 +s.texture*0.003)*tempo
    rings.rotation.z+=0.0005
    atmo.rotation.y +=0.0005
    atmo.rotation.x -=0.0002

    this.camera.position.x=Math.sin(this.time*0.07)*0.5
    this.camera.position.y=Math.cos(this.time*0.045)*0.3
    this.camera.lookAt(0,0,0)

    // Ghost text: visible when quiet, fades with energy
    this._ghostMesh.material.opacity = Math.max(0, 0.07 - s.overall * 0.12)

    // Auto-derive color from FFT when no Spotify features
    if (!this._spotifyFeatures) this._autoColorFromAudio(audio)

    // 1. Render particles → render target
    this.renderer.setRenderTarget(this._rt)
    this.renderer.setClearColor(0x000000, 1)
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
