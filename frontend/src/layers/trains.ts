// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createPointLayer } from './pointLayer'
import { DELAY_COLOR_RULES } from './delayColor'
import { DISPLACE_FROM_ZOOM } from '../map/displace'
import { vehicleTooltip } from './vehicleTooltip'

// Own file so its defaults/coloring can be tuned independently of the
// other layers — see layers/definitions.ts for how these get registered.
export const trainsLayer = createPointLayer('train_vehicle', 'Trains', { labels: true }, DELAY_COLOR_RULES, true, vehicleTooltip, [], DISPLACE_FROM_ZOOM)
