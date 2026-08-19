import { hslToHex } from './colorGradient'
import type { ColorRule } from '../layers/types'

// Shared saturation/lightness for every hue-based color in the app — the
// "color wheel" approach: only hue varies between roles/tiers, S/L stay
// fixed so status colors, the parking occupancy gradient (which reuses
// STATUS_COLORS.ok/warning/critical as its stops), and layers with their
// own finer palettes (layers/trains.ts) all read as one family instead of
// each layer introducing its own saturation/lightness.
export const PALETTE_SATURATION = 0.67
export const PALETTE_LIGHTNESS = 0.60

const wheel = (h: number) => hslToHex(h, PALETTE_SATURATION, PALETTE_LIGHTNESS)

// The wheel positions behind STATUS_COLORS, exported so a layer building
// its own hue-interpolated gradient (e.g. parking.ts's occupancy ramp) can
// share the exact same anchors instead of re-deriving or hardcoding them.
export const STATUS_HUES = { ok: 137, warning: 42, critical: 0 }

// Reserved status palette — never reused for layer identity, which is
// carried entirely by icon shape (see icons.ts).
export const STATUS_COLORS: Record<string, string> = {
  ok: wheel(STATUS_HUES.ok),
  warning: wheel(STATUS_HUES.warning),
  critical: wheel(STATUS_HUES.critical),
  // Neutral/no-data, deliberately outside the hue wheel rather than a 4th hue.
  unknown: '#a8a6b3',
}

export const STATUS_LABELS: Record<string, string> = {
  ok: 'OK',
  warning: 'Warning',
  critical: 'Critical',
  unknown: 'Unknown',
}

// Default per-feature color rule set: classify by the backend's Status
// field. A layer can override this (see layers/trains.ts) with its own
// rules for finer-grained or entirely different coloring — see
// layers/types.ts ColorRule.
export const STATUS_COLOR_RULES: ColorRule[] = [
  { key: 'ok', color: STATUS_COLORS.ok, test: (p) => p.status === 'ok' },
  { key: 'warning', color: STATUS_COLORS.warning, test: (p) => p.status === 'warning' },
  { key: 'critical', color: STATUS_COLORS.critical, test: (p) => p.status === 'critical' },
  { key: 'unknown', color: STATUS_COLORS.unknown, test: () => true },
]
