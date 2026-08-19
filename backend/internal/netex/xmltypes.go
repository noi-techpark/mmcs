package netex

// xml* types mirror only the NeTEx elements this package reads — the real
// schema has vastly more (fares, accessibility, notices, ...), all
// silently skipped by the streaming decoder in parse.go.

type xmlRef struct {
	Ref string `xml:"ref,attr"`
}

type xmlStopPoint struct {
	ID       string `xml:"id,attr"`
	Name     string `xml:"Name"`
	Location struct {
		Longitude float64 `xml:"Longitude"`
		Latitude  float64 `xml:"Latitude"`
	} `xml:"Location"`
}

type xmlLine struct {
	ID            string `xml:"id,attr"`
	Version       string `xml:"version,attr"`
	Name          string `xml:"Name"`
	ShortName     string `xml:"ShortName"`
	PublicCode    string `xml:"PublicCode"`
	TransportMode string `xml:"TransportMode"`
	ValidBetween  struct {
		FromDate string `xml:"FromDate"`
		ToDate   string `xml:"ToDate"`
	} `xml:"ValidBetween"`
}

type xmlPointOnRoute struct {
	Order         int    `xml:"order,attr"`
	RoutePointRef xmlRef `xml:"RoutePointRef"`
}

type xmlRoute struct {
	ID               string `xml:"id,attr"`
	LineRef          xmlRef `xml:"LineRef"`
	DirectionRef     xmlRef `xml:"DirectionRef"`
	PointsInSequence struct {
		Points []xmlPointOnRoute `xml:"PointOnRoute"`
	} `xml:"pointsInSequence"`
}

type xmlStopPointInJP struct {
	ID                    string `xml:"id,attr"`
	Order                 int    `xml:"order,attr"`
	ScheduledStopPointRef xmlRef `xml:"ScheduledStopPointRef"`
}

type xmlServiceJourneyPattern struct {
	ID               string `xml:"id,attr"`
	RouteRef         xmlRef `xml:"RouteRef"`
	PointsInSequence struct {
		Points []xmlStopPointInJP `xml:"StopPointInJourneyPattern"`
	} `xml:"pointsInSequence"`
}

type xmlTimetabledPassingTime struct {
	StopPointInJourneyPatternRef xmlRef `xml:"StopPointInJourneyPatternRef"`
	ArrivalTime                  string `xml:"ArrivalTime"`
	DepartureTime                string `xml:"DepartureTime"`
}

type xmlServiceJourney struct {
	ID            string `xml:"id,attr"`
	TransportMode string `xml:"TransportMode"`
	DepartureTime string `xml:"DepartureTime"`
	DayTypes      struct {
		Refs []xmlRef `xml:"DayTypeRef"`
	} `xml:"dayTypes"`
	ServiceJourneyPatternRef xmlRef `xml:"ServiceJourneyPatternRef"`
	TrainNumbers             struct {
		Refs []xmlRef `xml:"TrainNumberRef"`
	} `xml:"trainNumbers"`
	PassingTimes struct {
		Times []xmlTimetabledPassingTime `xml:"TimetabledPassingTime"`
	} `xml:"passingTimes"`
}
