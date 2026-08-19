// Package siri polls a SIRI-VM (Anshar) endpoint and parses the XML
// VehicleMonitoringDelivery into Features.
package siri

import (
	"encoding/xml"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

type siriEnvelope struct {
	ServiceDelivery struct {
		VehicleMonitoringDelivery struct {
			VehicleActivity []VehicleActivity `xml:"VehicleActivity"`
		} `xml:"VehicleMonitoringDelivery"`
	} `xml:"ServiceDelivery"`
}

type VehicleActivity struct {
	RecordedAtTime          string `xml:"RecordedAtTime"`
	MonitoredVehicleJourney struct {
		LineRef              string `xml:"LineRef"`
		DirectionRef         string `xml:"DirectionRef"`
		FramedVehicleJourney struct {
			DataFrameRef           string `xml:"DataFrameRef"`
			DatedVehicleJourneyRef string `xml:"DatedVehicleJourneyRef"`
		} `xml:"FramedVehicleJourneyRef"`
		PublishedLineName string `xml:"PublishedLineName"`
		DirectionName     string `xml:"DirectionName"`
		OperatorRef       string `xml:"OperatorRef"`
		Monitored         bool   `xml:"Monitored"`
		InCongestion      bool   `xml:"InCongestion"`
		VehicleLocation   struct {
			Longitude float64 `xml:"Longitude"`
			Latitude  float64 `xml:"Latitude"`
		} `xml:"VehicleLocation"`
		Delay      string `xml:"Delay"`
		VehicleRef string `xml:"VehicleRef"`
	} `xml:"MonitoredVehicleJourney"`
}

type Client struct {
	httpClient *http.Client
	baseURL    string
}

func NewClient(baseURL string) *Client {
	return &Client{httpClient: &http.Client{Timeout: 15 * time.Second}, baseURL: baseURL}
}

// FetchVM fetches VehicleActivity records for the given SIRI-VM datasetId.
func (c *Client) FetchVM(datasetID string) ([]VehicleActivity, error) {
	u := fmt.Sprintf("%s/v1/rest/vm/?datasetId=%s", c.baseURL, url.QueryEscape(datasetID))
	resp, err := c.httpClient.Get(u)
	if err != nil {
		return nil, fmt.Errorf("siri: fetch %s: %w", u, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("siri: fetch %s: unexpected status %d", u, resp.StatusCode)
	}

	var env siriEnvelope
	if err := xml.NewDecoder(resp.Body).Decode(&env); err != nil {
		return nil, fmt.Errorf("siri: decode %s: %w", u, err)
	}
	return env.ServiceDelivery.VehicleMonitoringDelivery.VehicleActivity, nil
}
