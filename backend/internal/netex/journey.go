package netex

import (
	"strconv"
	"strings"
	"time"
)

// FindJourney resolves a live vehicle to the specific scheduled trip it's
// running, together with that route's stop list/geometry and enough Line
// context for a detail view. This is the matching /api/journey does,
// factored out so the frontend doesn't have to fetch the whole Line and
// do it client-side.
//
// Matching is mode-dependent because NeTEx doesn't give rail and bus the
// same identifiers to match against:
//   - Rail: vehicleRef (SIRI's VehicleRef) equals the Departure's
//     TrainNumber directly.
//   - Bus: NeTEx ServiceJourneys have no TrainNumberRef at all (that's a
//     rail-only element), so vehicleRef can never match TrainNumber. Some
//     bus operators (BGP, PIZ, KSM at least) instead embed the NeTEx
//     ServiceJourney id as a suffix of SIRI's DatedVehicleJourneyRef
//     (journeyRef here) — when present, that's matched exactly. Other
//     operators (SASA, SIMOB, RAI at least) embed nothing usable at all,
//     so as a last resort the departure across the line's routes whose
//     scheduled time is closest to now is used — an approximation, not an
//     exact match, but better than showing no route/timetable at all.
func (s *Store) FindJourney(lineID, vehicleRef, journeyRef string, now time.Time) (Journey, bool) {
	line, ok := s.Line(lineID)
	if !ok {
		return Journey{}, false
	}

	netexRef := extractServiceJourneyRef(journeyRef)

	var bestRoute *Route
	var bestDeparture *Departure
	for i := range line.Routes {
		route := &line.Routes[i]
		for j := range route.Timetable {
			dep := &route.Timetable[j]
			matched := (vehicleRef != "" && dep.TrainNumber == vehicleRef) ||
				(netexRef != "" && dep.ServiceJourneyID == netexRef)
			if !matched {
				continue
			}
			// NeTEx sometimes models one physical run as multiple
			// ServiceJourneys sharing the same train number and departure
			// time (e.g. a short-turn variant alongside the full one, at
			// different export versions — see parse.go's route grouping
			// comment) — each lands in its own Route since they have
			// different endpoints. Prefer the longest itinerary rather
			// than whichever comes first, so callers always get the
			// vehicle's full route rather than an arbitrary truncated leg.
			if bestRoute == nil || len(route.Stops) > len(bestRoute.Stops) {
				bestRoute, bestDeparture = route, dep
			}
		}
	}

	if bestRoute == nil && line.TransportMode == "bus" {
		bestRoute, bestDeparture = nearestDeparture(line, now)
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

// extractServiceJourneyRef pulls the embedded NeTEx ServiceJourney id back
// out of a SIRI DatedVehicleJourneyRef like
// "200826_BGP_450_1490778427.._it:apb:ServiceJourney:89450-KronplM-51-4-32040:14097"
// — present for some bus operators, absent (empty suffix) for others.
func extractServiceJourneyRef(datedVehicleJourneyRef string) string {
	const marker = "it:apb:ServiceJourney:"
	idx := strings.Index(datedVehicleJourneyRef, marker)
	if idx == -1 {
		return ""
	}
	return datedVehicleJourneyRef[idx:]
}

// nearestDeparture picks, across every route on line, the Departure whose
// scheduled time of day is closest to now — the fallback used when no id
// match is available at all.
func nearestDeparture(line Line, now time.Time) (*Route, *Departure) {
	nowSeconds := now.Hour()*3600 + now.Minute()*60 + now.Second()

	var bestRoute *Route
	var bestDeparture *Departure
	bestDiff := -1
	for i := range line.Routes {
		route := &line.Routes[i]
		for j := range route.Timetable {
			dep := &route.Timetable[j]
			secs, ok := parseHMS(dep.DepartureTime)
			if !ok {
				continue
			}
			diff := secs - nowSeconds
			if diff < 0 {
				diff = -diff
			}
			if bestDiff == -1 || diff < bestDiff {
				bestDiff, bestRoute, bestDeparture = diff, route, dep
			}
		}
	}
	return bestRoute, bestDeparture
}

// parseHMS parses a NeTEx "HH:MM:SS" time-of-day into seconds since midnight.
func parseHMS(s string) (int, bool) {
	parts := strings.Split(s, ":")
	if len(parts) != 3 {
		return 0, false
	}
	h, err1 := strconv.Atoi(parts[0])
	m, err2 := strconv.Atoi(parts[1])
	sec, err3 := strconv.Atoi(parts[2])
	if err1 != nil || err2 != nil || err3 != nil {
		return 0, false
	}
	return h*3600 + m*60 + sec, true
}
