import { createPointLayer } from './pointLayer'
import { DELAY_COLOR_RULES } from './delayColor'
import { vehicleTooltip } from './vehicleTooltip'

// Own file so its defaults/coloring can be tuned independently of the
// other layers — see layers/definitions.ts for how these get registered.
export const trainsLayer = createPointLayer('train_vehicle', 'Trains', { labels: true }, DELAY_COLOR_RULES, true, vehicleTooltip)
