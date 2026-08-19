package netex

import (
	"encoding/xml"
	"io"
	"sort"
	"strconv"
	"strings"
	"time"
)

// Parse streams r (the uncompressed NeTEx XML) token by token, retaining
// only the handful of element types this package needs, then resolves the
// Line/Route/Stop/Timetable relationships in memory. Full ServiceJourney
// (timetable) detail is only kept for rail — the feed covers the whole
// province's bus network too (~56k service journeys vs. ~4k rail), and
// nothing outside the train layer needs it yet; Lines/Routes/Stops are
// still resolved for every mode, so a future bus layer has them ready.
func Parse(r io.Reader, now time.Time) (map[string]Line, error) {
	stops := make(map[string]Stop)
	lineVersions := make(map[string][]xmlLine)
	routesByID := make(map[string]xmlRoute)
	patternsByID := make(map[string]xmlServiceJourneyPattern)
	var railJourneys []xmlServiceJourney

	dec := xml.NewDecoder(r)
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		se, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		switch se.Name.Local {
		case "ScheduledStopPoint":
			var s xmlStopPoint
			if err := dec.DecodeElement(&s, &se); err != nil {
				return nil, err
			}
			stops[s.ID] = Stop{ID: s.ID, Name: s.Name, Lon: s.Location.Longitude, Lat: s.Location.Latitude}
		case "Line":
			var l xmlLine
			if err := dec.DecodeElement(&l, &se); err != nil {
				return nil, err
			}
			lineVersions[l.ID] = append(lineVersions[l.ID], l)
		case "Route":
			var rt xmlRoute
			if err := dec.DecodeElement(&rt, &se); err != nil {
				return nil, err
			}
			routesByID[rt.ID] = rt
		case "ServiceJourneyPattern":
			var p xmlServiceJourneyPattern
			if err := dec.DecodeElement(&p, &se); err != nil {
				return nil, err
			}
			patternsByID[p.ID] = p
		case "ServiceJourney":
			var sj xmlServiceJourney
			if err := dec.DecodeElement(&sj, &se); err != nil {
				return nil, err
			}
			if sj.TransportMode == "rail" {
				railJourneys = append(railJourneys, sj)
			}
		}
	}

	return resolve(now, stops, lineVersions, routesByID, patternsByID, railJourneys), nil
}

func resolve(
	now time.Time,
	stops map[string]Stop,
	lineVersions map[string][]xmlLine,
	routesByID map[string]xmlRoute,
	patternsByID map[string]xmlServiceJourneyPattern,
	railJourneys []xmlServiceJourney,
) map[string]Line {
	// Pick, per line id, the version whose validity window covers `now`;
	// fall back to the highest version number if none does (e.g. right at
	// a season boundary).
	lines := make(map[string]Line, len(lineVersions))
	for id, versions := range lineVersions {
		best := versions[0]
		bestCovers := coversNow(best, now)
		for _, v := range versions[1:] {
			covers := coversNow(v, now)
			if covers && !bestCovers {
				best, bestCovers = v, true
				continue
			}
			if covers == bestCovers && versionNum(v) > versionNum(best) {
				best = v
			}
		}
		// Keyed without the trailing colon NeTEx ids carry, since that's
		// how SIRI's LineRef (the lookup key callers actually have) reads.
		trimmedID := strings.TrimSuffix(id, ":")
		lines[trimmedID] = Line{
			ID:            trimmedID,
			Name:          best.Name,
			ShortName:     best.ShortName,
			PublicCode:    best.PublicCode,
			TransportMode: best.TransportMode,
		}
	}

	// Routes, grouped onto (line, direction, endpoints) — not just (line,
	// direction). NeTEx here models every minor timing/stopping variant of
	// a direction as its own Route (one line can have 30+ Route ids for
	// what's really "outbound" and "inbound"), which would look broken as
	// 30 near-duplicate sections in a detail view. But a single Line can
	// also legitimately cover several distinct physical branches sharing
	// the same DirectionRef code (e.g. a "REG" line umbrella-ing both the
	// Brenner-line and Valsugana-line services) — grouping those together
	// would merge unrelated stop lists and misattribute departures to the
	// wrong geometry. So the group key also includes the route's first/last
	// stop, which minor timing variants of the same physical route share
	// but genuinely different branches don't. Per group, keep the variant
	// with the most stops as the representative stop list/geometry, and
	// merge every variant's departures into its timetable below.
	type routeGroup struct {
		route      Route
		variantIDs []string
	}
	type groupKey struct {
		lineID, dir, firstStop, lastStop string
	}
	groups := make(map[groupKey]*routeGroup)
	var groupOrder []groupKey
	for _, rt := range routesByID {
		lineID := strings.TrimSuffix(rt.LineRef.Ref, ":")
		dir := rt.DirectionRef.Ref
		sort.Slice(rt.PointsInSequence.Points, func(i, j int) bool {
			return rt.PointsInSequence.Points[i].Order < rt.PointsInSequence.Points[j].Order
		})
		routeStops := make([]Stop, 0, len(rt.PointsInSequence.Points))
		for _, p := range rt.PointsInSequence.Points {
			if s, ok := stops[p.RoutePointRef.Ref]; ok {
				routeStops = append(routeStops, s)
			}
		}
		if len(routeStops) == 0 {
			continue
		}

		key := groupKey{lineID: lineID, dir: dir, firstStop: routeStops[0].ID, lastStop: routeStops[len(routeStops)-1].ID}
		g, ok := groups[key]
		if !ok {
			g = &routeGroup{route: Route{ID: rt.ID, DirectionRef: dir, Stops: routeStops}}
			groups[key] = g
			groupOrder = append(groupOrder, key)
		} else if len(routeStops) > len(g.route.Stops) {
			g.route = Route{ID: rt.ID, DirectionRef: dir, Stops: routeStops}
		}
		g.variantIDs = append(g.variantIDs, rt.ID)
	}

	// Rail timetables: for each rail ServiceJourney, resolve its pattern's
	// position->stop map, turn passingTimes into an ordered Departure, and
	// attach it to the matching Route (by the pattern's RouteRef).
	departuresByRoute := make(map[string][]Departure)
	for _, sj := range railJourneys {
		pattern, ok := patternsByID[sj.ServiceJourneyPatternRef.Ref]
		if !ok {
			continue
		}
		stopByPosition := make(map[string]Stop, len(pattern.PointsInSequence.Points))
		for _, sp := range pattern.PointsInSequence.Points {
			if s, ok := stops[sp.ScheduledStopPointRef.Ref]; ok {
				stopByPosition[sp.ID] = s
			}
		}

		times := make([]xmlTimetabledPassingTime, len(sj.PassingTimes.Times))
		copy(times, sj.PassingTimes.Times)
		orderOf := make(map[string]int, len(pattern.PointsInSequence.Points))
		for _, sp := range pattern.PointsInSequence.Points {
			orderOf[sp.ID] = sp.Order
		}
		sort.Slice(times, func(i, j int) bool {
			return orderOf[times[i].StopPointInJourneyPatternRef.Ref] < orderOf[times[j].StopPointInJourneyPatternRef.Ref]
		})

		passing := make([]PassingTime, 0, len(times))
		for _, t := range times {
			s, ok := stopByPosition[t.StopPointInJourneyPatternRef.Ref]
			if !ok {
				continue
			}
			passing = append(passing, PassingTime{
				StopID: s.ID, StopName: s.Name,
				Arrival: t.ArrivalTime, Departure: t.DepartureTime,
			})
		}

		var trainNumber string
		if len(sj.TrainNumbers.Refs) > 0 {
			trainNumber = refLastSegment(sj.TrainNumbers.Refs[0].Ref)
		}
		dayTypes := make([]string, 0, len(sj.DayTypes.Refs))
		for _, r := range sj.DayTypes.Refs {
			dayTypes = append(dayTypes, refLastSegment(r.Ref))
		}

		dep := Departure{
			ServiceJourneyID: strings.TrimSuffix(sj.ID, ":"),
			TrainNumber:      trainNumber,
			DepartureTime:    sj.DepartureTime,
			DayTypes:         dayTypes,
			Stops:            passing,
		}
		departuresByRoute[pattern.RouteRef.Ref] = append(departuresByRoute[pattern.RouteRef.Ref], dep)
	}
	for routeID, deps := range departuresByRoute {
		sort.Slice(deps, func(i, j int) bool { return deps[i].DepartureTime < deps[j].DepartureTime })
		departuresByRoute[routeID] = deps
	}

	routesByLine := make(map[string][]Route)
	for _, key := range groupOrder {
		g := groups[key]
		if _, ok := lines[key.lineID]; !ok {
			continue
		}
		seen := make(map[string]bool)
		var deps []Departure
		for _, variantID := range g.variantIDs {
			for _, d := range departuresByRoute[variantID] {
				// The export carries a separate ServiceJourney per
				// seasonal validity period for what's logically the
				// same daily trip, so distinct ServiceJourneyIDs can
				// still be duplicates — key on train+time instead.
				dKey := d.TrainNumber + "@" + d.DepartureTime
				if seen[dKey] {
					continue
				}
				seen[dKey] = true
				deps = append(deps, d)
			}
		}
		sort.Slice(deps, func(i, j int) bool { return deps[i].DepartureTime < deps[j].DepartureTime })
		g.route.Timetable = deps
		routesByLine[key.lineID] = append(routesByLine[key.lineID], g.route)
	}
	for lineID, routes := range routesByLine {
		line := lines[lineID]
		sort.Slice(routes, func(i, j int) bool { return routes[i].DirectionRef < routes[j].DirectionRef })
		line.Routes = routes
		lines[lineID] = line
	}

	return lines
}

func coversNow(l xmlLine, now time.Time) bool {
	from, err1 := time.Parse("2006-01-02T15:04:05", l.ValidBetween.FromDate)
	to, err2 := time.Parse("2006-01-02T15:04:05", l.ValidBetween.ToDate)
	if err1 != nil || err2 != nil {
		return false
	}
	return !now.Before(from) && !now.After(to)
}

func versionNum(l xmlLine) int {
	n, _ := strconv.Atoi(l.Version)
	return n
}

// refLastSegment pulls the trailing code out of a colon-delimited NeTEx id
// (e.g. "it:apb:DayType:w-6_6:" -> "w-6_6"), for display purposes.
func refLastSegment(ref string) string {
	parts := strings.Split(strings.TrimSuffix(ref, ":"), ":")
	return parts[len(parts)-1]
}
