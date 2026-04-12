// ASCII character grid — SDF-based sharp silhouettes
// Each cell's character is determined by exact signed distance to shape boundary
// No scatter blur: crisp edges, depth-based character gradient

const COLS = 55
const ROWS = 130

const FIG_MIN_X = -2.1
const FIG_MAX_X =  2.1
const FIG_MIN_Y = -4.4
const FIG_MAX_Y =  4.8
const FIG_SPAN_X = FIG_MAX_X - FIG_MIN_X
const FIG_SPAN_Y = FIG_MAX_Y - FIG_MIN_Y

export const RANDOM_SHAPES = [
  'bird', 'cat', 'fish', 'rabbit', 'butterfly',
  'tree', 'flower', 'deer', 'deer_run', 'lion', 'lion_run', 'dolphin',
]

// Density threshold → ASCII character
function densityToChar(d) {
  if (d > 0.72) return '#'
  if (d > 0.48) return '+'
  if (d > 0.28) return '='
  if (d > 0.12) return '-'
  if (d > 0.03) return '·'
  return null
}

// ── SDF primitives ────────────────────────────────────────────────────────────
// All return signed distance: < 0 = inside, > 0 = outside

function sdfE(cx, cy, rx, ry, px, py) {
  const dx = (px - cx) / rx, dy = (py - cy) / ry
  return Math.sqrt(dx * dx + dy * dy) - 1.0
}

function sdfER(cx, cy, rx, ry, rot, px, py) {
  const c = Math.cos(-rot), s = Math.sin(-rot)
  const lx = (px - cx) * c - (py - cy) * s
  const ly = (px - cx) * s + (py - cy) * c
  return Math.sqrt((lx / rx) ** 2 + (ly / ry) ** 2) - 1.0
}

function sdfC(x1, y1, x2, y2, r, px, py) {
  const dx = x2 - x1, dy = y2 - y1
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy + 1e-9)))
  const ex = x1 + t * dx - px, ey = y1 + t * dy - py
  return Math.sqrt(ex * ex + ey * ey) - r
}

// ── Shape definitions (array of primitives) ───────────────────────────────────
// ['e', cx,cy,rx,ry]           ellipse
// ['r', cx,cy,rx,ry,rot]       rotated ellipse
// ['c', x1,y1,x2,y2,r]         capsule

const SHAPE_DEFS = {

  bird: [
    // Body
    ['r',  0.05,  0.28,  0.70, 0.35,  0.12],
    // Head
    ['e',  0.90,  0.72,  0.32, 0.30],
    // Beak
    ['c',  1.15,  0.72,  1.58, 0.75,  0.07],
    // Main wing (large rotated ellipse spanning back-up)
    ['r', -0.72,  0.88,  1.18, 0.36, -0.40],
    // Wing tip extension
    ['r', -1.62,  0.65,  0.50, 0.22, -0.30],
    // Underwing (lower surface fold)
    ['r', -0.68,  0.05,  0.85, 0.20, -0.25],
    // Tail upper
    ['c', -0.58,  0.30, -1.12, -0.38,  0.09],
    // Tail mid
    ['c', -0.58,  0.10, -1.12, -0.60,  0.08],
    // Tail lower
    ['c', -0.60,  0.20, -1.02, -0.14,  0.08],
    // Eye
    ['e',  0.95,  0.78,  0.07,  0.07],
  ],

  cat: [
    // Left ear outer
    ['r', -0.52,  4.18,  0.18, 0.60,  0.25],
    // Left ear inner (slightly smaller, same position)
    ['r', -0.48,  4.12,  0.11, 0.45,  0.25],
    // Right ear outer
    ['r',  0.52,  4.18,  0.18, 0.60, -0.25],
    // Right ear inner
    ['r',  0.48,  4.12,  0.11, 0.45, -0.25],
    // Head
    ['e',  0.00,  3.22,  0.72, 0.72],
    // Neck
    ['c',  0.00,  2.55,  0.00,  2.00,  0.30],
    // Body
    ['e',  0.00,  0.90,  0.98, 1.45],
    // Front left paw
    ['e', -0.52, -0.78,  0.25, 0.30],
    // Front right paw
    ['e',  0.52, -0.78,  0.25, 0.30],
    // Back left haunch
    ['r', -0.70, -0.10,  0.42, 0.55,  0.30],
    // Back right haunch
    ['r',  0.70, -0.10,  0.42, 0.55, -0.30],
    // Tail (long arc curling right)
    ['r',  1.48,  0.05,  0.22, 1.45,  0.18],
    ['r',  1.68,  1.55,  0.22, 0.55,  0.55],
    // Nose
    ['e',  0.00,  3.05,  0.10, 0.08],
  ],

  fish: [
    // Main body
    ['r',  0.10,  0.10,  1.12, 0.55,  0.05],
    // Head (rounder at front)
    ['e',  0.98,  0.10,  0.38, 0.46],
    // Tail fin top
    ['c', -0.88,  0.14, -1.72,  0.82,  0.14],
    // Tail fin bottom
    ['c', -0.88,  0.06, -1.72, -0.62,  0.14],
    // Tail fin connection
    ['c', -1.72,  0.82, -1.72, -0.62,  0.08],
    // Dorsal fin
    ['r',  0.15,  0.88,  0.45, 0.28, -0.15],
    // Anal fin
    ['r', -0.15, -0.60,  0.35, 0.18,  0.20],
    // Pectoral fin
    ['r',  0.50, -0.12,  0.35, 0.18,  0.50],
    // Eye
    ['e',  0.88,  0.22,  0.09, 0.09],
    // Mouth
    ['c',  1.28,  0.04,  1.38, -0.05,  0.05],
  ],

  rabbit: [
    // Left ear (very tall, narrow, slightly angled)
    ['r', -0.32,  4.45,  0.18, 1.08, -0.08],
    // Right ear
    ['r',  0.32,  4.45,  0.18, 1.08,  0.08],
    // Ear tips (rounded)
    ['e', -0.35,  5.50,  0.18, 0.22],
    ['e',  0.35,  5.50,  0.18, 0.22],
    // Head
    ['e',  0.00,  2.95,  0.62, 0.62],
    // Left cheek fluff
    ['e', -0.45,  2.82,  0.28, 0.22],
    // Right cheek fluff
    ['e',  0.45,  2.82,  0.28, 0.22],
    // Nose
    ['e',  0.00,  2.72,  0.10, 0.08],
    // Body
    ['e',  0.00,  1.28,  0.85, 1.32],
    // Front left paw
    ['e', -0.55,  0.05,  0.22, 0.30],
    // Front right paw
    ['e',  0.55,  0.05,  0.22, 0.30],
    // Back left foot
    ['r', -0.68, -0.98,  0.48, 0.22,  0.15],
    // Back right foot
    ['r',  0.68, -0.98,  0.48, 0.22, -0.15],
    // Fluffy tail
    ['e',  0.85,  0.95,  0.22, 0.24],
  ],

  butterfly: [
    // Body (thin)
    ['c',  0.00, -2.60,  0.00,  2.60,  0.10],
    // Head
    ['e',  0.00,  2.88,  0.20, 0.25],
    // Antennae
    ['c', -0.08,  3.05, -0.40,  3.80,  0.04],
    ['c',  0.08,  3.05,  0.40,  3.80,  0.04],
    ['e', -0.42,  3.85,  0.08, 0.08],
    ['e',  0.42,  3.85,  0.08, 0.08],
    // Upper left wing
    ['r', -1.08,  1.62,  1.00, 1.25, -0.18],
    // Upper right wing
    ['r',  1.08,  1.62,  1.00, 1.25,  0.18],
    // Upper wing leading edge accent
    ['r', -1.68,  2.05,  0.45, 0.38, -0.55],
    ['r',  1.68,  2.05,  0.45, 0.38,  0.55],
    // Lower left wing
    ['r', -0.88, -0.72,  0.78, 0.90,  0.32],
    // Lower right wing
    ['r',  0.88, -0.72,  0.78, 0.90, -0.32],
    // Lower wing tips
    ['r', -1.52, -1.55,  0.35, 0.45,  0.65],
    ['r',  1.52, -1.55,  0.35, 0.45, -0.65],
  ],

  tree: [
    // Trunk
    ['c',  0.00, -4.30,  0.00, -0.80,  0.18],
    // Root flare left
    ['r', -0.28, -3.80,  0.40, 0.18,  0.60],
    // Root flare right
    ['r',  0.28, -3.80,  0.40, 0.18, -0.60],
    // Lower branch left
    ['c',  0.00, -1.80, -1.10, -0.60,  0.12],
    // Lower branch right
    ['c',  0.00, -1.80,  1.10, -0.60,  0.12],
    // Mid branch left
    ['c',  0.00, -0.60, -0.80,  0.40,  0.11],
    // Mid branch right
    ['c',  0.00, -0.60,  0.80,  0.40,  0.11],
    // Crown base
    ['e',  0.00,  1.05,  1.62, 1.35],
    // Crown left bulge
    ['e', -0.82,  1.55,  1.05, 1.08],
    // Crown right bulge
    ['e',  0.82,  1.55,  1.05, 1.08],
    // Crown top
    ['e',  0.00,  2.85,  1.12, 1.20],
    // Crown peak
    ['e',  0.00,  4.00,  0.72, 0.88],
  ],

  flower: [
    // Stem
    ['c',  0.00, -4.30,  0.00, -1.65,  0.10],
    // Leaf left
    ['r', -0.55, -3.10,  0.55, 0.20, -0.55],
    // Leaf right
    ['r',  0.55, -2.55,  0.55, 0.20,  0.55],
    // Sepal
    ['r', -0.20, -1.72,  0.22, 0.28, -0.40],
    ['r',  0.20, -1.72,  0.22, 0.28,  0.40],
    // 6 petals
    ['r',  0.00,  1.55,  0.42, 0.75,  0.00],
    ['r',  0.65,  1.22,  0.42, 0.75,  1.05],
    ['r',  0.65, -0.28,  0.42, 0.75,  2.09],
    ['r',  0.00, -0.95,  0.42, 0.75,  3.14],
    ['r', -0.65, -0.28,  0.42, 0.75, -2.09],
    ['r', -0.65,  1.22,  0.42, 0.75, -1.05],
    // Center disc
    ['e',  0.00,  0.50,  0.48, 0.48],
    // Center detail
    ['e',  0.00,  0.50,  0.25, 0.25],
  ],

  deer: [
    // Body
    ['r',  0.00,  0.48,  1.18, 0.72,  0.05],
    // Neck
    ['r',  0.78,  1.55,  0.28, 0.72, -0.18],
    // Head
    ['e',  0.82,  2.55,  0.42, 0.38],
    // Snout
    ['r',  1.18,  2.38,  0.25, 0.18,  0.18],
    // Nostril
    ['e',  1.35,  2.30,  0.06, 0.06],
    // Eye
    ['e',  0.88,  2.68,  0.07, 0.07],
    // Ear
    ['r',  0.55,  2.92,  0.18, 0.32,  0.25],
    // Antler left trunk
    ['c',  0.65,  2.88,  0.42,  3.90,  0.08],
    // Antler left branch 1
    ['c',  0.42,  3.90,  0.10,  4.65,  0.07],
    // Antler left branch 2
    ['c',  0.42,  3.90,  0.75,  4.55,  0.07],
    // Antler right trunk
    ['c',  0.88,  2.90,  1.12,  3.80,  0.08],
    // Antler right branch 1
    ['c',  1.12,  3.80,  0.82,  4.50,  0.07],
    // Antler right branch 2
    ['c',  1.12,  3.80,  1.45,  4.45,  0.07],
    // Front leg near
    ['c',  0.50,  0.00,  0.48, -1.70,  0.14],
    ['c',  0.48, -1.70,  0.45, -3.20,  0.11],
    // Front leg far
    ['c',  0.68,  0.00,  0.70, -1.65,  0.13],
    ['c',  0.70, -1.65,  0.68, -3.10,  0.10],
    // Hind leg near
    ['c', -0.52,  0.00, -0.55, -1.70,  0.14],
    ['c', -0.55, -1.70, -0.52, -3.20,  0.11],
    // Hind leg far
    ['c', -0.75,  0.00, -0.78, -1.65,  0.13],
    ['c', -0.78, -1.65, -0.75, -3.10,  0.10],
    // Hooves
    ['r',  0.45, -3.28,  0.16, 0.10,  0.10],
    ['r', -0.52, -3.28,  0.16, 0.10,  0.10],
    // Tail
    ['r', -1.10,  0.65,  0.18, 0.28,  0.10],
  ],

  deer_run: [
    // Body (slightly compressed for speed)
    ['r',  0.00,  0.50,  1.20, 0.65,  0.08],
    // Neck forward
    ['r',  0.95,  1.62,  0.28, 0.72, -0.35],
    // Head
    ['e',  1.12,  2.55,  0.40, 0.36],
    // Snout forward
    ['r',  1.50,  2.35,  0.28, 0.18,  0.25],
    // Eye
    ['e',  1.18,  2.68,  0.07, 0.07],
    // Antler left (swept back)
    ['c',  0.80,  2.88,  0.48,  3.88,  0.07],
    ['c',  0.48,  3.88,  0.12,  4.55,  0.06],
    ['c',  0.48,  3.88,  0.80,  4.55,  0.06],
    // Antler right
    ['c',  1.05,  2.90,  1.28,  3.78,  0.07],
    ['c',  1.28,  3.78,  0.98,  4.48,  0.06],
    ['c',  1.28,  3.78,  1.58,  4.42,  0.06],
    // Front legs reaching forward
    ['c',  0.52,  0.05,  0.98, -1.40,  0.13],
    ['c',  0.98, -1.40,  1.42, -2.78,  0.11],
    ['c',  0.30,  0.05,  0.70, -1.30,  0.13],
    ['c',  0.70, -1.30,  1.08, -2.60,  0.10],
    // Hind legs pushing back
    ['c', -0.58,  0.05, -1.10, -1.30,  0.13],
    ['c', -1.10, -1.30, -1.52, -2.65,  0.11],
    ['c', -0.82,  0.05, -1.30, -1.18,  0.13],
    ['c', -1.30, -1.18, -1.68, -2.48,  0.10],
    // Tail up
    ['c', -1.10,  0.72, -1.48,  1.55,  0.10],
  ],

  lion: [
    // Body (large and muscular)
    ['e',  0.00,  0.45,  1.32, 0.82],
    // Mane (large outer ring)
    ['e',  0.98,  1.75,  0.95, 0.95],
    // Mane inner (slightly smaller, creates ring effect)
    // Head inside mane
    ['e',  0.98,  1.78,  0.48, 0.46],
    // Nose / muzzle protrusion
    ['r',  1.30,  1.58,  0.30, 0.22,  0.18],
    // Snout
    ['e',  1.52,  1.50,  0.12, 0.10],
    // Eye
    ['e',  0.88,  1.92,  0.08, 0.08],
    // Ear left
    ['r',  0.65,  2.42,  0.15, 0.28,  0.25],
    // Ear right
    ['r',  1.30,  2.38,  0.15, 0.28, -0.25],
    // Front leg near
    ['c',  0.60,  0.00,  0.62, -1.70,  0.17],
    ['c',  0.62, -1.70,  0.60, -3.15,  0.13],
    // Front leg far
    ['c',  0.85,  0.00,  0.88, -1.65,  0.16],
    ['c',  0.88, -1.65,  0.85, -3.05,  0.12],
    // Hind leg near
    ['c', -0.58,  0.00, -0.62, -1.65,  0.17],
    ['c', -0.62, -1.65, -0.58, -3.10,  0.13],
    // Hind leg far
    ['c', -0.82,  0.00, -0.88, -1.60,  0.16],
    ['c', -0.88, -1.60, -0.82, -3.00,  0.12],
    // Tail
    ['c', -1.28,  0.55, -1.72,  1.15,  0.11],
    ['c', -1.72,  1.15, -1.92,  1.90,  0.09],
    // Tail tuft
    ['e', -1.95,  2.18,  0.20, 0.25],
    // Paws
    ['r',  0.60, -3.22,  0.20, 0.12,  0.10],
    ['r', -0.58, -3.18,  0.20, 0.12,  0.10],
  ],

  lion_run: [
    // Stretched body
    ['r',  0.00,  0.42,  1.38, 0.65,  0.10],
    // Mane (moved forward)
    ['e',  1.10,  1.45,  0.88, 0.88],
    // Head
    ['e',  1.10,  1.48,  0.44, 0.42],
    // Snout forward
    ['r',  1.45,  1.28,  0.32, 0.20,  0.25],
    // Eye
    ['e',  0.98,  1.65,  0.08, 0.08],
    // Ear
    ['r',  0.80,  2.10,  0.15, 0.25,  0.20],
    // Front legs forward
    ['c',  0.65,  0.05,  1.12, -1.45,  0.15],
    ['c',  1.12, -1.45,  1.58, -2.90,  0.12],
    ['c',  0.42,  0.05,  0.85, -1.35,  0.15],
    ['c',  0.85, -1.35,  1.25, -2.72,  0.11],
    // Hind legs pushing back hard
    ['c', -0.62,  0.05, -1.18, -1.35,  0.15],
    ['c', -1.18, -1.35, -1.65, -2.78,  0.12],
    ['c', -0.88,  0.05, -1.38, -1.22,  0.15],
    ['c', -1.38, -1.22, -1.82, -2.58,  0.11],
    // Tail swept back and high
    ['c', -1.30,  0.55, -1.75,  1.38,  0.11],
    ['c', -1.75,  1.38, -1.95,  2.15,  0.09],
    ['e', -1.98,  2.42,  0.20, 0.25],
  ],

  dolphin: [
    // Main body (arched — use a large rotated ellipse)
    ['r', -0.10,  0.38,  1.78, 0.52,  0.45],
    // Body taper toward tail (extra ellipse)
    ['r', -1.08, -0.55,  0.85, 0.32,  0.38],
    // Head / melon
    ['e',  1.28,  1.35,  0.52, 0.42],
    // Rostrum (beak)
    ['c',  1.62,  1.18,  2.05,  0.90,  0.12],
    // Mouth line
    ['c',  1.68,  1.10,  2.02,  0.85,  0.05],
    // Eye
    ['e',  1.22,  1.52,  0.08, 0.08],
    // Dorsal fin
    ['c', -0.05,  0.95, -0.12,  2.15,  0.10],
    ['c', -0.12,  2.15,  0.55,  1.00,  0.08],
    // Pectoral fin
    ['r',  0.68,  0.20,  0.50, 0.22, -0.60],
    // Tail fluke top
    ['c', -1.52,  0.02, -1.95,  0.78,  0.13],
    // Tail fluke bottom
    ['c', -1.52, -0.02, -1.95, -0.72,  0.13],
    // Fluke notch
    ['c', -1.95,  0.78, -1.95, -0.72,  0.06],
    // Body highlight (subtle interior ellipse for depth)
    ['r',  0.28,  0.72,  0.85, 0.28,  0.42],
  ],

}

// ── Build density grid from SDF ───────────────────────────────────────────────

function buildShapeMask(shapeName) {
  const def = SHAPE_DEFS[shapeName] ?? SHAPE_DEFS.bird
  const grid = new Float32Array(COLS * ROWS)

  for (let row = 0; row < ROWS; row++) {
    const figY = FIG_MAX_Y - (row + 0.5) / ROWS * FIG_SPAN_Y
    for (let col = 0; col < COLS; col++) {
      const figX = FIG_MIN_X + (col + 0.5) / COLS * FIG_SPAN_X

      // Compute minimum signed distance across all primitives (union)
      let minD = Infinity
      for (const p of def) {
        let d
        if      (p[0] === 'e') d = sdfE (p[1],p[2],p[3],p[4],          figX, figY)
        else if (p[0] === 'r') d = sdfER(p[1],p[2],p[3],p[4],p[5],     figX, figY)
        else                   d = sdfC (p[1],p[2],p[3],p[4],p[5],     figX, figY)
        if (d < minD) minD = d
      }

      // Inside: map depth to density (edge=sparse char, deep=# char)
      if (minD < 0) {
        const depth = -minD
        grid[row * COLS + col] = Math.min(1.0, depth / 0.18 * 0.88 + 0.10)
      }
    }
  }
  return grid
}

// ── Beat displacement (shape-specific) ───────────────────────────────────────

function beatDisp(shapeName, figX, figY, t) {
  if (t < 0.002) return [0, 0]
  switch (shapeName) {
    case 'bird': {
      const wing = Math.max(0, Math.abs(figX) - 0.22)
      return [0, t * wing * 1.0]
    }
    case 'butterfly': {
      const wing = Math.max(0, Math.abs(figX) - 0.15) / 1.8
      return [0, t * wing * 1.2]
    }
    case 'cat': {
      if (figX > 0.6 && figY < 1.2) return [0, t * Math.max(0, figX - 0.6) * 1.4]
      return [0, 0]
    }
    case 'fish': {
      const tail = Math.max(0, -figX - 0.55)
      return [0, t * tail * 1.1]
    }
    case 'rabbit': {
      if (figY > 3.0) {
        const earH = figY - 3.0
        return [t * earH * 0.6, -t * earH * 0.5]
      }
      return [0, 0]
    }
    case 'tree': {
      const h = Math.max(0, figY + 0.5)
      return [t * h * 0.20, 0]
    }
    case 'flower': {
      const fx = figX, fy = figY - 0.5
      const dist = Math.sqrt(fx * fx + fy * fy)
      if (dist > 0.38) return [t * fx * 0.38, t * fy * 0.38]
      return [0, 0]
    }
    case 'deer': {
      if (figX > 0.4 && figY > 1.6) return [0, t * (figY - 1.6) * 0.50]
      return [0, 0]
    }
    case 'deer_run': {
      if (figX > 0.2 && figY < -0.5) return [t * Math.max(0, figX - 0.2) * 0.6, -t * 0.4]
      if (figX < -0.4 && figY < -0.5) return [t * Math.min(0, figX + 0.4) * 0.6, -t * 0.3]
      if (figY > -0.2 && figY < 1.2)  return [0, t * 0.25]
      return [0, 0]
    }
    case 'lion': {
      const mx = figX - 0.98, my = figY - 1.75
      const md = Math.sqrt(mx * mx + my * my)
      if (md > 0.35 && md < 1.1) return [t * mx * 0.30, t * my * 0.30]
      return [0, 0]
    }
    case 'lion_run': {
      if (figX > 0.3 && figY < -0.5)  return [t * 0.45, -t * 0.35]
      if (figX < -0.5 && figY < -0.5) return [-t * 0.45, -t * 0.35]
      if (figY > 0.0 && figY < 1.0)   return [0, t * 0.22]
      return [0, 0]
    }
    case 'dolphin': {
      if (figX < -1.2) return [0, t * (-figX - 1.2) * 0.9]
      return [0, t * 0.18]
    }
    default:
      return [0, 0]
  }
}

// ── FigureRenderer ────────────────────────────────────────────────────────────

export class FigureRenderer {
  constructor(container) {
    this.canvas = document.createElement('canvas')
    this.canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:3;'
    container.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')

    this.time  = 0
    this.color = [200, 230, 140]

    const initShape = RANDOM_SHAPES[Math.floor(Math.random() * RANDOM_SHAPES.length)]
    this._poseName   = initShape
    this._morphT     = 1.0
    this._morphStart = -999
    this._morphDur   = 1.6

    this._gridBase    = buildShapeMask(initShape)
    this._gridTarget  = this._gridBase
    this._densityGrid = this._gridBase

    this._cellPool  = Array.from({ length: COLS * ROWS }, () =>
      ({ density: 0, figX: 0, figY: 0 }))
    this._cellCount = 0
    this._rebuildCells()

    this._lyricChars  = []
    this._activeAlpha = 0

    this._beatTime = -999
    this._beatKick = 0

    this._resize()
    window.addEventListener('resize', () => this._resize())
  }

  _resize() {
    this.canvas.width  = window.innerWidth
    this.canvas.height = window.innerHeight
    this._scale = this.canvas.height * 0.40 / 4
    this._cx    = this.canvas.width  / 2
    this._cy    = this.canvas.height / 2
  }

  _rebuildCells() {
    let count = 0
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const d = this._densityGrid[row * COLS + col]
        if (d < 0.03) continue
        const c = this._cellPool[count++]
        c.density = d
        c.figX    = FIG_MIN_X + (col + 0.5) / COLS * FIG_SPAN_X
        c.figY    = FIG_MAX_Y - (row + 0.5) / ROWS * FIG_SPAN_Y
      }
    }
    this._cellCount = count
  }

  _interpolateGrid(t) {
    if (t >= 1.0) return this._gridTarget
    const out = new Float32Array(COLS * ROWS)
    const mt  = 1 - t
    for (let i = 0; i < out.length; i++) {
      out[i] = this._gridBase[i] * mt + this._gridTarget[i] * t
    }
    return out
  }

  setShape(poseName) {
    if (!poseName || poseName === this._poseName) return
    if (!SHAPE_DEFS[poseName]) return  // reject unknown / human shapes
    this._poseName   = poseName
    this._morphStart = this.time
    this._morphT     = 0
    this._gridBase   = this._densityGrid
    this._gridTarget = buildShapeMask(poseName)
  }

  setRandomShape() {
    const candidates = RANDOM_SHAPES.filter(s => s !== this._poseName)
    this.setShape(candidates[Math.floor(Math.random() * candidates.length)])
  }

  setColor(r, g, b) { this.color = [r, g, b] }
  setWords(_lines)   { /* no-op */ }

  setActiveLine(lineText) {
    const letters = lineText.replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
    this._lyricChars = letters.length > 0 ? letters.split('') : []
  }

  update(audio, delta) {
    this.time += delta
    const { ctx } = this
    const w = this.canvas.width, h = this.canvas.height
    const overall = audio.overall ?? 0
    const beat    = audio.beat    ?? false
    const kick    = audio.kick    ?? 0
    const [cr, cg, cb] = this.color

    ctx.clearRect(0, 0, w, h)

    // ── Morph ──
    if (this._morphStart >= 0) {
      const raw = (this.time - this._morphStart) / this._morphDur
      const t   = Math.min(1, raw)
      this._morphT = t < 0.5 ? 4*t*t*t : 1 - Math.pow(-2*t+2,3)/2
      this._densityGrid = this._interpolateGrid(this._morphT)
      this._rebuildCells()
      if (t >= 1) {
        this._morphT      = 1.0
        this._morphStart  = -999
        this._densityGrid = this._gridTarget
        this._rebuildCells()
      }
    }

    // ── Beat ──
    if (beat) { this._beatTime = this.time; this._beatKick = 0.55 + kick * 0.45 }
    const beatElapsed = Math.max(0, this.time - this._beatTime)
    const beatT = this._beatKick * Math.exp(-beatElapsed * 5.5)

    // ── Active lyric lerp ──
    const hasActive = this._lyricChars.length > 0
    this._activeAlpha += ((hasActive ? 1.0 : 0.15) - this._activeAlpha) * Math.min(1, delta * 2.5)

    const baseScale = this._scale * (1 + overall * 0.01)
    const cx = this._cx, cy = this._cy
    const cellPx   = (FIG_SPAN_X / COLS) * this._scale
    const fz       = Math.max(5, Math.min(11, cellPx * 0.82))
    const lyricLen = this._lyricChars.length
    const shape    = this._poseName
    const n        = this._cellCount
    const pool     = this._cellPool

    ctx.font         = `400 ${fz}px "SF Mono", Menlo, "Courier New", monospace`
    ctx.textAlign    = 'center'
    ctx.textBaseline = 'middle'

    // ── Pass 1: dim cells ──
    ctx.shadowBlur = 0
    for (let i = 0; i < n; i++) {
      const c = pool[i]
      const { density, figX, figY } = c
      if (this._activeAlpha > 0.5 && density > 0.38) continue

      const [dx, dy] = beatDisp(shape, figX, figY, beatT)
      const sx = cx + (figX + dx) * baseScale
      const sy = cy - (figY + dy) * baseScale
      if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue

      const alpha = Math.min(0.55, 0.06 + density * 0.17 + overall * density * 0.07
                                 + beatT * density * 0.14)
      if (alpha < 0.015) continue

      const char = densityToChar(density)
      if (!char) continue
      ctx.fillStyle = `rgba(${cr},${cg},${cb},${alpha})`
      ctx.fillText(char, sx, sy)
    }

    // ── Pass 2: bright/active cells ──
    if (this._activeAlpha > 0.05) {
      const wr = Math.round(cr + (255 - cr) * this._activeAlpha * 0.62)
      const wg = Math.round(cg + (255 - cg) * this._activeAlpha * 0.62)
      const wb = Math.round(cb + (255 - cb) * this._activeAlpha * 0.62)

      ctx.shadowColor = `rgba(${cr},${cg},${cb},0.88)`
      ctx.shadowBlur  = 4 + beatT * 9

      for (let i = 0; i < n; i++) {
        const c = pool[i]
        const { density, figX, figY } = c
        if (density <= 0.38) continue

        const [dx, dy] = beatDisp(shape, figX, figY, beatT)
        const sx = cx + (figX + dx) * baseScale
        const sy = cy - (figY + dy) * baseScale
        if (sx < -10 || sx > w + 10 || sy < -10 || sy > h + 10) continue

        const activeBoost = this._activeAlpha * (0.38 + density * 0.45)
        const alpha = Math.min(1, 0.14 + density * 0.28 + activeBoost
                                  + beatT * density * 0.20 + overall * 0.08)
        if (alpha < 0.04) continue

        const char = (lyricLen > 0 && density > 0.55)
          ? this._lyricChars[i % lyricLen]
          : densityToChar(density)
        if (!char) continue
        ctx.fillStyle = `rgba(${wr},${wg},${wb},${alpha})`
        ctx.fillText(char, sx, sy)
      }
      ctx.shadowBlur = 0
    }
  }

  destroy() { this.canvas.remove() }
}
