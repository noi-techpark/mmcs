// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createPointLayer } from './pointLayer'
import { DISPLACE_FROM_ZOOM } from '../map/displace'
import { STATUS_COLOR_RULES } from '../map/colors'

// STA's demand-responsive-transport (dial-a-ride) vehicles, via the generic
// SIRI-VM pipeline (see backend/internal/feeds/siri/poller.go PollAt) —
// distinct from the ON_DEMAND_VEHICLE taxi feed (layers/onDemand.ts).
// Colored by schedule delay like trains/buses (see
// backend/internal/feeds/siri/normalize.go Normalize), so the default
// status rules apply as-is.

// Own file so its defaults can be tuned independently of the other
// layers — see layers/definitions.ts for how these get registered.
export const onDemandVMLayer = createPointLayer(
  'on_demand_vm_vehicle',
  'On-demand shuttle',
  {},
  STATUS_COLOR_RULES,
  false,
  undefined,
  [],
  DISPLACE_FROM_ZOOM,
)
