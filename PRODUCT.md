# Notyet Music Visualizer — Product Document

---

## 1. 제품 정의

**Notyet Music Visualizer**는 Spotify에서 재생 중인 음악을 실시간으로 시각화하는 웹 앱이다.
단순한 비주얼라이저가 아니라, 음악의 구조(비트·주파수·음색)와 가사의 감정(AI 분석)을 함께 읽어 **음악이 가진 분위기를 공간으로 번역**하는 것이 목표다.

---

## 2. 존재 이유 (Why)

기존 음악 비주얼라이저는 파형이나 스펙트럼을 기계적으로 그린다.
Notyet은 이 질문에서 출발한다:

> *"지금 이 가사가 불러일으키는 감정을, 파티클과 색과 실루엣으로 표현할 수 있을까?"*

- 가사 한 줄 한 줄이 바뀔 때마다 색, 형태, 속도, 파티클의 퍼짐이 달라진다
- AI(Claude)가 각 가사줄을 읽고 "이 줄은 파란 사슴이 달리는 느낌"처럼 시각 파라미터를 부여한다
- 음악을 "듣는" 동시에 "보는" 경험을 만든다

---

## 3. 핵심 레이어 구조

```
┌─────────────────────────────────────────────────┐
│  Layer 1 — Three.js 파티클 구름  (visualizer.js) │  가장 뒤 / 3D
│  Layer 2 — ASCII 주파수 스캐터   (figureRenderer)│  canvas, blend:screen
│  Layer 3 — AR 키워드 그래프      (overlay.js)    │  canvas
│  Layer 4 — 가사 워드 네트워크    (lyricGraph.js) │  canvas, 가장 앞
│  Layer 5 — UI (now playing / 패널)               │  HTML/CSS
└─────────────────────────────────────────────────┘
```

각 레이어는 독립적으로 렌더링되고 `audioSync`의 값을 공유해 동기화된다.

---

## 4. 작동 원리

### 4-1. Spotify 연동

1. OAuth PKCE 로그인 → `access_token` 저장
2. **Web Playback SDK** 로 브라우저 자체가 재생 디바이스가 됨
3. 트랙이 바뀔 때마다 Spotify API에서 3가지 데이터를 가져옴:
   - **Audio Features** — energy, valence, tempo, key, mode
   - **Audio Analysis** — 비트 타임스탬프, 세그먼트(pitch/timbre), 섹션
   - **가사** — Spotify 내부 lyrics endpoint (시간 동기화 포함)

### 4-2. AudioSync — 실시간 오디오 값 추출 (`audioSync.js`)

Spotify Analysis의 **세그먼트**를 프레임마다 현재 재생 위치로 조회해 7개 값을 계산한다:

| 값 | 원천 | 의미 |
|----|------|------|
| `bass / mid / treble` | pitch[0-2] / [3-7] / [8-11] | 주파수 대역 에너지 |
| `kick` | beat confidence × 감쇠 | 비트 충격 |
| `melody` | timbre[1] (brightness) | 선율성·밝기 |
| `texture` | timbre[2] (flatness) | 텍스처 복잡도 |
| `pad` | overall × (1 - timbre[3]) | 지속적 공간감 |

> Audio Analysis가 없을 경우 BPM 기반 시뮬레이션으로 fallback.

### 4-3. Claude AI 감정 분석 — 가사 mood 태깅 (`moodAnalyzer.js`)

곡이 로드되면 전체 가사를 Claude Haiku(`claude-3-5-haiku`)에 한 번 보낸다.
반환값은 가사 줄 인덱스 → 시각 파라미터 맵:

```json
{
  "i": 12,
  "hue": 220,
  "sat": 70,
  "energy": 0.8,
  "spread": 0.9,
  "speed": 0.7,
  "shape": "deer_run",
  "keywords": ["달려", "바람"]
}
```

이 분석은 **백그라운드 비동기**로 실행되고, 준비되면 즉시 시각 시스템에 반영된다.
(분석 전까지는 Audio Features의 기본값으로 동작)

### 4-4. 파티클 비주얼라이저 (`visualizer.js`)

Three.js + 커스텀 GLSL 셰이더로 구성된 **파티클 구름**.

- 현재 레이어는 `atmosphere`(1800개) + `scatter`(500개) 두 가지, 모두 **dispersed 분산 배치**로 고정
- 포즈 모핑(`standing / running / falling` 등) 코드는 존재하지만, 두 레이어 모두 `figure:false`라 현재 비활성 상태
- Claude의 `shape` 값(bird, deer 등)도 감정 레이블로 설계됐으나 렌더러와 실제 연결 없음 — **미구현 영역**
- **현재 실제로 반응하는 것**: `hue/sat` → 파티클 색상, `energy/spread/speed` → GLSL uniform으로 노이즈 강도·퍼짐·속도 제어
- 셰이더 내부에서 **Simplex noise** (3D) 로 각 파티클이 유기적으로 흔들림
- `beat` 발생 시 flash → 전체 파티클이 수축 후 팽창

### 4-5. AR 키워드 그래프 (`overlay.js`)

가사 전체를 파싱해 **단어 노드 네트워크**를 캔버스 위에 배치한다.

- 곡 시작 시 모든 단어를 투명하게 미리 배치 (위치는 단어 해시 기반으로 고정)
- 현재 가사 줄 활성화 → 해당 줄의 키워드 노드가 빛나고 엣지 연결
- beat마다 pulse 효과
- 한국어 조사(`을/를/이/가` 등)를 어미에서 제거해 어근만 추출
- stopwords / 필러(lala, tata 등) 자동 필터링

### 4-6. 가사 싱크

Spotify lyrics API는 각 줄에 `startTimeMs`를 제공한다.
1초마다 `getPlaybackState()`로 정확한 재생 위치를 갱신하고,
갱신 사이 구간은 `performance.now()` 기반으로 **위치를 선형 보간**해 드리프트 없이 줄을 전환한다.

---

## 5. 데이터 플로우

```
Spotify API
  ├─ features / analysis ──► AudioSync ──► 모든 레이어 (매 프레임)
  ├─ lyrics ───────────────► 가사 싱크 ──► subtitle / overlay / figureRenderer
  └─ playback state ───────► position 보정

Claude Haiku API (1회/곡)
  └─ mood map ─────────────► visualizer uniforms / overlay keywords / figureRenderer
```

---

## 6. 기술 스택

| 역할 | 기술 |
|------|------|
| 렌더링 (3D 파티클) | Three.js + GLSL (Simplex noise) |
| 렌더링 (2D 오버레이) | Canvas 2D API |
| Spotify 연동 | Web Playback SDK + REST API |
| AI 감정 분석 | Claude Haiku (Anthropic API, `/api/mood` 프록시) |
| 빌드 | Vite |
| 배포 | Vercel (pvos 프로젝트와 별개) |

---

## 7. 사용 흐름

1. 접속 → "Connect Spotify" 클릭 → OAuth 로그인
2. 브라우저가 Spotify 재생 디바이스로 등록됨
3. 재생 시작 → 비트·주파수 분석 즉시 시작
4. 가사 있는 곡 → AI 감정 분석 백그라운드 실행 → 준비되면 시각 업데이트
5. 가사 줄 바뀔 때마다 파티클 색·형태·속도·키워드 그래프 전환
6. `◈` 버튼으로 분석 패널(Kick/Melody/Bass/BPM/Key 등) 토글
7. `← →` 키 또는 버튼으로 트랙 이동
