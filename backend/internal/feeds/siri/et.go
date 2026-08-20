package siri

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

// EstimatedCall is one stop's real-time-adjusted timing within an
// EstimatedVehicleJourney.
type EstimatedCall struct {
	StopPointRef          string `json:"StopPointRef"`
	StopPointName         string `json:"StopPointName"`
	DestinationDisplay    string `json:"DestinationDisplay"`
	AimedArrivalTime      string `json:"AimedArrivalTime"`
	ExpectedArrivalTime   string `json:"ExpectedArrivalTime"`
	AimedDepartureTime    string `json:"AimedDepartureTime"`
	ExpectedDepartureTime string `json:"ExpectedDepartureTime"`
}

// EstimatedVehicleJourney is one bus trip's real-time ETA schedule — this
// is deliberately not merged with the NeTEx-derived scheduled timetable
// (Journey); the detail view shows it as its own section.
type EstimatedVehicleJourney struct {
	LineRef                 string `json:"LineRef"`
	DirectionRef            string `json:"DirectionRef"`
	PublishedLineName       string `json:"PublishedLineName"`
	DirectionName           string `json:"DirectionName"`
	OperatorRef             string `json:"OperatorRef"`
	Monitored               string `json:"Monitored"`
	FramedVehicleJourneyRef struct {
		DataFrameRef           string `json:"DataFrameRef"`
		DatedVehicleJourneyRef string `json:"DatedVehicleJourneyRef"`
	} `json:"FramedVehicleJourneyRef"`
	EstimatedCalls struct {
		EstimatedCall []EstimatedCall `json:"EstimatedCall"`
	} `json:"EstimatedCalls"`
}

type etEnvelope struct {
	ServiceDelivery struct {
		EstimatedTimetableDelivery struct {
			EstimatedJourneyVersionFrame []struct {
				EstimatedVehicleJourney []EstimatedVehicleJourney `json:"EstimatedVehicleJourney"`
			} `json:"EstimatedJourneyVersionFrame"`
		} `json:"EstimatedTimetableDelivery"`
	} `json:"ServiceDelivery"`
}

// FetchET fetches the whole province's estimated timetable (~30MB).
func (c *LiteClient) FetchET() ([]EstimatedVehicleJourney, error) {
	u := c.baseURL + "/siri-lite/estimated-timetable"
	resp, err := c.httpClient.Get(u)
	if err != nil {
		return nil, fmt.Errorf("siri-lite: fetch %s: %w", u, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("siri-lite: fetch %s: unexpected status %d", u, resp.StatusCode)
	}

	var env etEnvelope
	if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
		return nil, fmt.Errorf("siri-lite: decode %s: %w", u, err)
	}
	var journeys []EstimatedVehicleJourney
	for _, frame := range env.ServiceDelivery.EstimatedTimetableDelivery.EstimatedJourneyVersionFrame {
		journeys = append(journeys, frame.EstimatedVehicleJourney...)
	}
	return journeys, nil
}

// ETStore holds the most recently fetched estimated timetable, indexed by
// DatedVehicleJourneyRef — the join key a live VM feature already carries
// (see NormalizeLite), so a selected bus's ETA schedule is a single lookup,
// not a matching heuristic. Replaced wholesale on each poll, like netex.Store.
type ETStore struct {
	mu           sync.RWMutex
	byJourneyRef map[string]EstimatedVehicleJourney
}

func NewETStore() *ETStore {
	return &ETStore{byJourneyRef: make(map[string]EstimatedVehicleJourney)}
}

func (s *ETStore) Journey(journeyRef string) (EstimatedVehicleJourney, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	j, ok := s.byJourneyRef[journeyRef]
	return j, ok
}

func (s *ETStore) set(journeys []EstimatedVehicleJourney) {
	byRef := make(map[string]EstimatedVehicleJourney, len(journeys))
	for _, j := range journeys {
		ref := j.FramedVehicleJourneyRef.DatedVehicleJourneyRef
		if ref == "" {
			continue
		}
		byRef[ref] = j
	}
	s.mu.Lock()
	s.byJourneyRef = byRef
	s.mu.Unlock()
}

// PollET refreshes an ETStore on a fixed interval. Not pushed over the
// websocket — the payload covers the whole province and only the detail
// view for a selected bus needs a single journey out of it.
func PollET(ctx context.Context, client *LiteClient, interval time.Duration, s *ETStore) {
	tick := func() {
		journeys, err := client.FetchET()
		if err != nil {
			log.Printf("siri-lite[et]: %v", err)
			return
		}
		s.set(journeys)
		log.Printf("siri-lite[et]: refreshed %d journeys", len(journeys))
	}

	tick()
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			tick()
		}
	}
}
