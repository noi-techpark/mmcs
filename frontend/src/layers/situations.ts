import { createPointLayer } from './pointLayer'

// SIRI-SX service alerts/disruptions — placed at the first affected stop
// the backend could resolve to a NeTEx Quay coordinate (see
// backend/internal/feeds/siri/sx.go); situations with no resolvable stop
// never reach the frontend at all.
export const situationsLayer = createPointLayer('bus_alert', 'Service Alerts')
