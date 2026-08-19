import type { LineDetail, RouteDetail, Departure } from '../types/line'

export interface Journey {
  route: RouteDetail
  departure: Departure
}

/** Finds the scheduled Departure matching a live vehicle's train number — the specific journey this real-time vehicle is running, not just "a" timetable entry for its line. */
export function findJourney(lineDetail: LineDetail | null, vehicleRef: unknown): Journey | null {
  if (!lineDetail || typeof vehicleRef !== 'string' || !vehicleRef) return null
  for (const route of lineDetail.routes) {
    const departure = route.timetable.find((d) => d.trainNumber === vehicleRef)
    if (departure) return { route, departure }
  }
  return null
}
