// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createPointLayer } from './pointLayer'
import { DISPLACE_FROM_ZOOM } from '../map/displace'
import { DELAY_COLOR_RULES } from './delayColor'
import { vehicleTooltip } from './vehicleTooltip'
import { createDelayRangeFilter } from '../filters/delayRangeFilter'
import { PUNCTUAL_TO_SMALL_MIN } from '../filters/delayBrackets'

// No `labels: true` override (factory default is already false) — bus
// nameplates stay off by default, unlike trains. Line number/direction/
// delay show on hover instead (vehicleTooltip), not baked into the icon.
// The delay filter starts pre-applied to "≥ 5 min" — with hundreds of
// buses on screen, punctual/early ones aren't the interesting case on
// first load.
export const busLayer = createPointLayer(
  'bus_vehicle',
  'Buses',
  {},
  DELAY_COLOR_RULES,
  true,
  vehicleTooltip,
  [createDelayRangeFilter({ id: 'delay', label: 'Delay', initialLo: PUNCTUAL_TO_SMALL_MIN })],
  DISPLACE_FROM_ZOOM,
)
