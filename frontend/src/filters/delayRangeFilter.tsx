// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Reusable delay-range filter: a double-sided (min/max) slider over a
// minutes scale, colored in four brackets — anticipation (early/negative
// delay), punctual, small delay, high delay — using the exact same
// thresholds and colors as the map's own delay gradient (see
// filters/delayBrackets.ts and layers/delayColor.ts), so the filter and
// the icon colors never disagree about what a given delay means.
// Not tied to bus.ts: `createDelayRangeFilter()` is a factory so any layer
// with a `delaySeconds` field (e.g. trains) can instance its own copy with
// its own id/label/domain.
import { useRef } from 'react'
import { PUNCTUAL_TO_SMALL_MIN, SMALL_TO_HIGH_MIN, DELAY_BRACKET_COLORS, delayGradientColor } from './delayBrackets'
import type { FilterInstance, FilterControlProps } from './types'
import type { Feature } from '../types/feature'

export type DelayRange = [number, number]

export interface DelayRangeFilterOptions {
  id?: string
  label?: string
  /** Minutes. The lower/upper slider bound — reaching it means "no limit" on that side. */
  min?: number
  max?: number
  /** Minutes. Boundary between "punctual" and "small delay". Defaults to PUNCTUAL_TO_SMALL_MIN. */
  smallAt?: number
  /** Minutes. Boundary between "small delay" and "high delay". Defaults to SMALL_TO_HIGH_MIN. */
  highAt?: number
  /** Minutes. If set, the layer starts pre-filtered to "≥ this" (upper stays unbounded) instead of starting fully open. */
  initialLo?: number
}

function formatMinutes(m: number): string {
  return `${m > 0 ? '+' : ''}${m}m`
}

function describeRange(value: DelayRange, min: number, max: number): string {
  const [lo, hi] = value
  const loText = lo <= min ? null : formatMinutes(lo)
  const hiText = hi >= max ? null : formatMinutes(hi)
  if (loText && hiText) return `${loText} to ${hiText}`
  if (loText) return `≥ ${loText}`
  if (hiText) return `≤ ${hiText}`
  return 'Any'
}

function formatUpperBound(hi: number, max: number, highAt: number): string {
  return hi >= max ? `${highAt}+ min` : formatMinutes(hi)
}

// "Anticipation" isn't a graded scale (see delayGradientColor — every
// negative delay is the same flat color), so the lower handle has no
// stops between `min` and 0: it's effectively a 2-state toggle ("any
// early" vs. a real 0..hi cutoff) at the low end, not a continuum. A
// native <input type="range"> fights this — snapping its controlled value
// back to `min` on every negative change also resets the DOM value the
// browser computes the *next* keyboard step from, so ArrowRight could
// never climb back out of `min`. A small pointer/keyboard-driven track
// avoids that: position-based dragging is snapped per-move (see
// clampLo), and keyboard stepping is handled with explicit direction
// (see stepLo) instead of relying on the browser's own step arithmetic.
function clampLo(rawMinutes: number, min: number, hi: number): number {
  const capped = Math.min(Math.round(rawMinutes), hi)
  return capped < 0 ? min : capped
}

function clampHi(rawMinutes: number, max: number, lo: number): number {
  return Math.min(max, Math.max(Math.round(rawMinutes), lo))
}

function stepLo(current: number, dir: 1 | -1, min: number, hi: number): number {
  if (dir < 0) return current <= 0 ? min : Math.max(0, current - 1)
  return current === min ? 0 : Math.min(hi, current + 1)
}

function stepHi(current: number, dir: 1 | -1, max: number, lo: number): number {
  return Math.min(max, Math.max(lo, current + dir))
}

function Thumb({
  pct,
  ariaLabel,
  ariaValueText,
  onDragStart,
  onKeyDown,
}: {
  pct: number
  ariaLabel: string
  ariaValueText: string
  onDragStart: (startClientX: number) => void
  onKeyDown: (e: React.KeyboardEvent) => void
}) {
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label={ariaLabel}
      aria-valuetext={ariaValueText}
      onMouseDown={(e) => {
        e.preventDefault()
        onDragStart(e.clientX)
      }}
      onKeyDown={onKeyDown}
      style={{
        position: 'absolute',
        left: `${pct}%`,
        top: 8,
        transform: 'translate(-50%, -50%)',
        width: 14,
        height: 14,
        borderRadius: '50%',
        background: '#fcfcfb',
        border: '2px solid #1c1e22',
        cursor: 'pointer',
        boxSizing: 'border-box',
      }}
    />
  )
}

function DelayRangeControl({
  value,
  onChange,
  min,
  max,
  smallAt,
  highAt,
}: FilterControlProps<DelayRange> & { min: number; max: number; smallAt: number; highAt: number }) {
  const [lo, hi] = value
  const trackRef = useRef<HTMLDivElement>(null)
  const pct = (m: number) => ((m - min) / (max - min)) * 100
  const valueAtClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect) return min
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    return min + ratio * (max - min)
  }

  // Sampled continuous gradient — same delayGradientColor() the map icons
  // are colored with (see filters/delayBrackets.ts) — rather than hard
  // brackets, so the slider reads exactly like the icons it's filtering.
  // One stop per whole minute is smooth enough at this track width; 0 and
  // max are added explicitly in case min/max aren't whole numbers.
  const stopMinutes = Array.from(new Set([min, ...Array.from({ length: Math.floor(max) - Math.ceil(min) + 1 }, (_, i) => Math.ceil(min) + i), max])).sort((a, b) => a - b)
  const gradient = stopMinutes.map((m) => `${delayGradientColor(m).color} ${pct(m)}%`).join(', ')

  const dragLo = (startClientX: number) => {
    const move = (ev: MouseEvent) => onChange([clampLo(valueAtClientX(ev.clientX), min, hi), hi])
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    move({ clientX: startClientX } as MouseEvent)
  }

  const dragHi = (startClientX: number) => {
    const move = (ev: MouseEvent) => onChange([lo, clampHi(valueAtClientX(ev.clientX), max, lo)])
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    move({ clientX: startClientX } as MouseEvent)
  }

  const onKeyDownLo = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      onChange([stepLo(lo, -1, min, hi), hi])
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      onChange([stepLo(lo, 1, min, hi), hi])
    } else if (e.key === 'Home') {
      e.preventDefault()
      onChange([min, hi])
    }
  }

  const onKeyDownHi = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault()
      onChange([lo, stepHi(hi, -1, max, lo)])
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault()
      onChange([lo, stepHi(hi, 1, max, lo)])
    } else if (e.key === 'End') {
      e.preventDefault()
      onChange([lo, max])
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: 220 }}>
      <div ref={trackRef} style={{ position: 'relative', height: 16 }}>
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 5,
            height: 6,
            borderRadius: 3,
            background: `linear-gradient(to right, ${gradient})`,
          }}
        />
        <Thumb
          pct={pct(lo)}
          ariaLabel="Minimum delay"
          ariaValueText={lo <= min ? 'Any early' : formatMinutes(lo)}
          onDragStart={dragLo}
          onKeyDown={onKeyDownLo}
        />
        <Thumb
          pct={pct(hi)}
          ariaLabel="Maximum delay"
          ariaValueText={formatUpperBound(hi, max, highAt)}
          onDragStart={dragHi}
          onKeyDown={onKeyDownHi}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9a9ea5' }}>
        <span>{lo <= min ? 'Any early' : formatMinutes(lo)}</span>
        <span>{formatUpperBound(hi, max, highAt)}</span>
      </div>
      <div style={{ display: 'flex', fontSize: 9.5, color: '#9a9ea5', textTransform: 'uppercase', letterSpacing: 0.3 }}>
        <span style={{ flex: 0 - min, color: DELAY_BRACKET_COLORS.anticipation }}>Early</span>
        <span style={{ flex: smallAt - 0, color: DELAY_BRACKET_COLORS.punctual, textAlign: 'center' }}>Punctual</span>
        <span style={{ flex: highAt - smallAt, color: DELAY_BRACKET_COLORS.small, textAlign: 'center' }}>Small</span>
        <span style={{ flex: max - highAt, color: DELAY_BRACKET_COLORS.high, textAlign: 'right' }}>High</span>
      </div>
    </div>
  )
}

function delayMinutes(feature: Feature): number | null {
  const s = feature.properties.data.delaySeconds
  return typeof s === 'number' ? s / 60 : null
}

/**
 * Instances a fresh delay-range filter. Each call owns its own id/label/
 * domain, so different layers can each get their own instance (with their
 * own overrides) from the same reusable implementation.
 */
export function createDelayRangeFilter(overrides: DelayRangeFilterOptions = {}): FilterInstance<DelayRange> {
  const id = overrides.id ?? 'delay'
  const label = overrides.label ?? 'Delay'
  const min = overrides.min ?? -15
  const max = overrides.max ?? 30
  const smallAt = overrides.smallAt ?? PUNCTUAL_TO_SMALL_MIN
  const highAt = overrides.highAt ?? SMALL_TO_HIGH_MIN

  return {
    id,
    label,
    defaultValue: [min, max],
    ...(overrides.initialLo != null ? { initialValue: [overrides.initialLo, max] as DelayRange } : {}),
    isActive: ([lo, hi]) => lo > min || hi < max,
    describe: (value) => describeRange(value, min, max),
    test(feature, [lo, hi]) {
      const minutes = delayMinutes(feature)
      // Features with no delay data can't be classified against the
      // filter, so they stay visible regardless of the selected range —
      // consistent with the 'unknown' catch-all in delayColor.ts.
      if (minutes == null) return true
      const effectiveLo = lo <= min ? -Infinity : lo
      const effectiveHi = hi >= max ? Infinity : hi
      return minutes >= effectiveLo && minutes <= effectiveHi
    },
    Control: (props) => <DelayRangeControl {...props} min={min} max={max} smallAt={smallAt} highAt={highAt} />,
  }
}
