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

const TRAFFIC_SPEED_COLOR_RULES: ColorRule[] = [
  { key: 'very-slow', color: wheel(STATUS_HUES.critical), score: 100, test: (p) => p.data.speedBand === 'very-slow' },
  { key: 'slow', color: wheel(HUE_ORANGE), score: 60, test: (p) => p.data.speedBand === 'slow' },
  { key: 'moderate', color: wheel(HUE_YELLOW), score: 30, test: (p) => p.data.speedBand === 'moderate' },
  { key: 'free-flow', color: wheel(STATUS_HUES.ok), score: 0, test: (p) => p.data.speedBand === 'free-flow' },
  { key: 'unknown', color: STATUS_COLORS.unknown, score: 0, test: () => true },
]

// Own file so its defaults/coloring can be tuned independently of the other
// layers — see layers/definitions.ts for how these get registered.
export const trafficLayer = createPointLayer('traffic_station', 'Traffic (A22)', {}, TRAFFIC_SPEED_COLOR_RULES, true, undefined, [], 0)
