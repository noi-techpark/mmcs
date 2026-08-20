// A LayerDefinition is the unit of modularity for map overlays: each
// layer type owns its own map rendering (mount/setData/setVisible/
// applyOptions) and, optionally, its own sidebar options beyond the
// common opacity slider (OptionsPanel). New layer types (e.g. a
// LineString-based traffic-segment layer) implement this interface
// directly instead of going through the point-layer factory.
import type * as maplibregl from 'maplibre-gl'
import type { ComponentType } from 'react'
import type { Feature, Layer } from '../types/feature'

export interface LayerOptions {
  opacity: number
  [key: string]: unknown
}

export interface LayerOptionsPanelProps {
  options: LayerOptions
  onChange: (options: LayerOptions) => void
}

/** Passed to mount() so a layer can call back into the app without owning it. */
export interface LayerMountContext {
  onSelectFeature: (feature: Feature) => void
}

/**
 * One entry in a layer's color configuration: the first rule whose test
 * passes wins. Rendering color is a per-layer concern, decoupled from the
 * backend's coarse Status field (used for clustering's worst-status
 * color and the sidebar legend) — a layer can classify features by
 * anything in Properties, at whatever granularity it wants. Rule sets
 * must end with a catch-all (test: () => true).
 */
export interface ColorRule {
  key: string
  color: string
  /** Icon opacity for features matching this rule, 0–1. Defaults to 1 (opaque) when omitted — only gradient-based rule sets (parking occupancy, train/bus delay) set this below 1. */
  opacity?: number
  /** How "bad" this rule is, 0–100 — drives symbol-sort-key (see pointLayer.ts) so redder/more-opaque icons draw above calmer ones of the same layer when they'd otherwise overlap. Defaults to 0. */
  score?: number
  test: (props: Feature['properties']) => boolean
}

/** One name-label bubble the overlay should try to place near a glyph. */
export interface LabelTarget {
  id: string
  lngLat: [number, number]
  text: string
  color: string
  /** Bubble opacity, 0–1 — mirrors the glyph's dynamic-opacity gradient (see pointLayer.ts) so a faded icon gets a faded nameplate too. Defaults to 1. */
  opacity?: number
  /** The full feature, so clicking the bubble can open the same detail view as clicking the glyph. */
  feature: Feature
}

export interface LayerDefinition {
  id: Layer
  label: string
  defaultOptions: LayerOptions
  /** Adds this layer's sources/map-layers. Called once after map 'load'. */
  mount: (map: maplibregl.Map, ctx: LayerMountContext) => void
  /** Pushes fresh feature data for this layer into its map source(s). */
  setData: (map: maplibregl.Map, features: Feature[]) => void
  /** Shows/hides this layer's map-layers. */
  setVisible: (map: maplibregl.Map, visible: boolean) => void
  /** Applies option changes (opacity and any layer-specific knobs). */
  applyOptions: (map: maplibregl.Map, options: LayerOptions) => void
  /** Optional layer-specific controls rendered below the opacity slider. */
  OptionsPanel?: ComponentType<LayerOptionsPanelProps>
  /**
   * GL layer ids whose rendered glyphs the label overlay (see
   * map/LabelOverlay.tsx) should treat as placement obstacles — a name
   * bubble should not cover an unrelated icon, from this layer or any
   * other. Point layers list their icon/cluster-circle layer ids here.
   */
  iconLayerIds?: string[]
  /**
   * If this layer supports name-label bubbles, returns the currently
   * relevant (visible, unclustered) targets for the overlay to place.
   * Returning [] (e.g. because the layer's own "labels" option is off)
   * is how a layer opts out per-instance without the overlay knowing why.
   */
  getLabelTargets?: (map: maplibregl.Map) => LabelTarget[]
  /**
   * Every GL layer id this layer owns, for z-order control: MapView moves
   * these as one unit via map.moveLayer when the user drags this layer to
   * a new position in the sidebar. Order within the array doesn't matter,
   * only which ids belong to this layer.
   */
  mapLayerIds?: string[]
  /** Whether this layer starts checked-on in the sidebar. Defaults to true. */
  defaultVisible?: boolean
}
