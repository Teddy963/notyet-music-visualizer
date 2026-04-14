# Notyet Music Visualizer — Product Document

---

## 1. 제품 정의

**Notyet Music Visualizer**는 Spotify에서 재생 중인 음악을 실시간으로 시각화하는 웹 앱이다.
단순한 비주얼라이저가 아니라, 음악의 구조(비트·주파수·음색)와 가사의 감정(AI 분석)을 함께 읽어 **음악이 가진 분위기를 공간으로 번역**하는 것이 목표다.

---

## 2. 존재 이유 (Why)

기존 음악 비주얼라이저는 파형이나 스펙트럼을 기계적으로 그린다.
Notyet은 이 질문에서 출발한다:

> *"지금 이 가사가 불러일으키는 감정을, 파티클과 색과 키워드 네트워크로 표현할 수 있을까?"*

- 가사 한 줄 한 줄이 바뀔 때마다 색, 속도, 파티클의 퍼짐이 달라진다
- AI(Claude)가 각 가사줄을 읽고 hue, saturation, energy, spread, speed 파라미터를 부여한다
- 반복되는 단어, 이어지는 단어가 캔버스 위에서 시각적 연속성을 만든다
- 음악을 "듣는" 동시에 "보는" 경험을 만든다

---

## 3. 레이어 구조

```
┌─────────────────────────────────────────────────┐
│  Layer 1 — Three.js 파티클 구름  (visualizer.js) │  가장 뒤 / 3D WebGL
│  Layer 2 — ASCII 주파수 스캐터   (figureRenderer)│  Canvas 2D, blend:screen
│  Layer 3 — AR 키워드 그래프      (overlay.js)    │  Canvas 2D, opacity:1
│  Layer 4 — UI (now playing / 버튼 / 패널)        │  HTML/CSS
└─────────────────────────────────────────────────┘
```

각 레이어는 독립적으로 렌더링되고 `audioSync`의 값을 공유해 매 프레임 동기화된다.

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
  "keywords": ["달려", "바람"]
}
```

이 분석은 **백그라운드 비동기**로 실행되고, 준비되면 즉시 시각 시스템에 반영된다.
(분석 전까지는 Audio Features의 기본값으로 동작)

### 4-4. 파티클 비주얼라이저 (`visualizer.js`)

Three.js + 커스텀 GLSL 셰이더로 구성된 **파티클 구름**.

- 레이어는 `atmosphere`(1800개), **dispersed 분산 배치**로 화면 전체에 고정 분포
- 셰이더 내부에서 **Simplex noise** (3D) 로 각 파티클이 유기적으로 흔들림
- **현재 실제로 반응하는 것**: `hue/sat` → 파티클 색상, `energy/spread/speed` → GLSL uniform으로 노이즈 강도·퍼짐·속도 제어
- `beat` 발생 시 shockwave ring + 파티클 flash
- `preserveDrawingBuffer: true` — PNG 캡처 시 WebGL 버퍼 보존

### 4-5. AR 키워드 그래프 (`overlay.js`)

가사 전체를 파싱해 **단어 노드 네트워크**를 캔버스 위에 배치한다.

- 곡 시작 시 모든 단어를 투명하게 미리 배치 (위치는 단어 해시 기반으로 화면 전체에 분산 고정)
- 현재 가사 줄 활성화 → 해당 줄의 키워드 노드가 빛나고 엣지 연결
- **Cross-line continuity rings**: 이전 가사 줄에 등장했던 단어가 현재 줄에 다시 나오면, 해당 노드에서 동심원(또는 네모) 3개를 spawn — beat 속도에 맞춰 바깥으로 확장됨 (kick이 강할수록 빠름). 감정이 따뜻하거나(warm hue) energy ≥ 0.55이면 원형, 그 외 box 형태.
- **Beat effects**:
  - A — Sonar ping: 비트마다 최대 2개 노드에서 원 펄스
  - B — Edge pulse: 엣지 위를 달리는 입자, treble-driven 속도
  - C — Lock-on bracket: core 노드에 브래킷 잠금 효과
  - D — Network cascade: kick > 0.55 시 활성 노드 주변 **1-hop** 이웃 flash (3초 쿨다운, alpha 0.38)
- MAP 버튼 hover 시 전체 노드 + 레이블 reveal
- 한국어 조사 자동 제거, stopwords / 필러(lala, tata 등) 자동 필터링
- `wordHash()` — salt mixing으로 노드가 화면 전체에 균등 분산 (좌측 쏠림 수정)

### 4-6. ASCII 레이어 (`figureRenderer.js`)

- 주파수 스펙트럼을 격자 위 문자(`. : - = + * # @`)로 시각화
- 앨범 아트를 ASCII로 변환해 배경에 저알파로 렌더링
- 격자 왜곡(grid distortion): 노이즈 기반 출렁임
- 현재 가사 줄 텍스트를 화면 상단 5% 위치에 표시

### 4-7. 가사 싱크

Spotify lyrics API는 각 줄에 `startTimeMs`를 제공한다.
1초마다 `getPlaybackState()`로 정확한 재생 위치를 갱신하고,
갱신 사이 구간은 `performance.now()` 기반으로 **위치를 선형 보간**해 드리프트 없이 줄을 전환한다.

---

## 5. UI 컨트롤

| 요소 | 위치 | 기능 |
|------|------|------|
| `← →` 버튼 / 키 | now playing 좌우 | 이전/다음 트랙 |
| `MAP` 버튼 | 우하단 | 호버 시 전체 키워드 맵 reveal |
| `⬡` 버튼 | 우하단 | 현재 화면 PNG 캡처 (canvas 레이어만, Cmd+S 단축키) |
| `◈` 버튼 | 우하단 | 분석 패널 토글 (Kick/Melody/Bass/BPM/Key 등) |

---

## 6. 데이터 플로우

```
Spotify API
  ├─ features / analysis ──► AudioSync ──► 모든 레이어 (매 프레임)
  ├─ lyrics ───────────────► 가사 싱크 ──► subtitle / overlay / figureRenderer
  └─ playback state ───────► position 보정

Claude Haiku API (1회/곡)
  └─ mood map ─────────────► visualizer uniforms / overlay keywords
```

---

## 7. 기술 스택

| 역할 | 기술 |
|------|------|
| 렌더링 (3D 파티클) | Three.js + GLSL (Simplex noise) |
| 렌더링 (2D 오버레이) | Canvas 2D API |
| Spotify 연동 | Web Playback SDK + REST API |
| AI 감정 분석 | Claude Haiku (Anthropic API, `/api/mood` 프록시) |
| 빌드 | Vite |
| 배포 | Vercel (master → 자동 배포) |

---

## 8. 사용 흐름

1. 접속 → "Connect Spotify" 클릭 → OAuth 로그인
2. 브라우저가 Spotify 재생 디바이스로 등록됨
3. 재생 시작 → 비트·주파수 분석 즉시 시작
4. 가사 있는 곡 → AI 감정 분석 백그라운드 실행 → 준비되면 시각 업데이트
5. 가사 줄 바뀔 때마다 파티클 색·속도·키워드 그래프 전환, 이어지는 단어는 동심원으로 연속성 표시
6. `◈` 버튼으로 분석 패널 토글, `MAP` 호버로 전체 키워드 맵 확인, `⬡` 또는 Cmd+S로 캡처
7. `← →` 키 또는 버튼으로 트랙 이동
