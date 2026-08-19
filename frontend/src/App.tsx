import { useEffect, useMemo, useState } from 'react'
import { MapView } from './map/MapView'
import { Sidebar } from './components/Sidebar'
import { DetailPanel } from './components/DetailPanel'
import { LAYER_DEFINITIONS } from './layers/definitions'
import { findJourney } from './util/journey'
import type { LayerOptions } from './layers/types'
import type { Feature, Layer } from './types/feature'
import type { LineDetail } from './types/line'

function App() {
  const [visibleLayers, setVisibleLayers] = useState<Set<Layer>>(
    new Set(LAYER_DEFINITIONS.filter((d) => d.defaultVisible !== false).map((d) => d.id)),
  )
  const [layerOptions, setLayerOptions] = useState<Record<Layer, LayerOptions>>(
    () => Object.fromEntries(LAYER_DEFINITIONS.map((d) => [d.id, d.defaultOptions])) as Record<Layer, LayerOptions>,
  )
  // Sidebar order and map z-order, kept as one list: first = top of both
  // the sidebar and the map's rendering stack. Defaults to registry order
  // (LAYER_DEFINITIONS); dragging a card in the sidebar reorders this.
  const [layerOrder, setLayerOrder] = useState<Layer[]>(LAYER_DEFINITIONS.map((d) => d.id))
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null)
  const [lineDetail, setLineDetail] = useState<LineDetail | null>(null)

  // NeTEx line/route/timetable reference detail is fetched on demand
  // (not pushed like Feature data) — only when a train with a lineId is
  // selected. Held here, not in DetailPanel, so MapView can also draw the
  // route polygon without a second fetch.
  useEffect(() => {
    const lineId = selectedFeature?.properties.layer === 'train_vehicle' ? selectedFeature.properties.ref?.lineId : undefined
    if (!lineId) {
      setLineDetail(null)
      return
    }
    let cancelled = false
    fetch(`/api/lines/${encodeURIComponent(lineId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setLineDetail(data)
      })
      .catch(() => {
        if (!cancelled) setLineDetail(null)
      })
    return () => {
      cancelled = true
    }
  }, [selectedFeature])

  const journey = useMemo(
    () => findJourney(lineDetail, selectedFeature?.properties.data.vehicleRef),
    [lineDetail, selectedFeature],
  )

  const toggle = (layer: Layer) => {
    setVisibleLayers((prev) => {
      const next = new Set(prev)
      if (next.has(layer)) next.delete(layer)
      else next.add(layer)
      return next
    })
  }

  const updateOptions = (layer: Layer, options: LayerOptions) => {
    setLayerOptions((prev) => ({ ...prev, [layer]: options }))
  }

  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
      <Sidebar
        visibleLayers={visibleLayers}
        onToggle={toggle}
        layerOptions={layerOptions}
        onOptionsChange={updateOptions}
        layerOrder={layerOrder}
        onReorder={setLayerOrder}
      />
      <div style={{ position: 'relative', flex: 1 }}>
        <MapView
          visibleLayers={visibleLayers}
          layerOptions={layerOptions}
          layerOrder={layerOrder}
          onFeatureSelect={setSelectedFeature}
          selectedRoute={journey?.route ?? null}
        />
        {selectedFeature && (
          <DetailPanel
            feature={selectedFeature}
            lineDetail={lineDetail}
            journey={journey}
            onClose={() => setSelectedFeature(null)}
          />
        )}
      </div>
    </div>
  )
}

export default App
