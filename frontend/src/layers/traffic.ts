// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createPointLayer } from './pointLayer'
import { hslToHex } from '../map/colorGradient'
import { PALETTE_SATURATION, PALETTE_LIGHTNESS, STATUS_COLORS, STATUS_HUES } from '../map/colors'
import type { ColorRule } from './types'

// Color follows the average speed of light vehicles, bucketed by the
// backend into Data.speedBand (see backend/internal/feeds/odh/traffic.go
// trafficSpeedBand): red < 40 km/h, orange 40–70, yellow 70–100, green > 100.
// The raw speed stays server-side (A22 is closed data).
const wheel = (h: number) => hslToHex(h, PALETTE_SATURATION, PALETTE_LIGHTNESS)

// Orange and yellow hues match the weather layer's 5-tier scale; red and
// green reuse the shared status anchors.
const HUE_ORANGE = 30
const HUE_YELLOW = 60

export const TRAFFIC_SPEED_BAND_LABELS: Record<string, string> = {
  'very-slow': 'Under 40 km/h',
  slow: '40–70 km/h',
  moderate: '70–100 km/h',
  'free-flow': 'Over 100 km/h',
}

// Merano sensors carry a transit-count volume band instead of a speed band
// (see backend/internal/feeds/odh/traffic.go trafficVolumeBand) — no live
// measurements exist yet to calibrate these against, so treat the labels as
// provisional too.
export const TRAFFIC_VOLUME_BAND_LABELS: Record<string, string> = {
  low: 'Low volume',
  moderate: 'Moderate volume',
  high: 'High volume',
  'very-high': 'Very high volume',
}

export const TRAFFIC_SPEED_COLOR_RULES: ColorRule[] = [
  { key: 'very-slow', color: wheel(STATUS_HUES.critical), score: 100, test: (p) => p.data.speedBand === 'very-slow' },
  { key: 'slow', color: wheel(HUE_ORANGE), score: 60, test: (p) => p.data.speedBand === 'slow' },
  { key: 'moderate', color: wheel(HUE_YELLOW), score: 30, test: (p) => p.data.speedBand === 'moderate' },
  { key: 'free-flow', color: wheel(STATUS_HUES.ok), score: 0, test: (p) => p.data.speedBand === 'free-flow' },
  // Merano's volume bands reuse the same four hues so both sources read as
  // one continuum, just keyed off a different Data field.
  { key: 'volume-very-high', color: wheel(STATUS_HUES.critical), score: 90, test: (p) => p.data.volumeBand === 'very-high' },
  { key: 'volume-high', color: wheel(HUE_ORANGE), score: 55, test: (p) => p.data.volumeBand === 'high' },
  { key: 'volume-moderate', color: wheel(HUE_YELLOW), score: 25, test: (p) => p.data.volumeBand === 'moderate' },
  { key: 'volume-low', color: wheel(STATUS_HUES.ok), score: 0, test: (p) => p.data.volumeBand === 'low' },
  { key: 'unknown', color: STATUS_COLORS.unknown, score: 0, test: () => true },
]

// Own file so its defaults/coloring can be tuned independently of the other
// layers — see layers/definitions.ts for how these get registered.
export const trafficLayer = createPointLayer('traffic_station', 'Traffic', {}, TRAFFIC_SPEED_COLOR_RULES, true, undefined, [], 0)
