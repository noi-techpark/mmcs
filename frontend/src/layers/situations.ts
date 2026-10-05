// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createPointLayer } from './pointLayer'
import { DISPLACE_FROM_ZOOM } from '../map/displace'

// SIRI-SX service alerts/disruptions — placed at the first affected stop
// the backend could resolve to a NeTEx Quay coordinate (see
// backend/internal/feeds/siri/sx.go); situations with no resolvable stop
// never reach the frontend at all.
export const situationsLayer = createPointLayer('bus_alert', 'Service Alerts', {}, undefined, true, undefined, [], DISPLACE_FROM_ZOOM)
