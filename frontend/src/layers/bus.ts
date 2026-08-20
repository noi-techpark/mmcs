import { createPointLayer } from './pointLayer'
import { DELAY_COLOR_RULES } from './delayColor'
import { vehicleTooltip } from './vehicleTooltip'

// No `labels: true` override (factory default is already false) — bus
// nameplates stay off by default, unlike trains. Line number/direction/
// delay show on hover instead (vehicleTooltip), not baked into the icon.
export const busLayer = createPointLayer('bus_vehicle', 'Buses', {}, DELAY_COLOR_RULES, true, vehicleTooltip)
