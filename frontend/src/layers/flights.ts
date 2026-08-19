import { createPointLayer } from './pointLayer'

// A single feature (Bolzano Airport) carrying the next 7 days of
// scheduled flights in its Data — see backend/internal/feeds/gtfs.
// Clustering/labels are irrelevant with one point, but reusing the point
// layer factory costs nothing and keeps this file this simple.
export const flightsLayer = createPointLayer('flight', 'Flights')
