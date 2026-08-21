import { useEffect, useState } from 'react'
import { MapView } from './map/MapView'
import { Sidebar } from './components/Sidebar'
import { DetailPanel } from './components/DetailPanel'
import { LAYER_DEFINITIONS } from './layers/definitions'
import type { LayerOptions } from './layers/types'
import type { Feature, Layer } from './types/feature'
import type { Journey, EstimatedTimetable } from './types/line'

function App() {
  // All layers start unchecked — each individual layer's own defaultVisible
  // (see layers/types.ts) is overridden here rather than edited per layer.
  const [visibleLayers, setVisibleLayers] = useState<Set<Layer>>(new Set())
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
  const [estimatedTimetable, setEstimatedTimetable] = useState<EstimatedTimetable | null>(null)
  const [etLoading, setEtLoading] = useState(false)

  // The specific scheduled trip a selected train/bus is running — fetched
  // on demand (not pushed like Feature data) — only when a vehicle with a
  // lineId is selected. Held here, not in DetailPanel, so MapView can also
  // draw the route without a second fetch. The backend does the
  // vehicle-to-Departure matching (see /api/journey); this just requests
  // the result for the currently selected vehicle.
  useEffect(() => {
    const isVehicle = selectedFeature?.properties.layer === 'train_vehicle' || selectedFeature?.properties.layer === 'bus_vehicle'
    const lineId = isVehicle ? selectedFeature?.properties.ref?.lineId : undefined
    const vehicleRef = selectedFeature?.properties.data.vehicleRef
    if (!lineId || typeof vehicleRef !== 'string' || !vehicleRef) {
      setJourney(null)
      setJourneyLoading(false)
      return
    }
    // Some bus operators need this to match a live vehicle to its
    // scheduled trip at all — see netex.FindJourney; harmless to send for
    // trains, which match on vehicleRef alone.
    const journeyRef = selectedFeature?.properties.data.datedVehicleJourneyRef
    const journeyRefParam = typeof journeyRef === 'string' && journeyRef ? `&journeyRef=${encodeURIComponent(journeyRef)}` : ''
    let cancelled = false
    setJourneyLoading(true)
    fetch(`/api/journey?lineId=${encodeURIComponent(lineId)}&vehicleRef=${encodeURIComponent(vehicleRef)}${journeyRefParam}`)
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

  // SIRI-ET's real-time ETA schedule for a selected bus — shown as its own
  // section in the detail view, not merged with the NeTEx-derived journey
  // above (see types/line.ts EstimatedTimetable doc comment).
  useEffect(() => {
    const journeyRef =
      selectedFeature?.properties.layer === 'bus_vehicle' ? selectedFeature.properties.data.datedVehicleJourneyRef : undefined
    if (typeof journeyRef !== 'string' || !journeyRef) {
      setEstimatedTimetable(null)
      setEtLoading(false)
      return
    }
    let cancelled = false
    setEtLoading(true)
    fetch(`/api/estimated-timetable?journeyRef=${encodeURIComponent(journeyRef)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) {
          setEstimatedTimetable(data)
          setEtLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEstimatedTimetable(null)
          setEtLoading(false)
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
            estimatedTimetable={estimatedTimetable}
            etLoading={etLoading}
            onClose={() => setSelectedFeature(null)}
          />
        )}
      </div>
    </div>
  )
}

export default App
