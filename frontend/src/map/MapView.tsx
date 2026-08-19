import { useEffect, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useFeatureStore } from '../store/featureStore'
import { LAYER_DEFINITIONS } from '../layers/definitions'
import { computePlacements, edgePoint, type Placement } from './labelPlacement'
import type { LayerOptions } from '../layers/types'
import type { Feature, Layer } from '../types/feature'
import type { RouteDetail } from '../types/line'

const SELECTED_ROUTE_SOURCE = 'selected-route'
const SELECTED_ROUTE_LAYER = 'selected-route-line'

const BOLZANO_CENTER: [number, number] = [11.35, 46.5]

// CARTO Positron: light, minimal basemap that keeps status/icon colors as
// the only saturated ink on screen. Glyphs are needed for cluster-count labels.
const LIGHT_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    basemap: {
      type: 'raster',
      tiles: ['https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors © CARTO',
    },
  },
  layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
}

interface MapViewProps {
  visibleLayers: Set<Layer>
  layerOptions: Record<Layer, LayerOptions>
  layerOrder: Layer[]
  onFeatureSelect: (feature: Feature) => void
  /** The specific route of the currently-selected train's actual journey (not the whole line) — see util/journey.ts. */
  selectedRoute: RouteDetail | null
}

export function MapView({ visibleLayers, layerOptions, layerOrder, onFeatureSelect, selectedRoute }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const layers = useFeatureStore((s) => s.layers)
  const connect = useFeatureStore((s) => s.connect)
  const [mapReady, setMapReady] = useState(false)
  const [placements, setPlacements] = useState<Placement[]>([])
  // Bumped on every recompute and used as the pan-tracking <g>'s `key`, so
  // React unmounts the old (possibly still-panned) node and mounts a fresh,
  // transform-less one in the very same commit as the new placements —
  // rather than us imperatively clearing a lingering transform and hoping
  // it lands in the same paint as React's own DOM update for the new
  // positions. That imperative approach could win the race either way:
  // clearing too early (synchronously, before React's batched/async commit)
  // flashed the old placements at zero-transform for a frame; deferring it
  // (rAF, useLayoutEffect) then risked landing a frame *after* instead,
  // since MapLibre's 'idle' can itself fire synchronously from inside our
  // own effects, which made the ordering genuinely unpredictable. A key
  // change guarantees old-node-teardown and new-content-mount happen
  // atomically, so there's no window where they can be out of sync.
  const [recomputeGen, setRecomputeGen] = useState(0)
  const panGroupRef = useRef<SVGGElement>(null)
  // The camera center + its screen position at the moment `placements` was
  // last computed. Panning translates every placement by exactly the same
  // screen delta, so instead of re-running collision placement (or even
  // just re-projecting every label) on each of the map's own render frames,
  // we set one CSS transform on the wrapping <g> — imperatively, bypassing
  // React entirely for this hot path, which is what was still costing a
  // frame of lag over a real GL layer. Doesn't account for zoom (labels
  // won't rescale mid-gesture), same simplification the old per-placement
  // reprojection made; corrected on the next 'idle' recompute.
  const panBaseRef = useRef<{ lngLat: maplibregl.LngLat; pixel: maplibregl.Point } | null>(null)
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
      center: BOLZANO_CENTER,
      zoom: 12,
    })
    mapRef.current = map

    map.on('load', () => {
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
  // line — see util/journey.ts), drawn as a straight-line polyline between
  // consecutive stops (NeTEx gives us the ordered stop sequence directly;
  // the actual road/rail-following geometry would need assembling
  // ServiceLink segments, out of scope here).
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return
    const source = map.getSource(SELECTED_ROUTE_SOURCE) as maplibregl.GeoJSONSource | undefined
    if (!source) return
    const features = selectedRoute
      ? [
          {
            type: 'Feature' as const,
            properties: { directionRef: selectedRoute.directionRef ?? '' },
            geometry: { type: 'LineString' as const, coordinates: selectedRoute.stops.map((s) => [s.lon, s.lat]) },
          },
        ]
      : []
    source.setData({ type: 'FeatureCollection', features })
  }, [selectedRoute, mapReady])

  // Name-label placement: recompute whenever the map settles after a
  // camera move or a data/paint update ('idle' covers both), and
  // immediately when the controls driving it change.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const recompute = () => {
      setPlacements(computePlacements({ map, visibleLayers, layerOptions }))
      setRecomputeGen((g) => g + 1)
      panBaseRef.current = { lngLat: map.getCenter(), pixel: map.project(map.getCenter()) }
    }
    recompute()
    map.on('idle', recompute)
    return () => {
      map.off('idle', recompute)
    }
  }, [mapReady, visibleLayers, layerOptions, layers])

  // Keep bubbles/lines glued to their glyphs during continuous pan/zoom:
  // 'idle' above only fires once the gesture settles, so without this the
  // SVG overlay would freeze mid-drag while the GL canvas keeps moving.
  // 'render' fires once per frame the GL canvas actually repaints. Rather
  // than re-deriving and re-rendering every placement through React on each
  // of those frames (which was still a frame of lag behind the canvas),
  // just slide the whole overlay by the same screen delta the camera
  // moved — a single DOM write, no React involved, so it rides along with
  // the canvas instead of trailing it.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const onRender = () => {
      const base = panBaseRef.current
      if (!base) return
      const pixel = map.project(base.lngLat)
      const dx = pixel.x - base.pixel.x
      const dy = pixel.y - base.pixel.y
      // The CSS transform *property* (as opposed to the SVG "transform"
      // *attribute*) lets the browser move this as a compositor-only step
      // instead of re-running SVG layout every frame — the same mechanism
      // that makes CSS transform animations smooth.
      if (panGroupRef.current) panGroupRef.current.style.transform = `translate(${dx}px, ${dy}px)`
    }
    map.on('render', onRender)
    return () => {
      map.off('render', onRender)
    }
  }, [mapReady])

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <svg
        data-testid="label-overlay"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        <g key={recomputeGen} ref={panGroupRef}>
        {placements.map((p) => {
          const edge = edgePoint(p.dot, p.rect)
          return (
            <g key={p.id}>
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
