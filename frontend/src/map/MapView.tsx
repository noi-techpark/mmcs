// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { rankFeatures } from './pickFeature'
import { toFeature } from '../layers/pointLayer'
import { computeDisplacements, type DisplaceItem as Item } from './displace'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useFeatureStore } from '../store/featureStore'
import { LAYER_DEFINITIONS } from '../layers/definitions'
import { computePlacements, edgePoint, type Placement } from './labelPlacement'
import type { LayerOptions } from '../layers/types'
import type { Feature, Layer } from '../types/feature'
import type { Journey } from '../types/line'

const SELECTED_ROUTE_SOURCE = 'selected-route'
const SELECTED_ROUTE_LAYER = 'selected-route-line'

// South Tyrol / Südtirol / Alto Adige province extent (lng/lat corners).
const SOUTH_TYROL_BOUNDS: [[number, number], [number, number]] = [
  [10.38, 46.22],
  [12.48, 47.1],
]

// OpenFreeMap Positron: light, minimal basemap that keeps status/icon colors
// as the only saturated ink on screen. Ships its own glyphs (incl. Noto Sans
// Regular), needed for cluster-count labels.
const LIGHT_STYLE = 'https://tiles.openfreemap.org/styles/positron'

// Positron's place-name labels render pure black (#000), which reads too
// heavy against the feature layers drawn on top. Match the muted gray
// already used for road/POI labels in this style.
const BLACK_LABEL_LAYERS = [
  'label_village',
  'label_town',
  'label_city',
  'label_city_capital',
  'label_country_1',
  'label_country_2',
  'label_country_3',
]

// Thin out minor place labels: villages/hamlets and misc. places stay hidden
// until you've zoomed in well past the default view; towns hold off a couple
// levels too. Cities/states/countries keep their original (much lower) minzoom.
const LABEL_MINZOOM_OVERRIDES: Record<string, number> = {
  label_other: 10,
  label_village: 11,
  label_town: 8,
}

interface MapViewProps {
  visibleLayers: Set<Layer>
  layerOptions: Record<Layer, LayerOptions>
  layerOrder: Layer[]
  onFeatureSelect: (feature: Feature) => void
  /** The currently-selected train's actual journey (not the whole line) — resolved server-side, see /api/journey. */
  selectedJourney: Journey | null
}

export function MapView({ visibleLayers, layerOptions, layerOrder, onFeatureSelect, selectedJourney }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const layers = useFeatureStore((s) => s.layers)
  const connect = useFeatureStore((s) => s.connect)
  const [mapReady, setMapReady] = useState(false)
  const [placements, setPlacements] = useState<Placement[]>([])
  const onFeatureSelectRef = useRef(onFeatureSelect)
  onFeatureSelectRef.current = onFeatureSelect

  useEffect(() => {
    connect()
  }, [connect])

  useEffect(() => {
    if (!containerRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: LIGHT_STYLE,
      bounds: SOUTH_TYROL_BOUNDS,
    })
    mapRef.current = map

    map.on('load', () => {
      for (const layerId of BLACK_LABEL_LAYERS) {
        if (map.getLayer(layerId)) map.setPaintProperty(layerId, 'text-color', '#666')
      }
      for (const [layerId, minzoom] of Object.entries(LABEL_MINZOOM_OVERRIDES)) {
        if (map.getLayer(layerId)) map.setLayerZoomRange(layerId, minzoom, 24)
      }

      // Uniform white wash over the whole basemap (roads, buildings, land
      // cover, water) so it recedes further behind the feature layers, which
      // mount after this and so stay unaffected.
      map.addLayer({ id: 'basemap-wash', type: 'background', paint: { 'background-color': '#ffffff', 'background-opacity': 0.35 } })

      // Added before the layer defs mount, so their icons render above
      // this line rather than under it.
      map.addSource(SELECTED_ROUTE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
      map.addLayer({
        id: SELECTED_ROUTE_LAYER,
        type: 'line',
        source: SELECTED_ROUTE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#3987e5', 'line-width': 4, 'line-opacity': 0.8 },
      })

      const ctx = { onSelectFeature: (f: Feature) => onFeatureSelectRef.current(f) }
      for (const def of LAYER_DEFINITIONS) def.mount(map, ctx)

      // One click handler for all icons: picks the topmost icon under the
      // cursor (see map/pickFeature.ts). Cluster bubbles are skipped here —
      // their own handler zooms into them.
      map.on('click', (e) => {
        const layerIds = LAYER_DEFINITIONS.flatMap((d) => d.iconLayerIds ?? []).filter((id) => map.getLayer(id))
        if (layerIds.length === 0) return
        const [top] = rankFeatures(map, map.queryRenderedFeatures(e.point, { layers: layerIds }))
        if (!top || top.properties?.point_count != null) return
        ctx.onSelectFeature(toFeature(top))
      })
      setMapReady(true)
    })

    return () => map.remove()
  }, [])

  // push store data into each layer's map source(s)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    for (const def of LAYER_DEFINITIONS) {
      def.setData(map, Array.from(layers[def.id].values()))
    }
  }, [layers, mapReady])

  // toggle layer visibility
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    for (const def of LAYER_DEFINITIONS) {
      def.setVisible(map, visibleLayers.has(def.id))
    }
  }, [visibleLayers, mapReady])

  // per-layer options (opacity, and future layer-specific knobs)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    for (const def of LAYER_DEFINITIONS) {
      def.applyOptions(map, layerOptions[def.id] ?? def.defaultOptions)
    }
  }, [layerOptions, mapReady])

  // z-order: first entry in layerOrder renders on top. Move each layer's
  // GL sub-layers to the top of the stack in reverse order, so the last
  // one processed (layerOrder[0]) ends up highest. moveLayer with no
  // second arg means "move to top of current stack" — the basemap raster
  // layer is never touched, so it stays at the bottom throughout.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    for (let i = layerOrder.length - 1; i >= 0; i--) {
      const def = LAYER_DEFINITIONS.find((d) => d.id === layerOrder[i])
      if (!def?.mapLayerIds) continue
      for (const layerId of def.mapLayerIds) {
        if (map.getLayer(layerId)) map.moveLayer(layerId)
      }
    }
  }, [layerOrder, mapReady])

  // Selected train's actual route (its specific journey, not the whole
  // line) — the real road/rail-following polyline resolved server-side
  // from NeTEx ServiceLinks (see backend/internal/netex/parse.go
  // buildGeometry), not a straight line between stops.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource(SELECTED_ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined
    if (!source) return
    const features = selectedJourney
      ? [
          {
            type: 'Feature' as const,
            properties: { directionRef: selectedJourney.directionRef ?? '' },
            geometry: { type: 'LineString' as const, coordinates: selectedJourney.geometry },
          },
        ]
      : []
    source.setData({ type: 'FeatureCollection', features })
  }, [selectedJourney, mapReady])

  // Name-label layout: computed when the map settles and when data or the
  // controls change. During a gesture the layout is held fixed and each
  // bubble just follows its icon (see placeLabels), so bubbles don't flip
  // between candidate positions as the map moves.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const recompute = () => setPlacements(computePlacements({ map, visibleLayers, layerOptions }))
    recompute()
    map.on('idle', recompute)
    return () => {
      map.off('idle', recompute)
    }
  }, [mapReady, visibleLayers, layerOptions, layers])

  // Each bubble is positioned relative to where its icon was when the layout
  // was computed. Every render frame, shift it by the icon's current screen
  // delta. Done in the same 'render' event the GL canvas draws in, so bubbles
  // and icons move together with no React commit in between.
  const labelGroupRef = useRef<SVGGElement>(null)
  const placeLabels = () => {
    const map = mapRef.current
    const group = labelGroupRef.current
    if (!map || !group) return
    for (const el of Array.from(group.children)) {
      const lng = Number(el.getAttribute('data-lng'))
      const lat = Number(el.getAttribute('data-lat'))
      const p = map.project([lng, lat])
      const x0 = Number(el.getAttribute('data-x0'))
      const y0 = Number(el.getAttribute('data-y0'))
      el.setAttribute('transform', `translate(${p.x - x0}, ${p.y - y0})`)
    }
  }
  // Before paint, so a freshly computed layout never shows at a stale offset.
  useLayoutEffect(() => {
    placeLabels()
  }, [placements])
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    map.on('render', placeLabels)
    return () => {
      map.off('render', placeLabels)
    }
  }, [mapReady])

  // Overlapping icons are nudged apart after every settle (idle covers zoom
  // and data changes). Pans don't change relative screen positions, so the
  // result only actually changes on zoom or data; setDisplacement skips the
  // GL upload when it's the same as before.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const apply = () => {
      const participants = LAYER_DEFINITIONS.filter((d) => d.getDisplaceItems && d.setDisplacement)
      const perLayer = participants.map((d) => ({ def: d, items: d.getDisplaceItems?.(map) ?? [] }))
      const all: Item[] = perLayer.flatMap(({ def, items }) => items.map((i) => ({ key: `${def.id}|${i.id}`, lngLat: i.lngLat })))
      const moved = computeDisplacements(map, all)
      for (const { def, items } of perLayer) {
        const positions = new Map<string, [number, number]>()
        for (const i of items) {
          const ll = moved.get(`${def.id}|${i.id}`)
          if (ll) positions.set(i.id, ll)
        }
        def.setDisplacement?.(map, positions)
      }
    }
    // During a gesture 'move' fires every frame; coalesce to one pass per
    // animation frame so the nudge tracks zoom in step with the map.
    let frame = 0
    const scheduled = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        apply()
      })
    }
    apply()
    map.on('move', scheduled)
    map.on('idle', apply)
    return () => {
      map.off('move', scheduled)
      map.off('idle', apply)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [mapReady, layers, visibleLayers, layerOptions])


  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <svg
        data-testid="label-overlay"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        <g ref={labelGroupRef}>
        {placements.map((p) => {
          const edge = edgePoint(p.dot, p.rect)
          return (
            <g key={p.id} opacity={p.opacity} data-lng={p.lngLat[0]} data-lat={p.lngLat[1]} data-x0={p.dot.x} data-y0={p.dot.y}>
              <line x1={p.dot.x} y1={p.dot.y} x2={edge.x} y2={edge.y} stroke={p.color} strokeWidth={1.5} />
              <g
                onClick={() => onFeatureSelectRef.current(p.feature)}
                style={{ pointerEvents: 'auto', cursor: 'pointer' }}
              >
                <rect x={p.rect.x} y={p.rect.y} width={p.rect.w} height={p.rect.h} rx={6} fill={p.color} />
                <text
                  x={p.rect.x + p.rect.w / 2}
                  y={p.rect.y + p.rect.h / 2 + 4}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={600}
                  fill="#ffffff"
                  fontFamily="sans-serif"
                >
                  {p.text}
                </text>
              </g>
            </g>
          )
        })}
        </g>
      </svg>
    </div>
  )
}
