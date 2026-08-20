package siri

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

// LiteClient fetches STA's SIRI-lite feeds (efa.sta.bz.it) — plain JSON
// bodies covering the whole province at once, unlike the Anshar-hosted
// XML+datasetId feed Client talks to.
type LiteClient struct {
	httpClient *http.Client
	baseURL    string
}

func NewLiteClient(baseURL string) *LiteClient {
	return &LiteClient{httpClient: &http.Client{Timeout: 30 * time.Second}, baseURL: baseURL}
}

// LiteVehicleActivity mirrors VehicleActivity's fields, but SIRI-lite's JSON
// encodes numeric/boolean values as strings, so it needs its own struct
// rather than reusing VehicleActivity's xml-tagged, typed fields.
type LiteVehicleActivity struct {
	RecordedAtTime          string `json:"RecordedAtTime"`
	MonitoredVehicleJourney struct {
		LineRef                 string `json:"LineRef"`
		DirectionRef            string `json:"DirectionRef"`
		FramedVehicleJourneyRef struct {
			DataFrameRef           string `json:"DataFrameRef"`
			DatedVehicleJourneyRef string `json:"DatedVehicleJourneyRef"`
		} `json:"FramedVehicleJourneyRef"`
		PublishedLineName string `json:"PublishedLineName"`
		DirectionName     string `json:"DirectionName"`
		OperatorRef       string `json:"OperatorRef"`
		Monitored         string `json:"Monitored"`
		InCongestion      string `json:"InCongestion"`
		VehicleLocation   struct {
			Longitude string `json:"Longitude"`
			Latitude  string `json:"Latitude"`
		} `json:"VehicleLocation"`
		Delay      string `json:"Delay"`
		VehicleRef string `json:"VehicleRef"`
	} `json:"MonitoredVehicleJourney"`
}

type liteVMEnvelope struct {
	ServiceDelivery struct {
		VehicleMonitoringDelivery struct {
			VehicleActivity []LiteVehicleActivity `json:"VehicleActivity"`
		} `json:"VehicleMonitoringDelivery"`
	} `json:"ServiceDelivery"`
}

// FetchVM fetches the whole province's live bus positions.
func (c *LiteClient) FetchVM() ([]LiteVehicleActivity, error) {
	u := c.baseURL + "/siri-lite/vehicle-monitoring"
	resp, err := c.httpClient.Get(u)
	if err != nil {
		return nil, fmt.Errorf("siri-lite: fetch %s: %w", u, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("siri-lite: fetch %s: unexpected status %d", u, resp.StatusCode)
	}

	var env liteVMEnvelope
	if err := json.NewDecoder(resp.Body).Decode(&env); err != nil {
		return nil, fmt.Errorf("siri-lite: decode %s: %w", u, err)
	}
	return env.ServiceDelivery.VehicleMonitoringDelivery.VehicleActivity, nil
}

func parseLiteFloat(s string) float64 {
	v, _ := strconv.ParseFloat(s, 64)
	return v
}

func parseLiteBool(s string) bool {
	return s == "true"
}
