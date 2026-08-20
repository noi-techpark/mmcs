package netex

// FindJourney resolves a live vehicle to the specific scheduled trip it's
// running: the Departure among lineID's routes whose TrainNumber matches
// vehicleRef, together with that route's stop list/geometry and enough
// Line context for a detail view. This is the matching /api/journey does,
// factored out so the frontend doesn't have to fetch the whole Line and
// do it client-side.
func (s *Store) FindJourney(lineID, vehicleRef string) (Journey, bool) {
	line, ok := s.Line(lineID)
	if !ok || vehicleRef == "" {
		return Journey{}, false
	}

	var bestRoute *Route
	var bestDeparture *Departure
	for i := range line.Routes {
		route := &line.Routes[i]
		for j := range route.Timetable {
			dep := &route.Timetable[j]
			if dep.TrainNumber != vehicleRef {
				continue
			}
			// NeTEx sometimes models one physical run as multiple
			// ServiceJourneys sharing the same train number and departure
			// time (e.g. a short-turn variant alongside the full one, at
			// different export versions — see parse.go's route grouping
			// comment) — each lands in its own Route since they have
			// different endpoints. Prefer the longest itinerary rather
			// than whichever comes first, so callers always get the
			// train's full route rather than an arbitrary truncated leg.
			if bestRoute == nil || len(route.Stops) > len(bestRoute.Stops) {
				bestRoute, bestDeparture = route, dep
			}
		}
	}
	if bestRoute == nil {
		return Journey{}, false
	}

	return Journey{
		LineID:        line.ID,
		LineName:      line.Name,
		ShortName:     line.ShortName,
		PublicCode:    line.PublicCode,
		TransportMode: line.TransportMode,
		DirectionRef:  bestRoute.DirectionRef,
		Stops:         bestRoute.Stops,
		Geometry:      bestRoute.Geometry,
		Departure:     *bestDeparture,
	}, true
}
