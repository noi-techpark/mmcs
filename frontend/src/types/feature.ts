// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Mirrors backend/internal/model/feature.go — the common Feature shape.

export type Layer =
  | 'parking'
  | 'e_charging'
  | 'train_vehicle'
  | 'bus_vehicle'
  | 'bus_alert'
  | 'on_demand_vehicle'
  | 'on_demand_vm_vehicle'
  | 'flight'
  | 'weather_station'
  | 'traffic_station'
  | 'traffic_segment'
  | 'bicycle'
  | 'carsharing_station'
  | 'air_quality'

export type Status = 'ok' | 'warning' | 'critical' | 'unknown'

export interface Ref {
  lineId?: string
  routeId?: string
  stopId?: string
}

export interface Properties {
  layer: Layer
  status?: Status
  /** Identifies this point to a human — station name, vehicle + line/destination, ... */
  name: string
  /** When our system last processed this feature. */
  updatedAt: string
  /** Age of the data itself (source feed's own timestamp) — use this for "how fresh". */
  recordedAt: string
  source: string
  ref?: Ref
  data: Record<string, unknown>
}

export interface Feature {
  type: 'Feature'
  id: string
  // number[] for Point ([lon,lat]), number[][] for LineString (a list of
  // [lon,lat] pairs) — see backend/internal/model/feature.go Geometry.
  geometry: { type: string; coordinates: number[] | number[][] }
  properties: Properties
}

export interface FeatureCollection {
  type: 'FeatureCollection'
  features: Feature[]
}

export interface Diff {
  layer: Layer
  action: 'upsert' | 'delete'
  feature: Feature
}

export type ServerMessage =
  | { type: 'snapshot'; layer: Layer; data: FeatureCollection }
  | { type: 'diff'; data: Diff }
