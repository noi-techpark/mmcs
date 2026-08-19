import { createPointLayer } from './pointLayer'
import { twoBreakpointHueGradient } from '../map/colorGradient'
import { STATUS_COLORS, STATUS_HUES, PALETTE_SATURATION, PALETTE_LIGHTNESS } from '../map/colors'
import type { ColorRule } from './types'

// Occupancy-percent gradient (green → yellow around 70% → red at/over
// 90%) instead of the generic 3-tier status palette. Interpolates hue
// (not RGB) between the same anchors as STATUS_COLORS.ok/warning/critical
// at constant saturation/lightness — a straight RGB mix between green and
// orange cuts through a desaturated, muddy brown instead of passing
// through yellow. Icons are pre-rendered raster images, so the gradient
// is bucketed into 5%-wide steps rather than computed per exact pixel
// value; that's fine visually and keeps the icon count bounded (21
// buckets + 1 fallback).
const occupancyColor = twoBreakpointHueGradient(
  STATUS_HUES.ok,
  STATUS_HUES.warning,
  STATUS_HUES.critical,
  70,
  90,
  PALETTE_SATURATION,
  PALETTE_LIGHTNESS,
)

const BUCKET_STEP = 5

function occupancyPercent(p: { data: Record<string, unknown> }): number | null {
  const capacity = p.data.capacity as number
  const occupied = p.data.occupied as number
  if (!capacity || capacity <= 0) return null
  return Math.min(100, Math.max(0, (occupied / capacity) * 100))
}

const PARKING_OCCUPANCY_COLOR_RULES: ColorRule[] = [
  ...Array.from({ length: 100 / BUCKET_STEP + 1 }, (_, i) => i * BUCKET_STEP).map((bucket) => ({
    key: `pct-${bucket}`,
    color: occupancyColor(bucket),
    test: (p: { data: Record<string, unknown> }) => {
      const pct = occupancyPercent(p)
      return pct != null && Math.round(pct / BUCKET_STEP) * BUCKET_STEP === bucket
    },
  })),
  // Capacity missing/zero — can't compute occupancy.
  { key: 'unknown', color: STATUS_COLORS.unknown, test: () => true },
]

// Own file so its defaults/coloring can be tuned independently of the
// other layers — see layers/definitions.ts for how these get registered.
export const parkingLayer = createPointLayer('parking', 'Parking', {}, PARKING_OCCUPANCY_COLOR_RULES)
