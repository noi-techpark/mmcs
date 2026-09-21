// Shared delay-bracket thresholds and coloring: anything that visualizes or
// filters vehicle delay (the bus/train icon gradient in ../layers/delayColor.ts,
// and the bus delay-range filter in delayRangeFilter.tsx) must agree on
// what counts as "small" vs "high" delay, and on the exact color at every
// point in between, or the map colors and the filter slider would
// disagree about the same numbers.
import { twoBreakpointHueGradient, hslToHex, type GradientColor } from '../map/colorGradient'
import { STATUS_HUES, PALETTE_SATURATION, PALETTE_LIGHTNESS } from '../map/colors'

/** Minutes. Below this (and >= 0) is "punctual". */
export const PUNCTUAL_TO_SMALL_MIN = 5
/** Minutes. At/above this is "high" delay. */
export const SMALL_TO_HIGH_MIN = 15

const ANTICIPATION_HUE = 200 // sky blue — not part of the shared ok/warning/critical wheel

const wheel = (h: number) => hslToHex(h, PALETTE_SATURATION, PALETTE_LIGHTNESS)

// Flat representative colors — used for bracket labels/legends and as the
// single anticipation color (early delay isn't itself graded). The
// continuous 0–15 min gradient below is the actual per-value color used by
// both the map icons and the filter slider.
export const DELAY_BRACKET_COLORS = {
  anticipation: wheel(ANTICIPATION_HUE),
  punctual: wheel(STATUS_HUES.ok),
  small: wheel(STATUS_HUES.warning),
  high: wheel(STATUS_HUES.critical),
}

const MID1_PCT = (PUNCTUAL_TO_SMALL_MIN / SMALL_TO_HIGH_MIN) * 100

const delayHue = twoBreakpointHueGradient(
  STATUS_HUES.ok,
  STATUS_HUES.warning,
  STATUS_HUES.critical,
  MID1_PCT,
  100,
  PALETTE_SATURATION,
  PALETTE_LIGHTNESS,
)

// The green→yellow segment (0–5 min) is eased so it reads as solidly green
// for most of that range, only picking up a yellow tint as it nears the
// 5-minute boundary — a raw linear ramp there read as tinted-yellow well
// before an actual 5-minute delay.
const GREEN_ZONE_EASE = 3

function biasedPct(minutesClamped: number): number {
  const rawPct = (minutesClamped / SMALL_TO_HIGH_MIN) * 100
  if (rawPct <= MID1_PCT) {
    const t = rawPct / MID1_PCT
    return t ** GREEN_ZONE_EASE * MID1_PCT
  }
  return rawPct
}

const ANTICIPATION_COLOR: GradientColor = { color: DELAY_BRACKET_COLORS.anticipation, opacity: 0.5, score: 0 }

/**
 * The single source of truth for "what color is a delay of N minutes" —
 * flat anticipation color below 0, eased green→yellow 0–5, yellow→red
 * 5–15, flat red at/above 15. Both layers/delayColor.ts (map icons) and
 * delayRangeFilter.tsx (slider gradient) call this directly so they can
 * never drift apart.
 */
export function delayGradientColor(minutes: number): GradientColor {
  if (minutes < 0) return ANTICIPATION_COLOR
  return delayHue(biasedPct(Math.min(SMALL_TO_HIGH_MIN, minutes)))
}
