import { twoBreakpointHueGradient, type GradientColor } from '../map/colorGradient'
import { STATUS_HUES, STATUS_COLORS, PALETTE_SATURATION, PALETTE_LIGHTNESS } from '../map/colors'
import type { ColorRule } from './types'

// Delay-seconds gradient (green at 0, through yellow at 5 min, to red at/
// over 15 min) shared by trains.ts and bus.ts, instead of each picking its
// own discrete tiers. Same hue-interpolation approach as parking.ts's
// occupancy gradient, so it reads as part of the same color language.
// Icons are pre-rendered raster images, so the gradient is bucketed rather
// than computed per exact value.
const RED_AT = 900 // 15 min
const YELLOW_AT = 300 // 5 min

const delayHue = twoBreakpointHueGradient(
  STATUS_HUES.ok,
  STATUS_HUES.warning,
  STATUS_HUES.critical,
  (YELLOW_AT / RED_AT) * 100,
  100,
  PALETTE_SATURATION,
  PALETTE_LIGHTNESS,
)

// Delays below zero (early) count as no delay, same as exactly on time.
function delayColor(seconds: number): GradientColor {
  return delayHue((Math.max(0, seconds) / RED_AT) * 100)
}

const BUCKET_STEP = 60 // 1 min

function delaySeconds(p: { data: Record<string, unknown> }): number | null {
  const s = p.data.delaySeconds
  return typeof s === 'number' ? s : null
}

export const DELAY_COLOR_RULES: ColorRule[] = [
  ...Array.from({ length: RED_AT / BUCKET_STEP + 1 }, (_, i) => i * BUCKET_STEP).map((bucket) => ({
    key: `delay-${bucket}`,
    ...delayColor(bucket),
    test: (p: { data: Record<string, unknown> }) => {
      const s = delaySeconds(p)
      if (s == null) return false
      const clamped = Math.min(RED_AT, Math.max(0, s))
      return Math.round(clamped / BUCKET_STEP) * BUCKET_STEP === bucket
    },
  })),
  // No delay data — can't classify.
  { key: 'unknown', color: STATUS_COLORS.unknown, test: () => true },
]
