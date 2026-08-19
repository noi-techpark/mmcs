import type { LineDetail, RouteDetail, Departure } from '../types/line'

export interface Journey {
  route: RouteDetail
  departure: Departure
}

/** Finds the scheduled Departure matching a live vehicle's train number — the specific journey this real-time vehicle is running, not just "a" timetable entry for its line. */
export function findJourney(lineDetail: LineDetail | null, vehicleRef: unknown): Journey | null {
  if (!lineDetail || typeof vehicleRef !== 'string' || !vehicleRef) return null
  let best: Journey | null = null
  for (const route of lineDetail.routes) {
    const departure = route.timetable.find((d) => d.trainNumber === vehicleRef)
    // NeTEx sometimes models one physical run as multiple ServiceJourneys
    // sharing the same train number and departure time (e.g. a short-turn
    // variant alongside the full one) — each lands in its own Route group
    // since they have different endpoints. Prefer the longest itinerary
    // rather than whichever happens to come first, so the map always shows
    // the train's full route rather than an arbitrary truncated leg of it.
    if (departure && (!best || route.stops.length > best.route.stops.length)) {
      best = { route, departure }
    }
  }
  return best
}
