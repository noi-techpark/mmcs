// Mirrors backend/internal/netex/types.go's Journey — the specific
// scheduled trip a live vehicle is running, fetched on demand from
// /api/journey (not pushed over the realtime WS like Feature data, since
// it's static NeTEx schedule reference data). The backend does the
// vehicle-to-Departure matching; the frontend just requests the result.

export interface Stop {
  id: string
  name: string
  lon: number
  lat: number
}

export interface PassingTime {
  stopId: string
  stopName: string
  arrival?: string
  departure?: string
}

export interface Departure {
  serviceJourneyId: string
  trainNumber?: string
  departureTime: string
  dayTypes: string[]
  stops: PassingTime[]
}

export interface Journey {
  lineId: string
  lineName: string
  shortName?: string
  publicCode?: string
  transportMode: string
  directionRef?: string
  stops: Stop[]
  /** The route's actual road/rail-following polyline (NeTEx ServiceLinks where available), as [lon, lat] pairs. */
  geometry: [number, number][]
  departure: Departure
}
