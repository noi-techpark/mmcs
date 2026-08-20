// Package netex fetches and parses the province's NeTEx static schedule
// export (lines, routes, stops, timetables) from STA's FTP server. Unlike
// the realtime feeds, this is reference data: fetched at most once a week
// (see store.go), held in an in-memory Store, and looked up on demand by
// line id — currently only from the frontend's train detail view.
package netex

// Stop is a resolved ScheduledStopPoint: a name and coordinates.
type Stop struct {
	ID   string  `json:"id"`
	Name string  `json:"name"`
	Lon  float64 `json:"lon"`
	Lat  float64 `json:"lat"`
}

// PassingTime is one stop's scheduled arrival/departure within a Departure.
type PassingTime struct {
	StopID    string `json:"stopId"`
	StopName  string `json:"stopName"`
	Arrival   string `json:"arrival,omitempty"`
	Departure string `json:"departure,omitempty"`
}

// Departure is one scheduled trip (ServiceJourney) along a Route. DayTypes
// are the raw NeTEx day-type codes (e.g. "w-6", "saso") — we don't resolve
// them to actual calendar dates the way gtfs.go does for flights; a
// human-readable schedule code is enough for a reference timetable.
type Departure struct {
	ServiceJourneyID string        `json:"serviceJourneyId"`
	TrainNumber      string        `json:"trainNumber,omitempty"`
	DepartureTime    string        `json:"departureTime"`
	DayTypes         []string      `json:"dayTypes"`
	Stops            []PassingTime `json:"stops"`
}

// Route is one directional variant of a Line: its ordered stop sequence
// plus its timetable. Geometry is the actual road/rail-following polyline
// for the whole route — each consecutive stop pair's NeTEx ServiceLink
// where the export has one, else a straight line between them (see
// buildGeometry in parse.go) — as opposed to Stops, which is just the
// ordered stop sequence with no path detail between them.
type Route struct {
	ID           string       `json:"id"`
	DirectionRef string       `json:"directionRef,omitempty"`
	Stops        []Stop       `json:"stops"`
	Geometry     [][2]float64 `json:"geometry"`
	Timetable    []Departure  `json:"timetable"`
}

// Line is the top-level entity looked up by id (SIRI's LineRef).
type Line struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	ShortName     string  `json:"shortName,omitempty"`
	PublicCode    string  `json:"publicCode,omitempty"`
	TransportMode string  `json:"transportMode"`
	Routes        []Route `json:"routes"`
}

// Journey is a single scheduled trip resolved end-to-end: the specific
// Departure a live vehicle is running, together with its route's stop
// list/geometry and enough Line context for a detail view. This is what
// /api/journey returns, so the frontend can request a live vehicle's
// route and timetable directly instead of fetching the whole Line and
// matching the vehicle to a Departure itself.
type Journey struct {
	LineID        string       `json:"lineId"`
	LineName      string       `json:"lineName"`
	ShortName     string       `json:"shortName,omitempty"`
	PublicCode    string       `json:"publicCode,omitempty"`
	TransportMode string       `json:"transportMode"`
	DirectionRef  string       `json:"directionRef,omitempty"`
	Stops         []Stop       `json:"stops"`
	Geometry      [][2]float64 `json:"geometry"`
	Departure     Departure    `json:"departure"`
}
