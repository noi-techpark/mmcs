// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// A22 road-section travel times (LinkStation), rendered as colored
// LineStrings rather than point icons — implements LayerDefinition directly
// instead of going through createPointLayer (see layers/types.ts), since
// that factory's clustering/displacement/label machinery is all built
// around Point geometry.
//
// Kept as its own sidebar entry next to the point traffic_station layer
// rather than merged into it: the two need different GL source/layer types
// (line vs symbol) regardless, and a separate toggle is itself the
// decluttering mechanism the task asked for — a cluttered view (sensors and
// road segments both on screen) is resolved by switching one of the two
// off, rather than by inventing a combined-layer visibility scheme.
import * as maplibregl from 'maplibre-gl'
import { toFeature } from './pointLayer'
import { STATUS_COLORS, STATUS_HUES, PALETTE_SATURATION, PALETTE_LIGHTNESS } from '../map/colors'
import { twoBreakpointHueGradient } from '../map/colorGradient'
import type { LayerDefinition } from './types'
import type { Feature } from '../types/feature'

const SOURCE_ID = 'traffic_segment'
const LINE_LAYER_ID = 'traffic_segment-lines'

// A22's light-vehicle level-of-service string (lds_leggeri_desc) takes one
// of exactly these five Italian values — enumerated by sampling the live
// feed (mobility.api.opendatahub.com/v2/flat/LinkStation), there's no
// published enum to go by. Ordered best→worst and spread evenly over the
// same 0–100 "how bad" scale parking.ts's occupancy gradient uses, so the
// line color reads as one continuous red→green severity ramp rather than a
// handful of arbitrarily-picked hex values.
const LINK_TRAFFIC_SEVERITY: Record<string, number> = {
  'traffico scorrevole': 0,
  rallentamenti: 25,
  'code a tratti': 50,
  'traffico rallentato con code': 75,
  'traffico critico': 100,
}

export const LINK_TRAFFIC_LABELS: Record<string, string> = {
  'traffico scorrevole': 'Flowing',
  rallentamenti: 'Slowdowns',
  'code a tratti': 'Intermittent queues',
  'traffico rallentato con code': 'Slowed, queuing',
  'traffico critico': 'Critical',
}

// Same green→yellow→red hue ramp as parking.ts's occupancy gradient (and
// the same STATUS_HUES anchors traffic.ts's point sensors use), just keyed
// by this layer's own 5-point severity scale instead of a percent.
const severityColor = twoBreakpointHueGradient(STATUS_HUES.ok, STATUS_HUES.warning, STATUS_HUES.critical, 50, 75, PALETTE_SATURATION, PALETTE_LIGHTNESS)

// lightTraffic lives nested under the feature's "data" property (see
// Feature.properties.data in types/feature.ts), not as a top-level
// property — ['get', 'lightTraffic'] alone would read nothing and always
// fall through to the grey default.
const lineColorExpr = [
  'match',
  ['get', 'lightTraffic', ['get', 'data']],
  ...Object.entries(LINK_TRAFFIC_SEVERITY).flatMap(([desc, pct]) => [desc, severityColor(pct).color]),
  STATUS_COLORS.unknown,
] as unknown as maplibregl.ExpressionSpecification

export const trafficSegmentLayer: LayerDefinition = {
  id: 'traffic_segment',
  label: 'Travel times',
  defaultOptions: { opacity: 1 },
  defaultVisible: false,
  mapLayerIds: [LINE_LAYER_ID],
  // No iconLayerIds: that's for symbol-layer glyphs the label overlay and
  // the global icon-click-pick list treat as point obstacles/targets (see
  // map/labelPlacement.ts, MapView's click handler) — a LineString's
  // coordinates are a list of [lon,lat] pairs, not a single point, so
  // feeding this line layer into that machinery crashed map.project() with
  // NaN lng/lat. Clicking a segment is handled directly in mount() instead.
  featureColor: (props) => {
    const desc = props.data.lightTraffic
    return (typeof desc === 'string' && desc in LINK_TRAFFIC_SEVERITY && severityColor(LINK_TRAFFIC_SEVERITY[desc]).color) || STATUS_COLORS.unknown
  },

  mount(map, ctx) {
    map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })

    map.addLayer({
      id: LINE_LAYER_ID,
      type: 'line',
      source: SOURCE_ID,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': lineColorExpr,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 14, 6],
        'line-opacity': 0.85,
      },
    })

    const hoverPopup = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 })
    map.on('mouseenter', LINE_LAYER_ID, (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      map.getCanvas().style.cursor = 'pointer'
      const f = e.features?.[0]
      if (!f) return
      const props = toFeature(f).properties
      const desc = typeof props.data.lightTraffic === 'string' ? props.data.lightTraffic : ''
      const label = LINK_TRAFFIC_LABELS[desc] ?? 'Unknown'
      hoverPopup.setLngLat(e.lngLat).setHTML(`<strong>${props.name}</strong><br/>${label}`).addTo(map)
    })
    map.on('mouseleave', LINE_LAYER_ID, () => {
      map.getCanvas().style.cursor = ''
      hoverPopup.remove()
    })
    map.on('click', LINE_LAYER_ID, (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      const f = e.features?.[0]
      if (f) ctx.onSelectFeature(toFeature(f))
    })
  },

  setData(map, features: Feature[]) {
    const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined
    source?.setData({ type: 'FeatureCollection', features })
  },

  setVisible(map, visible) {
    if (!map.getLayer(LINE_LAYER_ID)) return
    map.setLayoutProperty(LINE_LAYER_ID, 'visibility', visible ? 'visible' : 'none')
  },

  applyOptions(map, options) {
    if (!map.getLayer(LINE_LAYER_ID)) return
    map.setPaintProperty(LINE_LAYER_ID, 'line-opacity', 0.85 * options.opacity)
  },
}
