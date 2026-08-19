import { createPointLayer } from './pointLayer'
import { hslToHex } from '../map/colorGradient'
import { STATUS_COLORS, PALETTE_SATURATION, PALETTE_LIGHTNESS } from '../map/colors'
import type { ColorRule } from './types'

// Same 5 delay tiers as the trains-realtime webcomponent's _delayColor,
// re-derived on the app's shared saturation/lightness (map/colors.ts) so
// they read as part of this app's palette rather than the webcomponent's.
// "on time"/"minor delay"/"severe delay" reuse STATUS_COLORS.ok/warning/
// critical directly (same hues, so may as well be the literal same
// constant); "early"/"moderate delay" are new hues on the same wheel,
// filling the two tiers the shared 3-status palette doesn't have.
const wheel = (h: number) => hslToHex(h, PALETTE_SATURATION, PALETTE_LIGHTNESS)

const TRAIN_DELAY_COLOR_RULES: ColorRule[] = [
  { key: 'early', color: wheel(205), test: (p) => (p.data.delaySeconds as number) < 0 },
  { key: 'on-time', color: STATUS_COLORS.ok, test: (p) => (p.data.delaySeconds as number) === 0 },
  { key: 'minor-delay', color: STATUS_COLORS.warning, test: (p) => (p.data.delaySeconds as number) < 300 },
  { key: 'moderate-delay', color: wheel(22), test: (p) => (p.data.delaySeconds as number) < 1800 },
  { key: 'severe-delay', color: STATUS_COLORS.critical, test: () => true },
]

// Own file so its defaults/coloring can be tuned independently of the
// other layers — see layers/definitions.ts for how these get registered.
export const trainsLayer = createPointLayer('train_vehicle', 'Trains', { labels: true }, TRAIN_DELAY_COLOR_RULES)
