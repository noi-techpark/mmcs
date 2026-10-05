// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createPointLayer } from './pointLayer'
import { STATUS_COLOR_RULES } from '../map/colors'

// Bike parking boxes (BikeParking). Color comes from the backend's Status,
// which is free-space availability — red when full, orange below 20% free,
// green otherwise (see backend/internal/feeds/odh/bikeparking.go).

// Own file so its defaults can be tuned independently of the other
// layers — see layers/definitions.ts for how these get registered.
export const bikeParkingLayer = createPointLayer('bike_parking', 'Bike parking', {}, STATUS_COLOR_RULES, true)
