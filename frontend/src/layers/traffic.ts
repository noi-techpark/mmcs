import { createPointLayer } from './pointLayer'
import { STATUS_COLOR_RULES } from '../map/colors'

// Color comes straight from the backend's Status field (green/yellow/red —
// see backend/internal/feeds/odh/traffic.go trafficStatus). A22 is closed
// data, so the backend deliberately sends nothing beyond that derived
// status — no tooltip here, since there are no numbers behind it to show.

// Own file so its defaults can be tuned independently of the other
// layers — see layers/definitions.ts for how these get registered.
export const trafficLayer = createPointLayer('traffic_station', 'Traffic (A22)', {}, STATUS_COLOR_RULES, true)
