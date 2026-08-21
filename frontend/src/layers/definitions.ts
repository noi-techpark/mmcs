import { parkingLayer } from './parking'
import { eChargingLayer } from './eCharging'
import { trainsLayer } from './trains'
import { busLayer } from './bus'
import { situationsLayer } from './situations'
import { flightsLayer } from './flights'
import { weatherLayer } from './weather'
import { trafficLayer } from './traffic'
import type { LayerDefinition } from './types'

// The registry MapView and Sidebar iterate. Each layer is instantiated and
// configured in its own file (parking.ts, eCharging.ts, trains.ts,
// flights.ts) — add a layer by creating a new file alongside these and
// listing it here, not by touching MapView/Sidebar internals.
//
// Array order is also the default z-order / sidebar order (first = top of
// both the list and the map stack) — the user can drag to change it at
// runtime (see App.tsx layerOrder state), this is just the starting point.
export const LAYER_DEFINITIONS: LayerDefinition[] = [
  situationsLayer,
  trainsLayer,
  flightsLayer,
  busLayer,
  parkingLayer,
  eChargingLayer,
  weatherLayer,
  trafficLayer,
]
