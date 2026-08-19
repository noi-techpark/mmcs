// Small color-math helpers for building ColorRules: hex mixing (bucketed
// gradients, e.g. occupancy-percent coloring — see layers/parking.ts) and
// HSL-based hue derivation (a shared-S/L "color wheel" palette — see
// layers/trains.ts).
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHex([r, g, b]: number[]): string {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}

export function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a)
  const cb = hexToRgb(b)
  return rgbToHex(ca.map((v, i) => v + (cb[i] - v) * t))
}

/**
 * Standard HSL→hex conversion (h in degrees, s/l as 0–1 fractions). Lets a
 * layer derive a set of hues that share one saturation/lightness — the
 * "color wheel" technique for making distinct hues read as one family —
 * instead of picking arbitrary hex values per tier.
 */
export function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const hp = ((h % 360) + 360) % 360 / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const m = l - c / 2
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] :
    hp < 2 ? [x, c, 0] :
    hp < 3 ? [0, c, x] :
    hp < 4 ? [0, x, c] :
    hp < 5 ? [x, 0, c] :
    [c, 0, x]
  return rgbToHex([(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255])
}

/**
 * Two-segment gradient over a percent value: a→b over [0, mid1], b→c over
 * [mid1, mid2], solid c from mid2 up (and clamped below 0/above 100).
 *
 * Mixes in RGB space, which cuts straight across hue space between two
 * saturated colors — a green→orange mix dips through a desaturated,
 * muddy brown in the middle instead of passing through yellow. Prefer
 * twoBreakpointHueGradient (below) for status-style green→yellow→red
 * ramps; this one is for mixing towards/from a genuinely neutral color
 * (e.g. gray) where there's no hue path to follow.
 */
export function twoBreakpointGradient(a: string, b: string, c: string, mid1: number, mid2: number) {
  return (pct: number): string => {
    const clamped = Math.min(100, Math.max(0, pct))
    if (clamped <= mid1) return mixHex(a, b, clamped / mid1)
    if (clamped < mid2) return mixHex(b, c, (clamped - mid1) / (mid2 - mid1))
    return c
  }
}

function mixHue(a: number, b: number, t: number): number {
  const diff = (((b - a + 540) % 360) + 360) % 360 - 180
  return (a + diff * t + 360) % 360
}

/**
 * Same two-segment shape as twoBreakpointGradient, but interpolates hue
 * (shortest path around the wheel) at constant saturation/lightness
 * instead of mixing RGB channels — stays vivid the whole way through
 * instead of dipping through a muddy midpoint. Takes hues in degrees for
 * the three stops, sharing one s/l (see PALETTE_SATURATION/LIGHTNESS).
 */
export function twoBreakpointHueGradient(hueA: number, hueB: number, hueC: number, mid1: number, mid2: number, s: number, l: number) {
  return (pct: number): string => {
    const clamped = Math.min(100, Math.max(0, pct))
    const hue =
      clamped <= mid1 ? mixHue(hueA, hueB, clamped / mid1) :
      clamped < mid2 ? mixHue(hueB, hueC, (clamped - mid1) / (mid2 - mid1)) :
      hueC
    return hslToHex(hue, s, l)
  }
}
