// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A filter is a small, reusable rule that a layer can plug into its point
// data: a value type, a test against a feature, and the control that edits
// that value. `createXFilter()` factories (see delayRangeFilter.tsx) build
// one FilterInstance per call, so the same filter *kind* can be instanced
// multiple times with different ids/labels/domains by different layers
// (e.g. a delay filter reused by both bus.ts and, later, trains.ts) without
// the instances sharing state.
import type { ComponentType } from 'react'
import type { Feature } from '../types/feature'

export interface FilterControlProps<V> {
  value: V
  onChange: (value: V) => void
}

export interface FilterInstance<V = unknown> {
  /** Unique within the owning layer — used as the key in LayerOptions.filterValues. */
  id: string
  /** Shown as the section heading in the filter panel and as the active-tag prefix. */
  label: string
  /** The "no filtering" value — what the active-tag's clear (✕) button resets to. */
  defaultValue: V
  /**
   * If set, the layer starts with this value instead of `defaultValue` —
   * for a layer that wants a filter pre-applied on first load (see
   * layers/pointLayer.ts's defaultOptions). Clearing the filter's tag
   * still resets to `defaultValue` (fully open), not back to this.
   */
  initialValue?: V
  /** Whether `value` differs from "no filtering" — drives the active tag. */
  isActive: (value: V) => boolean
  /** Short text for the active-filter tag, e.g. "5–15 min". */
  describe: (value: V) => string
  /** Whether a feature passes the filter at the given value. */
  test: (feature: Feature, value: V) => boolean
  Control: ComponentType<FilterControlProps<V>>
}
