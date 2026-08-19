import { createPointLayer } from './pointLayer'
import { STATUS_COLOR_RULES } from '../map/colors'

// Own file so its defaults can be tuned independently of the other
// layers — see layers/definitions.ts for how these get registered.
// Off by default: with 795 stations it's the densest layer by far and
// tends to dominate the map on first load.
export const eChargingLayer = createPointLayer('e_charging', 'E-Charging', {}, STATUS_COLOR_RULES, false)
