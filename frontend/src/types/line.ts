// Mirrors backend/internal/netex/types.go — NeTEx reference data for a
// line, fetched on demand from /api/lines/:id (not pushed over the
// realtime WS like Feature data — this is static schedule reference data).

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

export interface RouteDetail {
  id: string
  directionRef?: string
  stops: Stop[]
  timetable: Departure[]
}

export interface LineDetail {
  id: string
  name: string
  shortName?: string
  publicCode?: string
  transportMode: string
  routes: RouteDetail[]
}
