// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createPointLayer } from './pointLayer'
import { DISPLACE_FROM_ZOOM } from '../map/displace'
import { STATUS_COLOR_RULES } from '../map/colors'

// Taxis (ON_DEMAND_VEHICLE). Green when the vehicle is free/available, red
// when it isn't — the backend's Status field carries that (see
// backend/internal/feeds/odh/ondemand.go onDemandStatus), so the default
// status rules apply as-is.

// Own file so its defaults can be tuned independently of the other
// layers — see layers/definitions.ts for how these get registered.
export const onDemandLayer = createPointLayer('on_demand_vehicle', 'Taxis', {}, STATUS_COLOR_RULES, false, undefined, [], DISPLACE_FROM_ZOOM)
