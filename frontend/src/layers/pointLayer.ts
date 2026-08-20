// Default visualizer for point-feature layers (parking, e-charging,
// vehicles, ...): renders individual features as color-coded icons, with
// two independently toggleable options:
//  - clustering: groups overlapping icons into a count bubble colored by
//    the worst backend Status inside it (critical > warning > ok) — this
//    stays status-based regardless of a layer's own color rules, since a
//    cluster needs one coarse "how bad" signal, not a fine-grained one.
//  - labels: a name bubble (see map/labelPlacement.ts) connected to each
//    icon by a leader line, generic over the shared Properties.name field
//    — no per-layer rendering code needed. The overlay owns placement
//    (collision avoidance against other icons/bubbles); this factory just
//    reports its current on-screen targets via getLabelTargets.
// Both are off by default at the factory level; a call site (e.g.
// trains.ts) overrides either via the `overrides` param.
//
// Per-feature icon color is a separate axis: `colorRules` (see
// layers/types.ts ColorRule) classifies a feature into a color, defaulting
// to the backend's Status field (colors.ts STATUS_COLOR_RULES) but
// overridable per layer for a finer/different scheme — see trains.ts,
// which replicates the trains-realtime webcomponent's 5-tier delay
// coloring instead of the generic 3-tier status colors.
//
// Clustering is a source-level setting in MapLibre (fixed at source
// creation), so toggling it at runtime is done by maintaining two
// sources — one clustered, one flat — fed identical data, and swapping
// which layer set is visible rather than recreating either source.
import * as maplibregl from 'maplibre-gl'
import { STATUS_COLORS, STATUS_COLOR_RULES } from '../map/colors'
import { registerIcons, iconImageId, ICON_RENDER_SCALE } from '../map/icons'
import { createPointLayerOptions } from './PointLayerOptions'
import type { LayerDefinition, LayerOptions, LabelTarget, ColorRule } from './types'
import type { Feature, Layer } from '../types/feature'

const CLUSTER_RADIUS = 50
const CLUSTER_MAX_ZOOM = 15

/** Rebuilds our Feature shape from a rendered GL feature (data/ref come back as objects or JSON strings depending on source). */
function toFeature(f: maplibregl.MapGeoJSONFeature): Feature {
  const props = f.properties as Record<string, unknown>
  const data = typeof props.data === 'string' ? JSON.parse(props.data) : (props.data ?? {})
  const ref = typeof props.ref === 'string' ? JSON.parse(props.ref) : props.ref
  return {
    type: 'Feature',
    id: String(f.id ?? props.id ?? ''),
    geometry: f.geometry as { type: string; coordinates: number[] },
    properties: { ...props, data, ref } as never,
  }
}

export function createPointLayer(
  id: Layer,
  label: string,
  overrides: Partial<LayerOptions> = {},
  colorRules: ColorRule[] = STATUS_COLOR_RULES,
  defaultVisible = true,
  /** When set, hovering an (unclustered) icon shows a small popup built from this. Return '' to skip. */
  tooltip?: (props: Feature['properties']) => string,
): LayerDefinition {
  const clusteredSourceId = id
  const flatSourceId = `${id}-flat`
  const clusterLayerId = `${id}-clusters`
  const countLayerId = `${id}-cluster-count`
  const clusteredPointsLayerId = `${id}-points`
  const flatPointsLayerId = `${id}-flat-points`

  // Rule sets must end with a catch-all; that last rule doubles as the
  // match expression's default value.
  const fallbackRule = colorRules[colorRules.length - 1]
  function classify(props: Feature['properties']): ColorRule {
    return colorRules.find((r) => r.test(props)) ?? fallbackRule
  }

  const iconExpr = [
    'match',
    ['get', '_colorKey'],
    ...colorRules.slice(0, -1).flatMap((r) => [r.key, iconImageId(id, r.key)]),
    iconImageId(id, fallbackRule.key),
  ] as unknown as maplibregl.ExpressionSpecification

  // Whether any rule in this set actually varies opacity (parking
  // occupancy, train/bus delay) — only those layers get a "Dynamic
  // opacity" toggle, and only they need the per-feature opacity
  // expression below instead of a flat 1.
  const hasGradientOpacity = colorRules.some((r) => (r.opacity ?? 1) < 1)
  const dynamicOpacityExpr = [
    'match',
    ['get', '_colorKey'],
    ...colorRules.slice(0, -1).flatMap((r) => [r.key, r.opacity ?? 1]),
    fallbackRule.opacity ?? 1,
  ] as unknown as maplibregl.ExpressionSpecification

  // Mutable so a single map-layer-visibility update can account for the
  // layer's on/off state and its clustering option together.
  let currentlyVisible = true
  let clusteringEnabled = overrides.clustering === true
  let labelsEnabled = overrides.labels === true
  let dynamicOpacityEnabled = overrides.dynamicOpacity !== false

  function syncVisibility(map: maplibregl.Map) {
    if (!map.getLayer(clusteredPointsLayerId)) return
    const clusteredVisible = currentlyVisible && clusteringEnabled
    const flatVisible = currentlyVisible && !clusteringEnabled
    const vis = (v: boolean) => (v ? 'visible' : 'none')
    map.setLayoutProperty(clusterLayerId, 'visibility', vis(clusteredVisible))
    map.setLayoutProperty(countLayerId, 'visibility', vis(clusteredVisible))
    map.setLayoutProperty(clusteredPointsLayerId, 'visibility', vis(clusteredVisible))
    map.setLayoutProperty(flatPointsLayerId, 'visibility', vis(flatVisible))
  }

  function addPointsLayer(map: maplibregl.Map, layerId: string, source: string, filter?: maplibregl.FilterSpecification) {
    map.addLayer({
      id: layerId,
      type: 'symbol',
      source,
      ...(filter ? { filter } : {}),
      layout: {
        'icon-image': iconExpr,
        'icon-size': ICON_RENDER_SCALE,
        'icon-allow-overlap': true,
      },
      paint: {
        'icon-opacity': hasGradientOpacity ? dynamicOpacityExpr : 1,
      },
    })
  }

  return {
    id,
    label,
    defaultOptions: { opacity: 1, clustering: false, labels: false, dynamicOpacity: true, ...overrides },
    OptionsPanel: createPointLayerOptions(hasGradientOpacity),
    iconLayerIds: [clusterLayerId, clusteredPointsLayerId, flatPointsLayerId],
    mapLayerIds: [clusterLayerId, countLayerId, clusteredPointsLayerId, flatPointsLayerId],
    defaultVisible,

    mount(map, ctx) {
      registerIcons(map, id, colorRules)

      const emptyFC = { type: 'FeatureCollection' as const, features: [] }

      map.addSource(clusteredSourceId, {
        type: 'geojson',
        data: emptyFC,
        cluster: true,
        clusterRadius: CLUSTER_RADIUS,
        clusterMaxZoom: CLUSTER_MAX_ZOOM,
        clusterProperties: {
          crit: ['+', ['case', ['==', ['get', 'status'], 'critical'], 1, 0]],
          warn: ['+', ['case', ['==', ['get', 'status'], 'warning'], 1, 0]],
        },
      })
      map.addSource(flatSourceId, { type: 'geojson', data: emptyFC })

      map.addLayer({
        id: clusterLayerId,
        type: 'circle',
        source: clusteredSourceId,
        filter: ['has', 'point_count'],
        paint: {
          'circle-radius': ['step', ['get', 'point_count'], 14, 25, 18, 100, 24],
          'circle-color': [
            'case',
            ['>', ['get', 'crit'], 0], STATUS_COLORS.critical,
            ['>', ['get', 'warn'], 0], STATUS_COLORS.warning,
            STATUS_COLORS.ok,
          ] as unknown as maplibregl.ExpressionSpecification,
          'circle-opacity': 0.85,
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
        },
      })

      map.addLayer({
        id: countLayerId,
        type: 'symbol',
        source: clusteredSourceId,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 12,
          'text-font': ['Noto Sans Regular'],
        },
        paint: { 'text-color': '#ffffff' },
      })

      const unclusteredFilter: maplibregl.FilterSpecification = ['!', ['has', 'point_count']]
      addPointsLayer(map, clusteredPointsLayerId, clusteredSourceId, unclusteredFilter)
      addPointsLayer(map, flatPointsLayerId, flatSourceId)

      map.on('click', clusterLayerId, (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: [clusterLayerId] })
        const clusterId = features[0]?.properties?.cluster_id
        if (clusterId == null) return
        const source = map.getSource(clusteredSourceId) as maplibregl.GeoJSONSource
        const coords = (features[0].geometry as { coordinates: [number, number] }).coordinates
        source.getClusterExpansionZoom(clusterId).then((zoom) => {
          map.easeTo({ center: coords, zoom })
        })
      })
      map.on('mouseenter', clusterLayerId, () => (map.getCanvas().style.cursor = 'pointer'))
      map.on('mouseleave', clusterLayerId, () => (map.getCanvas().style.cursor = ''))

      const selectFeature = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
        const f = e.features?.[0]
        if (!f) return
        ctx.onSelectFeature(toFeature(f))
      }
      // Hover popup, one instance reused across every point in this layer
      // rather than per-feature — cheap to move, and only one can be open
      // (under the cursor) at a time anyway.
      const hoverPopup = tooltip
        ? new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 14 })
        : null
      for (const layerId of [clusteredPointsLayerId, flatPointsLayerId]) {
        map.on('click', layerId, selectFeature)
        map.on('mouseenter', layerId, (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
          map.getCanvas().style.cursor = 'pointer'
          const f = e.features?.[0]
          if (!tooltip || !hoverPopup || !f) return
          const html = tooltip(toFeature(f).properties)
          if (!html) return
          const coords = (f.geometry as { coordinates: [number, number] }).coordinates
          hoverPopup.setLngLat(coords).setHTML(html).addTo(map)
        })
        map.on('mouseleave', layerId, () => {
          map.getCanvas().style.cursor = ''
          hoverPopup?.remove()
        })
      }

      syncVisibility(map)
    },

    setData(map, features) {
      const tagged = features.map((f) => ({
        ...f,
        properties: { ...f.properties, _colorKey: classify(f.properties).key },
      }))
      const fc = { type: 'FeatureCollection' as const, features: tagged }
      ;(map.getSource(clusteredSourceId) as maplibregl.GeoJSONSource | undefined)?.setData(fc)
      ;(map.getSource(flatSourceId) as maplibregl.GeoJSONSource | undefined)?.setData(fc)
    },

    setVisible(map, visible) {
      currentlyVisible = visible
      syncVisibility(map)
    },

    applyOptions(map, options) {
      if (!map.getLayer(clusteredPointsLayerId)) return
      clusteringEnabled = options.clustering === true
      labelsEnabled = options.labels === true
      dynamicOpacityEnabled = options.dynamicOpacity !== false
      syncVisibility(map)

      const opacity = options.opacity
      const dynamicOpacityOn = hasGradientOpacity && options.dynamicOpacity !== false
      map.setPaintProperty(clusteredPointsLayerId, 'icon-opacity', dynamicOpacityOn ? dynamicOpacityExpr : opacity)
      map.setPaintProperty(flatPointsLayerId, 'icon-opacity', dynamicOpacityOn ? dynamicOpacityExpr : opacity)
      map.setPaintProperty(clusterLayerId, 'circle-opacity', 0.85 * opacity)
      map.setPaintProperty(countLayerId, 'text-opacity', opacity)
    },

    getLabelTargets(map): LabelTarget[] {
      if (!labelsEnabled || !currentlyVisible) return []
      const activeLayerId = clusteringEnabled ? clusteredPointsLayerId : flatPointsLayerId
      if (!map.getLayer(activeLayerId)) return []
      const features = map.queryRenderedFeatures({ layers: [activeLayerId] })
      // queryRenderedFeatures can return the same feature more than once
      // (it spans tile boundaries), and MapLibre auto-assigns its own
      // numeric f.id per tile for GeoJSON sources with string ids like
      // ours — that id repeats across genuinely different features, so it
      // can't be used as a key. Dedupe (and key) on coordinates + name
      // instead. (name alone isn't unique either: it's "line - direction",
      // shared by many vehicles on the same route.)
      const seen = new Set<string>()
      const targets: LabelTarget[] = []
      for (const f of features) {
        const coords = (f.geometry as { coordinates: [number, number] }).coordinates
        const dedupeKey = `${coords[0]},${coords[1]}|${f.properties?.name}`
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)
        const feature = toFeature(f)
        const rule = classify(feature.properties)
        targets.push({
          id: dedupeKey,
          lngLat: coords,
          text: feature.properties.name ?? '',
          color: rule.color,
          opacity: hasGradientOpacity && dynamicOpacityEnabled ? rule.opacity ?? 1 : 1,
          feature,
        })
      }
      return targets
    },
  }
}
