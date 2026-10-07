// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createPointLayer } from './pointLayer'
import { STATUS_COLORS } from '../map/colors'
import type { ColorRule } from './types'

// Bicycle infrastructure: bike parking boxes (BikeParking, free-space
// availability) and cyclist counters (BikeCounter, a volume measure with
// no good/bad reading), merged into one layer — Data.kind tells them apart
// (see backend/internal/feeds/odh/bikeparking.go,bikecounter.go). Rule key
// prefix ("counter" vs "parking") also drives which icon shape is drawn
// (see map/icons.ts bicycleIcon).
const BICYCLE_COLOR_RULES: ColorRule[] = [
  { key: 'parking-critical', color: STATUS_COLORS.critical, score: 100, test: (p) => p.data.kind === 'parking' && p.status === 'critical' },
  { key: 'parking-warning', color: STATUS_COLORS.warning, score: 50, test: (p) => p.data.kind === 'parking' && p.status === 'warning' },
  { key: 'parking-ok', color: STATUS_COLORS.ok, score: 0, test: (p) => p.data.kind === 'parking' && p.status === 'ok' },
  { key: 'counter', color: STATUS_COLORS.unknown, score: 0, test: (p) => p.data.kind === 'counter' },
  { key: 'parking-unknown', color: STATUS_COLORS.unknown, score: 0, test: () => true },
]

// Own file so its defaults can be tuned independently of the other
// layers — see layers/definitions.ts for how these get registered.
export const bicycleLayer = createPointLayer('bicycle', 'Bicycle', {}, BICYCLE_COLOR_RULES, false)
