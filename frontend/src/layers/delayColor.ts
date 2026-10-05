// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { STATUS_COLORS } from '../map/colors'
import { SMALL_TO_HIGH_MIN, delayGradientColor } from '../filters/delayBrackets'
import type { ColorRule } from './types'

// Delay-seconds color rules for trains.ts/bus.ts icons — buckets the
// shared delayGradientColor (filters/delayBrackets.ts) into discrete steps
// since icons are pre-rendered raster images. Using the same function the
// bus delay filter's slider uses means the map's icon colors and the
// filter's gradient always agree on what a given delay means.
const RED_AT = SMALL_TO_HIGH_MIN * 60 // 15 min, in seconds
const BUCKET_STEP = 60 // 1 min

function delaySeconds(p: { data: Record<string, unknown> }): number | null {
  const s = p.data.delaySeconds
  return typeof s === 'number' ? s : null
}

export const DELAY_COLOR_RULES: ColorRule[] = [
  {
    key: 'anticipation',
    ...delayGradientColor(-1),
    test: (p: { data: Record<string, unknown> }) => {
      const s = delaySeconds(p)
      return s != null && s < 0
    },
  },
  ...Array.from({ length: RED_AT / BUCKET_STEP + 1 }, (_, i) => i * BUCKET_STEP).map((bucket) => ({
    key: `delay-${bucket}`,
    ...delayGradientColor(bucket / 60),
    test: (p: { data: Record<string, unknown> }) => {
      const s = delaySeconds(p)
      if (s == null || s < 0) return false
      const clamped = Math.min(RED_AT, s)
      return Math.round(clamped / BUCKET_STEP) * BUCKET_STEP === bucket
    },
  })),
  // No delay data — can't classify.
  { key: 'unknown', color: STATUS_COLORS.unknown, test: () => true },
]
