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
  on_demand_vehicle: new Map(),
  flight: new Map(),
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

    ws.onmessage = (ev) => {
      const msg: ServerMessage = JSON.parse(ev.data)
      set((state) => {
        const layers = { ...state.layers }
        if (msg.type === 'snapshot') {
          const m = new Map<string, Feature>()
          for (const f of msg.data.features) m.set(f.id, f)
          layers[msg.layer] = m
        } else {
          const layer = msg.data.layer
          const m = new Map(layers[layer])
          if (msg.data.action === 'upsert') {
            m.set(msg.data.feature.id, msg.data.feature)
          } else {
            m.delete(msg.data.feature.id)
          }
          layers[layer] = m
        }
        return { layers }
      })
    }
  },
}))
