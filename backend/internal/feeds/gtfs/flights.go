package gtfs

import (
	"fmt"
	"sort"
	"time"

	"github.com/noi-techpark/open-mmc/backend/internal/model"
)

type flightEvent struct {
	flightNumber string
	direction    string // "departure" | "arrival"
	otherCode    string
	otherName    string
	scheduled    time.Time
}

// FetchAirportFeature downloads the GTFS feed at url and builds a single
// Feature for airportCode aggregating every scheduled flight (departure or
// arrival) touching it over the next `days` days.
func FetchAirportFeature(c *Client, url, airportCode, airportName string, lon, lat float64, days int) (model.Feature, error) {
	f, err := c.fetch(url)
	if err != nil {
		return model.Feature{}, err
	}

	loc, err := time.LoadLocation("Europe/Rome")
	if err != nil {
		loc = time.UTC
	}
	now := time.Now().In(loc)
	rangeStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, loc)
	rangeEnd := rangeStart.AddDate(0, 0, days)

	var events []flightEvent

	for tripID, t := range f.trips {
		stops := f.stopTimes[tripID]
		if len(stops) < 2 {
			continue
		}
		sort.Slice(stops, func(i, j int) bool { return stops[i].sequence < stops[j].sequence })
		origin := stops[0]
		dest := stops[len(stops)-1]

		var direction, otherCode, timeStr string
		switch airportCode {
		case origin.stopID:
			direction, otherCode, timeStr = "departure", dest.stopID, origin.departure
		case dest.stopID:
			direction, otherCode, timeStr = "arrival", origin.stopID, dest.arrival
		default:
			continue
		}

		cal, ok := f.calendar[t.serviceID]
		if !ok {
			continue
		}
		clock, ok := parseClock(timeStr)
		if !ok {
			continue
		}

		start := cal.start
		if start.Before(rangeStart) {
			start = rangeStart
		}
		for d := start; !d.After(cal.end) && d.Before(rangeEnd); d = d.AddDate(0, 0, 1) {
			if !cal.weekday[int(d.Weekday()+6)%7] { // time.Weekday: Sun=0 -> want Mon=0
				continue
			}
			scheduled := time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, loc).Add(clock)
			if scheduled.Before(rangeStart) || !scheduled.Before(rangeEnd) {
				continue
			}
			events = append(events, flightEvent{
				flightNumber: t.routeID,
				direction:    direction,
				otherCode:    otherCode,
				otherName:    f.stopNames[otherCode],
				scheduled:    scheduled,
			})
		}
	}

	sort.Slice(events, func(i, j int) bool { return events[i].scheduled.Before(events[j].scheduled) })

	flights := make([]map[string]any, 0, len(events))
	for _, e := range events {
		flights = append(flights, map[string]any{
			"flightNumber": e.flightNumber,
			"direction":    e.direction,
			"airportCode":  e.otherCode,
			"airportName":  e.otherName,
			"time":         e.scheduled.Format(time.RFC3339),
		})
	}

	feature := model.NewFeature(
		fmt.Sprintf("gtfs:airport:%s", airportCode),
		model.LayerFlight,
		model.Point(lon, lat),
		airportName,
		"gtfs:skyalps",
		map[string]any{
			"airportCode": airportCode,
			"flights":     flights,
		},
	)
	feature.Properties.Status = model.StatusOK
	feature.Properties.RecordedAt = time.Now().UTC()
	return feature, nil
}

// parseClock parses a GTFS "HH:MM:SS" time-of-day (hours may exceed 24 for
// post-midnight service) into a duration since midnight.
func parseClock(s string) (time.Duration, bool) {
	var h, m, sec int
	if _, err := fmt.Sscanf(s, "%d:%d:%d", &h, &m, &sec); err != nil {
		return 0, false
	}
	return time.Duration(h)*time.Hour + time.Duration(m)*time.Minute + time.Duration(sec)*time.Second, true
}
