import { useEffect, useState } from 'react'
import { MapView } from './map/MapView'
import { Sidebar } from './components/Sidebar'
import { DetailPanel } from './components/DetailPanel'
import { LAYER_DEFINITIONS } from './layers/definitions'
import type { LayerOptions } from './layers/types'
import type { Feature, Layer } from './types/feature'
import type { Journey } from './types/line'

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
  const [journey, setJourney] = useState<Journey | null>(null)
  const [journeyLoading, setJourneyLoading] = useState(false)

  // The specific scheduled trip a selected train is running — fetched on
  // demand (not pushed like Feature data) — only when a train with a
  // lineId is selected. Held here, not in DetailPanel, so MapView can also
  // draw the route without a second fetch. The backend does the
  // vehicle-to-Departure matching (see /api/journey); this just requests
  // the result for the currently selected vehicle.
  useEffect(() => {
    const lineId = selectedFeature?.properties.layer === 'train_vehicle' ? selectedFeature.properties.ref?.lineId : undefined
    const vehicleRef = selectedFeature?.properties.data.vehicleRef
    if (!lineId || typeof vehicleRef !== 'string' || !vehicleRef) {
      setJourney(null)
      setJourneyLoading(false)
      return
    }
    let cancelled = false
    setJourneyLoading(true)
    fetch(`/api/journey?lineId=${encodeURIComponent(lineId)}&vehicleRef=${encodeURIComponent(vehicleRef)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) {
          setJourney(data)
          setJourneyLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setJourney(null)
          setJourneyLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [selectedFeature])

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
          selectedJourney={journey}
        />
        {selectedFeature && (
          <DetailPanel
            feature={selectedFeature}
            journey={journey}
            journeyLoading={journeyLoading}
            onClose={() => setSelectedFeature(null)}
          />
        )}
      </div>
    </div>
  )
}

export default App
