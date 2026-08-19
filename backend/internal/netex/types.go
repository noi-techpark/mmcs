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
// (used both for the stop list and, by connecting consecutive stops'
// coordinates, a simple straight-line route polygon — not the actual
// road/rail-following geometry NeTEx ServiceLinks would give, but a
// reasonable approximation for this scope) plus its timetable.
type Route struct {
	ID           string      `json:"id"`
	DirectionRef string      `json:"directionRef,omitempty"`
	Stops        []Stop      `json:"stops"`
	Timetable    []Departure `json:"timetable"`
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
