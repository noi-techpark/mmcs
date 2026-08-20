import { createPointLayer } from './pointLayer'
import { hslToHex } from '../map/colorGradient'
import { PALETTE_SATURATION, PALETTE_LIGHTNESS, STATUS_COLORS } from '../map/colors'
import type { ColorRule } from './types'
import type { Feature } from '../types/feature'

// Thresholds classify a station's latest reading into a color tuned for
// Alto Adige's Alpine climate and mobility relevance (ice risk, heat,
// heavy rain) rather than generic meteorological bands. Mirror
// backend/internal/feeds/odh/weather.go's thresholds if these change.
const PRECIPITATION_HIGH_MM = 2 // mm since the station's last reading — sustained/heavy rain, road-hazard territory
const TEMP_UNDER_ZERO_C = 0 // ice risk
const TEMP_LOW_MAX_C = 10
const TEMP_MEDIUM_MAX_C = 25
const TEMP_HIGH_MAX_C = 32

// Same shared-S/L color wheel as colors.ts/parking.ts — hues chosen to
// read as blue/green/yellow/orange/red rather than derived from STATUS_HUES,
// since this is a 5-tier scale, not the app's generic 3-tier status.
const HUE_UNDER_ZERO = 210
const HUE_LOW = 137
const HUE_MEDIUM = 60
const HUE_HIGH = 30
const HUE_VERY_HIGH = 0

const wheel = (h: number) => hslToHex(h, PALETTE_SATURATION, PALETTE_LIGHTNESS)

function temperatureC(p: Feature['properties']): number | null {
  const t = p.data.temperatureC
  return typeof t === 'number' ? t : null
}

function precipitationMM(p: Feature['properties']): number | null {
  const v = p.data.precipitationMM
  return typeof v === 'number' ? v : null
}

const isHighPrecipitation = (p: Feature['properties']) => (precipitationMM(p) ?? -Infinity) >= PRECIPITATION_HIGH_MM

// First matching rule wins — heavy rain overrides temperature-based
// coloring regardless of how mild the temperature is, then temperature
// bands are checked low to high.
export const WEATHER_COLOR_RULES: ColorRule[] = [
  { key: 'precip-high', color: wheel(HUE_VERY_HIGH), score: 100, test: isHighPrecipitation },
  { key: 'temp-under-zero', color: wheel(HUE_UNDER_ZERO), score: 40, test: (p) => (temperatureC(p) ?? Infinity) <= TEMP_UNDER_ZERO_C },
  { key: 'temp-low', color: wheel(HUE_LOW), score: 10, test: (p) => (temperatureC(p) ?? Infinity) <= TEMP_LOW_MAX_C },
  { key: 'temp-medium', color: wheel(HUE_MEDIUM), score: 0, test: (p) => (temperatureC(p) ?? Infinity) <= TEMP_MEDIUM_MAX_C },
  { key: 'temp-high', color: wheel(HUE_HIGH), score: 20, test: (p) => (temperatureC(p) ?? Infinity) <= TEMP_HIGH_MAX_C },
  { key: 'temp-very-high', color: wheel(HUE_VERY_HIGH), score: 50, test: (p) => temperatureC(p) != null },
  { key: 'unknown', color: STATUS_COLORS.unknown, score: 0, test: () => true },
]

function weatherTooltip(props: Feature['properties']): string {
  const t = temperatureC(props)
  const p = precipitationMM(props)
  const lines: string[] = []
  if (t != null) lines.push(`${t.toFixed(1)}°C`)
  if (p != null) lines.push(`${p.toFixed(1)} mm`)
  return lines.join('<br/>')
}

// Own file so its thresholds/coloring can be tuned independently of the
// other layers — see layers/definitions.ts for how these get registered.
export const weatherLayer = createPointLayer('weather_station', 'Weather', {}, WEATHER_COLOR_RULES, true, weatherTooltip)
