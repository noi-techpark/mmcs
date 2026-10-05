// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createPointLayer } from './pointLayer'
import { hslToHex } from '../map/colorGradient'
import { PALETTE_SATURATION, PALETTE_LIGHTNESS, STATUS_COLORS } from '../map/colors'
import type { ColorRule } from './types'

// European Air Quality Index (EAQI) for NO₂, hourly. The feed publishes only
// the band name; the concentration bands below are the EEA's standard
// thresholds for hourly NO₂ in µg/m³ (ODH's datatype carries no numbers).
export interface AirQualityBand {
  key: string
  label: string
  /** Concentration range for this band, µg/m³ — shown in the sidebar. */
  range: string
  /** Hue on the shared color wheel, green (good) to red (extremely poor). */
  hue: number
}

// Six stops from green to red. The hues are spaced evenly along the wheel
// from the status green (137) to the status red (0), so neighbouring bands
// stay distinguishable.
export const AIR_QUALITY_BANDS: AirQualityBand[] = [
  { key: 'good', label: 'Good', range: '0–40 µg/m³', hue: 137 },
  { key: 'fair', label: 'Fair', range: '40–90 µg/m³', hue: 107 },
  { key: 'moderate', label: 'Moderate', range: '90–120 µg/m³', hue: 75 },
  { key: 'poor', label: 'Poor', range: '120–230 µg/m³', hue: 45 },
  { key: 'very poor', label: 'Very poor', range: '230–340 µg/m³', hue: 22 },
  { key: 'extremely poor', label: 'Extremely poor', range: 'above 340 µg/m³', hue: 0 },
]

const wheel = (h: number) => hslToHex(h, PALETTE_SATURATION, PALETTE_LIGHTNESS)

const AIR_QUALITY_COLOR_RULES: ColorRule[] = [
  ...AIR_QUALITY_BANDS.map((b, i) => ({
    key: b.key,
    color: wheel(b.hue),
    score: i * 20,
    test: (p: { data: Record<string, unknown> }) => p.data.rating === b.key,
  })),
  { key: 'unknown', color: STATUS_COLORS.unknown, score: 0, test: () => true },
]

// Own file so its bands and defaults can be tuned independently of the other
// layers — see layers/definitions.ts for how these get registered.
export const airQualityLayer = createPointLayer('air_quality', 'Air quality (NO₂)', {}, AIR_QUALITY_COLOR_RULES, false)
