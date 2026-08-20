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
// (timetable) detail is kept for rail and bus — the two modes the frontend
// visualizes; Lines/Routes/Stops are resolved for every mode regardless.
func Parse(r io.Reader, now time.Time) (Data, error) {
	stops := make(map[string]Stop)
	// Quay coordinates, keyed by the id NeTEx wraps them in
	// (it:apb:Quay:<id>) with that wrapper trimmed off — this is the same
	// id scheme SIRI-SX's StopPointRef uses, so this map is how a
	// situation's affected stop gets a map position.
	quays := make(map[string]Stop)
	lineVersions := make(map[string][]xmlLine)
	routesByID := make(map[string]xmlRoute)
	patternsByID := make(map[string]xmlServiceJourneyPattern)
	// Keyed "fromStopID|toStopID", the ordered [lon,lat] points of that
	// stop-pair's real road/rail-following path — see buildGeometry. The
	// export carries a handful of duplicate stop-pairs (same versioning
	// churn as elsewhere in this feed); first one wins, since alternate
	// versions of the same physical link are geometrically near-identical.
	serviceLinks := make(map[string][][2]float64)
	var journeys []xmlServiceJourney

	dec := xml.NewDecoder(r)
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return Data{}, err
		}
		se, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		switch se.Name.Local {
		case "ScheduledStopPoint":
			var s xmlStopPoint
			if err := dec.DecodeElement(&s, &se); err != nil {
				return Data{}, err
			}
			stops[s.ID] = Stop{ID: s.ID, Name: s.Name, Lon: s.Location.Longitude, Lat: s.Location.Latitude}
		case "Quay":
			var q xmlQuay
			if err := dec.DecodeElement(&q, &se); err != nil {
				return Data{}, err
			}
			id := normalizeQuayID(q.ID)
			quays[id] = Stop{ID: id, Name: q.Name, Lon: q.Centroid.Location.Longitude, Lat: q.Centroid.Location.Latitude}
		case "Line":
			var l xmlLine
			if err := dec.DecodeElement(&l, &se); err != nil {
				return Data{}, err
			}
			lineVersions[l.ID] = append(lineVersions[l.ID], l)
		case "Route":
			var rt xmlRoute
			if err := dec.DecodeElement(&rt, &se); err != nil {
				return Data{}, err
			}
			routesByID[rt.ID] = rt
		case "ServiceLink":
			var sl xmlServiceLink
			if err := dec.DecodeElement(&sl, &se); err != nil {
				return Data{}, err
			}
			key := sl.FromPointRef.Ref + "|" + sl.ToPointRef.Ref
			if _, exists := serviceLinks[key]; !exists {
				serviceLinks[key] = parsePosList(sl.LineString.PosList)
			}
		case "ServiceJourneyPattern":
			var p xmlServiceJourneyPattern
			if err := dec.DecodeElement(&p, &se); err != nil {
				return Data{}, err
			}
			patternsByID[p.ID] = p
		case "ServiceJourney":
			var sj xmlServiceJourney
			if err := dec.DecodeElement(&sj, &se); err != nil {
				return Data{}, err
			}
			if sj.TransportMode == "rail" || sj.TransportMode == "bus" {
				journeys = append(journeys, sj)
			}
		}
	}

	return Data{Lines: resolve(now, stops, quays, lineVersions, routesByID, patternsByID, journeys, serviceLinks), Quays: quays}, nil
}

func resolve(
	now time.Time,
	stops map[string]Stop,
	quays map[string]Stop,
	lineVersions map[string][]xmlLine,
	routesByID map[string]xmlRoute,
	patternsByID map[string]xmlServiceJourneyPattern,
	journeys []xmlServiceJourney,
	serviceLinks map[string][][2]float64,
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

	// Timetables: for each rail/bus ServiceJourney, resolve its pattern's
	// position->stop map, turn passingTimes into an ordered Departure, and
	// attach it to the matching Route (by the pattern's RouteRef).
	departuresByRoute := make(map[string][]Departure)
	for _, sj := range journeys {
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
		g.route.Geometry = buildGeometry(g.route.Stops, serviceLinks)
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

// buildGeometry walks a route's ordered stops and, for each consecutive
// pair, appends its real NeTEx ServiceLink polyline (looked up in either
// direction, since a link is only stored once per physical pair but a
// route can traverse it either way) — falling back to a straight line
// straight to the next stop where the export has no link for that pair.
// Concatenated, this gives the route's actual road/rail-following shape
// rather than a straight-line approximation between stops.
func buildGeometry(stops []Stop, links map[string][][2]float64) [][2]float64 {
	if len(stops) == 0 {
		return nil
	}
	geometry := [][2]float64{{stops[0].Lon, stops[0].Lat}}
	for i := 0; i+1 < len(stops); i++ {
		a, b := stops[i], stops[i+1]
		switch {
		case links[a.ID+"|"+b.ID] != nil:
			geometry = append(geometry, links[a.ID+"|"+b.ID]...)
		case links[b.ID+"|"+a.ID] != nil:
			seg := links[b.ID+"|"+a.ID]
			for j := len(seg) - 1; j >= 0; j-- {
				geometry = append(geometry, seg[j])
			}
		default:
			geometry = append(geometry, [2]float64{b.Lon, b.Lat})
		}
	}
	return geometry
}

// normalizeQuayID strips the "it:apb:Quay:" wrapper NeTEx puts around the
// source system's original stop id and trims the trailing colon every id in
// this export carries — matching SIRI-SX's StopPointRef scheme
// ("it:22021:2189:0:5133"). Two more quirks in the live export: the wrapper
// is sometimes applied twice ("it:apb:Quay:it:apb:Quay:<id>::"), so the
// prefix/suffix are stripped in a loop rather than once; and the wrapped id
// itself is inconsistently encoded — some use colons throughout like the
// target scheme already ("it:22021:1853:0:"), others join every field with
// dashes instead ("it-22021-2189-0-5133:") — converting dashes to colons
// normalizes both to the same shape.
func normalizeQuayID(id string) string {
	for {
		trimmed := strings.TrimSuffix(strings.TrimPrefix(id, "it:apb:Quay:"), ":")
		if trimmed == id {
			break
		}
		id = trimmed
	}
	return strings.ReplaceAll(id, "-", ":")
}

// parsePosList reads a GML posList's whitespace-separated "lon lat lon
// lat ..." coordinate string.
func parsePosList(s string) [][2]float64 {
	fields := strings.Fields(s)
	coords := make([][2]float64, 0, len(fields)/2)
	for i := 0; i+1 < len(fields); i += 2 {
		lon, err1 := strconv.ParseFloat(fields[i], 64)
		lat, err2 := strconv.ParseFloat(fields[i+1], 64)
		if err1 != nil || err2 != nil {
			continue
		}
		coords = append(coords, [2]float64{lon, lat})
	}
	return coords
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
