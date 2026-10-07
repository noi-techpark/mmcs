// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createPointLayer } from './pointLayer'
import { STATUS_COLOR_RULES } from '../map/colors'

// AlpsGo carsharing stations. Green when a vehicle is available, red when
// the station is empty — the backend's Status field carries that (see
// backend/internal/feeds/odh/carsharing.go), so the default status rules
// apply as-is.

// Own file so its defaults can be tuned independently of the other
// layers — see layers/definitions.ts for how these get registered.
export const carsharingLayer = createPointLayer('carsharing_station', 'Car sharing', {}, STATUS_COLOR_RULES, false)
