// posterGenerator.js — Lyric Data Map v6 (All Data, Layered)
//
// ┌─────────────────────────────────────────────────────────────┐
// │  THE UNIT : 14×14px 정사각형 타일                            │
// │  THE LAW  : 6개의 독립 데이터 레이어가 하나의 타일에 겹침    │
// │                                                             │
// │  L1 타일 HUE     ← lyric.hue + key/mode + pitch(segment)   │
// │  L2 타일 DENSITY ← lyric.energy + keyword count            │
// │  L3 2ND COLOR    ← lyric.speed                             │
// │  L4 타일 SIZE    ← segment.loudness_max                    │
// │  L5 잉크 OPACITY ← features.valence                        │
// │  L6 패턴 ORDER   ← features.danceability                   │
// │  GRAIN           ← features.acousticness                   │
// └─────────────────────────────────────────────────────────────┘

const BG = '#f3f0e8'
const KEY_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

function ir({r,g,b})    { return `rgb(${r},${g},${b})` }
function ira({r,g,b},a) { return `rgba(${r},${g},${b},${Math.max(0,Math.min(1,a))})` }
function lerp(a,b,t)    { return a+(b-a)*t }
function clamp(v,lo,hi) { return Math.max(lo,Math.min(hi,v)) }
function lerpHue(h0,h1,t) {
  let d=h1-h0; if(d>180)d-=360; if(d<-180)d+=360
  return ((h0+d*t)+360)%360
}

// Deterministic reproducible hash → 0–1
function hash01(col,row,seed=0) {
  let h=Math.imul(col,2654435761)^Math.imul(row,40503)^Math.imul(seed,1234567)
  h=(h^(h>>>16))>>>0; h=Math.imul(h,0x85ebca6b)>>>0
  h=(h^(h>>>13))>>>0; h=Math.imul(h,0xc2b2ae35)>>>0
  return ((h^(h>>>16))>>>0)/0xFFFFFFFF
}

// ── Album art extraction ──────────────────────────────────────────────────────

async function extractAlbumPalette(url,count=5) {
  return new Promise(resolve=>{
    const img=new Image(); img.crossOrigin='anonymous'
    img.onload=()=>{
      try{
        const SZ=64,c=document.createElement('canvas')
        c.width=SZ;c.height=SZ
        const cx=c.getContext('2d');cx.drawImage(img,0,0,SZ,SZ)
        const px=cx.getImageData(0,0,SZ,SZ).data
        const buckets={}
        for(let i=0;i<px.length;i+=4){
          const r=px[i],g=px[i+1],b=px[i+2]
          const max=Math.max(r,g,b)/255,min=Math.min(r,g,b)/255,d=max-min
          const l=(max+min)/2,s=d<0.001?0:l<0.5?d/(max+min):d/(2-max-min)
          let key
          if(s<0.15){key=l<0.28?'__dark':'__gray'}
          else{
            const rm=r/255,gm=g/255,bm=b/255;let h
            if(max===rm)h=((gm-bm)/d)%6
            else if(max===gm)h=(bm-rm)/d+2
            else h=(rm-gm)/d+4
            key=String(Math.round((h*60+360)%360/30)*30%360)
          }
          if(!buckets[key])buckets[key]={sumR:0,sumG:0,sumB:0,n:0}
          buckets[key].sumR+=r;buckets[key].sumG+=g;buckets[key].sumB+=b;buckets[key].n++
        }
        const palette=Object.entries(buckets)
          .sort((a,b)=>b[1].n-a[1].n).slice(0,count+2)
          .map(([,{sumR,sumG,sumB,n}])=>boostForPrint(Math.round(sumR/n),Math.round(sumG/n),Math.round(sumB/n)))
          .filter(Boolean).slice(0,count)
        resolve(palette.length>=3?palette:null)
      }catch{resolve(null)}
    }
    img.onerror=()=>resolve(null);img.src=url
  })
}

function boostForPrint(r,g,b){
  const rm=r/255,gm=g/255,bm=b/255
  const max=Math.max(rm,gm,bm),min=Math.min(rm,gm,bm),d=max-min
  let h=0,s=0,l=(max+min)/2
  if(d>0.001){
    s=l<0.5?d/(max+min):d/(2-max-min)
    if(max===rm)h=((gm-bm)/d)%6
    else if(max===gm)h=(bm-rm)/d+2
    else h=(rm-gm)/d+4
    h=(h*60+360)%360
  }
  s=clamp(s*1.3+0.15,0.58,0.92)
  l=clamp(l*0.55+0.04,0.18,0.50)
  return hslToRgb(h,s,l)
}

function hslToRgb(h,s,l){
  const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l)
  const f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)))
  return {r:Math.round(f(0)*255),g:Math.round(f(8)*255),b:Math.round(f(4)*255)}
}

const FALLBACK=[
  {r:22,g:30,b:62},{r:32,g:108,b:188},{r:215,g:60,b:35},
  {r:153,g:120,b:68},{r:140,g:142,b:145},
]

function moodToInks(hue,energy,palette){
  const h=((hue%360)+360)%360,n=palette.length
  const idx=Math.floor((h/360)*n)%n
  return {a:palette[idx],b:palette[(idx+1+Math.round(energy*(n-2)))%n]}
}

// ── Segment lookup (binary search) ───────────────────────────────────────────

function getSegmentAt(segments, posMs) {
  if(!segments?.length) return null
  const posS=posMs/1000
  let lo=0,hi=segments.length-1
  while(lo<hi){
    const mid=(lo+hi+1)>>1
    if(segments[mid].start<=posS)lo=mid; else hi=mid-1
  }
  return segments[lo]
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generatePoster({track,features,moodMap,lyrics,analysis}){
  const albumUrl=track?.album?.images?.[0]?.url??null
  const palette=(albumUrl?await extractAlbumPalette(albumUrl,5):null)??FALLBACK

  const W=1200,H=1600
  const canvas=document.createElement('canvas')
  canvas.width=W;canvas.height=H
  const ctx=canvas.getContext('2d')

  const HEADER=68,FOOTER=46
  ctx.fillStyle=BG;ctx.fillRect(0,0,W,H)

  const hasLyrics=!!(lyrics?.length&&moodMap&&Object.keys(moodMap).length)
  const nLyrics=hasLyrics?lyrics.length:24
  const duration=track?.duration_ms??200000

  // ── Track-level constants (전체 포스터에 영향) ──────────────────────────────
  const valence    = features?.valence      ?? 0.5   // L5: 잉크 선명도
  const danceabil  = features?.danceability ?? 0.5   // L6: 패턴 규칙성
  const acoustic   = features?.acousticness ?? 0.3   // grain 강도
  const key        = features?.key          ?? 0
  const mode       = features?.mode         ?? 1     // 1=major, 0=minor

  // L5: valence → 전체 잉크 선명도 (긍정곡 = 선명, 슬픈 곡 = 탁함)
  const vividness = 0.50 + valence * 0.45

  // key+mode → 전체 hue에 미세 보정 (+/-15°)
  // major: 따뜻한 쪽, minor: 차가운 쪽
  const modeBias  = mode===1 ? 12 : -12
  // key → 12음계 각각 30° 간격 → 미세 보정 (±5°)
  const keyBias   = ((key*30)%360-180)*0.05

  let baseHue=200
  if(moodMap){
    const hues=Object.values(moodMap).map(m=>m.hue).filter(Boolean)
    if(hues.length)baseHue=hues.reduce((a,b)=>a+b,0)/hues.length
  }
  const baseInks=moodToInks(baseHue+modeBias,valence,palette)

  const gridH=H-HEADER-FOOTER

  // ── THE UNIT ─────────────────────────────────────────────────────────────
  const UNIT=14
  const GAP =2
  const STEP=UNIT+GAP

  const COLS=Math.floor((W+GAP)/STEP)
  const ROWS=Math.floor((gridH+GAP)/STEP)
  const TOTAL=COLS*ROWS
  const offsetX=Math.round((W-(COLS*STEP-GAP))/2)

  // ── THE LAW — 6 레이어, 모든 타일에 동일 적용 ────────────────────────────
  for(let row=0;row<ROWS;row++){
    for(let col=0;col<COLS;col++){
      const i    = row*COLS+col
      const t    = i/TOTAL                        // 노래 진행도 0→1

      // ── L1 베이스: 가사 mood 보간 (Dégradé) ──────────────────────────
      const liFloat = t*(nLyrics-1)
      const li0     = Math.floor(liFloat)
      const li1     = Math.min(nLyrics-1,li0+1)
      const blend   = liFloat-li0

      const m0=(hasLyrics?moodMap[li0]:null)??{}
      const m1=(hasLyrics?moodMap[li1]:null)??{}

      const e      = lerp(m0.energy??0.5, m1.energy??0.5, blend)
      const sp     = lerp(m0.speed ??0.5, m1.speed ??0.5, blend)
      const rawHue = lerpHue(m0.hue??baseHue, m1.hue??baseHue, blend)

      // L2 keyword 수 → 밀도 보정 (감정 단어 많을수록 더 채워짐)
      const kw0=(m0.keywords?.length??0)/3
      const kw1=(m1.keywords?.length??0)/3
      const kwBoost=lerp(kw0,kw1,blend)*0.12

      // ── L1 세부: 세그먼트 dominant pitch → 미세 hue 보정 ─────────────
      let pitchBias=0, loudFill=1.0
      if(analysis?.segments){
        const posMs=t*duration
        const seg=getSegmentAt(analysis.segments,posMs)
        if(seg){
          // L1: 주음 pitch → ±15° 색상 보정
          const pitches=seg.pitches||[]
          if(pitches.length){
            const domP=pitches.indexOf(Math.max(...pitches))
            pitchBias=(domP*30-180)*0.06
          }
          // L4: loudness → 타일 크기 (큰 소리 = 꽉 찬 타일, 조용함 = 작은 타일)
          const lMax=seg.loudness_max??-30
          loudFill=clamp((lMax+40)/35,0.45,1.0)
        }
      }

      // ── L1 최종 hue 결정 ─────────────────────────────────────────────
      const finalHue=((rawHue+modeBias+keyBias+pitchBias)+360)%360
      const {a:inkA,b:inkB}=moodToInks(finalHue,e,palette)

      // ── L6 danceability → hash 규칙성 ────────────────────────────────
      // 댄서블 = 규칙적(hash noise 줄임), 비댄서블 = 혼돈(noise 늘림)
      const chaos=(hash01(col,row,99)-0.5)*(1-danceabil)*0.20

      // ── L2 + L3 최종 확률 ────────────────────────────────────────────
      const pA=clamp(e+kwBoost+chaos, 0, 1)          // P(주색) = energy + keyword
      const pB=clamp(e+sp*0.38+kwBoost+chaos, 0, 1)  // P(보조색) = + speed

      // ── L4 타일 크기 ──────────────────────────────────────────────────
      const fillSize=UNIT*clamp(0.50+loudFill*0.50, 0.50, 1.0)
      const fo=(UNIT-fillSize)/2

      // ── L5 잉크 선명도 (valence) ──────────────────────────────────────
      const r1=hash01(col,row,0)
      const r2=hash01(col,row,1)

      const tx=offsetX+col*STEP
      const ty=HEADER+GAP+row*STEP

      if(r1<pA){
        const opacity=vividness*(0.72+r2*0.28)
        ctx.fillStyle=ira(inkA,opacity)
        ctx.fillRect(tx+fo,ty+fo,fillSize,fillSize)
      } else if(r1<pB){
        const opacity=vividness*(0.58+r2*0.32)
        ctx.fillStyle=ira(inkB,opacity)
        ctx.fillRect(tx+fo,ty+fo,fillSize,fillSize)
      }
      // else: BG (paper)
    }
  }

  // ── Micro dots layer (acousticness → 유기적 점묘 텍스처) ─────────────────
  {
    const DOT=3, DSTEP=6
    const dcols=Math.floor((W+2)/DSTEP)
    const drows=Math.floor((gridH+2)/DSTEP)
    const dtotal=dcols*drows
    for(let dr=0;dr<drows;dr++){
      for(let dc=0;dc<dcols;dc++){
        const di=dr*dcols+dc
        const dt=di/dtotal
        const liF=dt*(nLyrics-1), li0=Math.floor(liF), li1=Math.min(nLyrics-1,li0+1), bl=liF-li0
        const m0=(hasLyrics?moodMap[li0]:null)??{}, m1=(hasLyrics?moodMap[li1]:null)??{}
        const e=lerp(m0.energy??0.5,m1.energy??0.5,bl)
        const rh=lerpHue(m0.hue??baseHue,m1.hue??baseHue,bl)
        const {a:dotInk}=moodToInks(((rh+modeBias)+360)%360,e,palette)
        const r1=hash01(dc,dr,77), r2=hash01(dc,dr,78)
        const threshold=acoustic*(0.12+e*0.10)
        if(r1<threshold){
          ctx.fillStyle=ira(dotInk, 0.18+r2*0.22)
          const dx=offsetX+dc*DSTEP+(hash01(dc,dr,79)-0.5)*3
          const dy=HEADER+GAP+dr*DSTEP+(hash01(dc,dr,80)-0.5)*3
          ctx.fillRect(dx,dy,DOT,DOT)
        }
      }
    }
  }

  // ── Zone marks (per lyric line → band with accent shapes) ────────────────
  {
    const bandH=gridH/nLyrics
    for(let li=0;li<nLyrics;li++){
      const m=(hasLyrics?moodMap[li]:null)??{}
      const e=m.energy??0.5, sp=m.speed??0.5, kw=(m.keywords?.length??0)
      const rawHue=m.hue??baseHue
      const {a:inkA,b:inkB}=moodToInks(((rawHue+modeBias)+360)%360,e,palette)
      const bandY=HEADER+GAP+li*bandH

      // High-energy lines → tall accent bar on left margin
      if(e>0.65){
        const barH=clamp(bandH*(e-0.5)*2.2, 6, bandH*0.9)
        const barW=clamp(3+e*5, 3, 8)
        ctx.fillStyle=ira(inkA, vividness*(0.55+e*0.35))
        ctx.fillRect(offsetX-barW-6, bandY+(bandH-barH)/2, barW, barH)
      }

      // Keyword count → small accent squares scattered in right margin
      for(let k=0;k<kw;k++){
        const rx=hash01(li,k,55), ry=hash01(li,k,56), ro=hash01(li,k,57)
        const sz=clamp(3+sp*6, 3, 9)
        const mx=offsetX+COLS*STEP+8+rx*14
        const my=bandY+ry*bandH
        ctx.fillStyle=ira(k===0?inkA:inkB, vividness*(0.4+ro*0.4))
        ctx.fillRect(mx, my, sz, sz)
      }

      // Speed → thin horizontal rule at band boundary
      if(li>0&&sp>0.62){
        ctx.strokeStyle=ira(inkA, 0.12+sp*0.15)
        ctx.lineWidth=0.5
        ctx.beginPath(); ctx.moveTo(offsetX, bandY); ctx.lineTo(offsetX+COLS*STEP-GAP, bandY); ctx.stroke()
      }
    }
  }

  // ── Energy spine — vertical accent lines at peak moments ─────────────────
  {
    const SPINE_W=1
    if(hasLyrics){
      for(let li=0;li<nLyrics;li++){
        const m=moodMap[li]??{}
        if((m.energy??0)>0.80){
          const t=li/nLyrics
          const col=Math.round(t*COLS)
          if(col>=0&&col<COLS){
            const tx=offsetX+col*STEP
            const {a:spInk}=moodToInks(((m.hue??baseHue)+modeBias+360)%360,m.energy,palette)
            ctx.fillStyle=ira(spInk, vividness*0.35)
            ctx.fillRect(tx, HEADER+GAP, SPINE_W, gridH)
          }
        }
      }
    }
  }

  // ── Grain (acousticness 기반 강도) ────────────────────────────────────────
  applyGrain(ctx,W,H, 16+acoustic*30)

  // ── Header ───────────────────────────────────────────────────────────────
  ctx.fillStyle=BG;ctx.fillRect(0,0,W,HEADER)
  ctx.fillStyle='#111';ctx.textAlign='left'
  ctx.font='700 18px "Helvetica Neue",Helvetica,Arial,sans-serif'
  ctx.fillText((track?.name??'UNKNOWN').toUpperCase(),20,28)
  ctx.font='400 11px "Helvetica Neue",sans-serif'
  ctx.fillStyle='rgba(0,0,0,0.4)'
  ctx.fillText((track?.artists?.map(a=>a.name).join(', ')?? '').toUpperCase(),20,46)
  ctx.fillStyle=ir(baseInks.a);ctx.fillRect(20,54,24,2)

  const now=new Date()
  const dateStr=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('.')
  ctx.textAlign='right';ctx.fillStyle='rgba(0,0,0,0.3)'
  ctx.font='400 10px "Helvetica Neue",sans-serif'
  ctx.fillText('NOTYET MUSIC VISUALIZER  ·  '+dateStr,W-20,28)
  const keyStr=`${KEY_NAMES[key]??'?'} ${mode===1?'MAJ':'MIN'}`
  ctx.fillText(`${Math.round(features?.tempo??120)} BPM  ·  ${keyStr}  ·  ${nLyrics} LINES`,W-20,46)

  // ── Footer ───────────────────────────────────────────────────────────────
  ctx.fillStyle=BG;ctx.fillRect(0,H-FOOTER,W,FOOTER)
  ctx.textAlign='right';ctx.fillStyle='rgba(0,0,0,0.18)'
  ctx.font='400 9px "Helvetica Neue",sans-serif'
  ctx.fillText('NOTYET',W-20,H-FOOTER+22)

  return canvas
}

// ── Grain ─────────────────────────────────────────────────────────────────────
function applyGrain(ctx,w,h,strength=24){
  const d=ctx.getImageData(0,0,w,h),px=d.data
  for(let i=0;i<px.length;i+=4){
    if(px[i]>234&&px[i+1]>230&&px[i+2]>220)continue
    const n=(Math.random()-0.5)*strength
    px[i]  =clamp(px[i]  +n,0,255)
    px[i+1]=clamp(px[i+1]+n,0,255)
    px[i+2]=clamp(px[i+2]+n,0,255)
  }
  ctx.putImageData(d,0,0)
}
