import { create } from 'zustand'
import type { Feature, Layer, ServerMessage } from '../types/feature'

interface FeatureState {
  layers: Record<Layer, Map<string, Feature>>
  connected: boolean
  connect: () => void
}

const emptyLayers = (): Record<Layer, Map<string, Feature>> => ({
  parking: new Map(),
  e_charging: new Map(),
  train_vehicle: new Map(),
  bus_vehicle: new Map(),
  bus_alert: new Map(),
  on_demand_vehicle: new Map(),
  flight: new Map(),
  weather_station: new Map(),
  traffic_station: new Map(),
})

export const useFeatureStore = create<FeatureState>((set, get) => ({
  layers: emptyLayers(),
  connected: false,
  connect: () => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`)

    ws.onopen = () => set({ connected: true })
    ws.onclose = () => {
      set({ connected: false })
      setTimeout(() => get().connect(), 2000)
    }
    ws.onerror = () => ws.close()

    // Buses alone push hundreds of upserts per poll cycle. Applying each
    // WS message as its own set() call — as this used to do — meant one
    // React re-render (and, downstream, one MapView label-recompute pass,
    // itself a setState) per message: during a burst that's enough nested
    // synchronous updates to blow past React's "Maximum update depth"
    // limit, which is what actually made the app lock up, not just be
    // slow. Buffering messages and applying the whole batch in a single
    // set() per animation frame caps re-renders at ~60/s regardless of
    // how many messages arrive in between.
    let pending: ServerMessage[] = []
    let flushScheduled = false
    const flush = () => {
      flushScheduled = false
      const batch = pending
      pending = []
      set((state) => {
        const layers = { ...state.layers }
        // Track which layers this batch has already cloned, so N diffs
        // against the same layer within one batch mutate one clone
        // in place instead of re-cloning per message.
        const cloned = new Set<Layer>()
        for (const msg of batch) {
          if (msg.type === 'snapshot') {
            const m = new Map<string, Feature>()
            for (const f of msg.data.features) m.set(f.id, f)
            layers[msg.layer] = m
            cloned.add(msg.layer)
          } else {
            const layer = msg.data.layer
            if (!cloned.has(layer)) {
              layers[layer] = new Map(layers[layer])
              cloned.add(layer)
            }
            if (msg.data.action === 'upsert') {
              layers[layer].set(msg.data.feature.id, msg.data.feature)
            } else {
              layers[layer].delete(msg.data.feature.id)
            }
          }
        }
        return { layers }
      })
    }

    ws.onmessage = (ev) => {
      pending.push(JSON.parse(ev.data))
      if (!flushScheduled) {
        flushScheduled = true
        requestAnimationFrame(flush)
      }
    }
  },
}))
