// Mirrors backend/internal/model/feature.go — the common Feature shape.

export type Layer = 'parking' | 'e_charging' | 'train_vehicle' | 'bus_vehicle' | 'on_demand_vehicle' | 'flight'

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
  geometry: { type: string; coordinates: number[] }
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
