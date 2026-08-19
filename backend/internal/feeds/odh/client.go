// Package odh polls Open Data Hub Mobility "flat" REST endpoints.
package odh

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

type Coordinate struct {
	X    float64 `json:"x"` // longitude
	Y    float64 `json:"y"` // latitude
	SRID int     `json:"srid"`
}

// Record is one entry of the ODH "flat" format. Field names are shared
// across station types (parking, e-charging, ...); metadata content varies.
type Record struct {
	Timestamp   string         `json:"_timestamp"`
	MValidTime  string         `json:"mvalidtime"`
	MValue      float64        `json:"mvalue"`
	SCode       string         `json:"scode"`
	SName       string         `json:"sname"`
	SCoordinate Coordinate     `json:"scoordinate"`
	SMetadata   map[string]any `json:"smetadata"`
	SOrigin     string         `json:"sorigin"`
	SType       string         `json:"stype"`
	SActive     bool           `json:"sactive"`
	SAvailable  bool           `json:"savailable"`
}

type flatResponse struct {
	Data []Record `json:"data"`
}

type Client struct {
	httpClient *http.Client
}

func NewClient() *Client {
	return &Client{httpClient: &http.Client{Timeout: 15 * time.Second}}
}

func (c *Client) FetchFlat(url string) ([]Record, error) {
	resp, err := c.httpClient.Get(url)
	if err != nil {
		return nil, fmt.Errorf("odh: fetch %s: %w", url, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("odh: fetch %s: unexpected status %d", url, resp.StatusCode)
	}

	var parsed flatResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("odh: decode %s: %w", url, err)
	}
	return parsed.Data, nil
}

var odhTimeLayouts = []string{
	"2006-01-02 15:04:05.999999999-0700",
	"2006-01-02 15:04:05-0700",
}

// ParseValidTime parses Record.MValidTime — the age of the measurement
// itself, e.g. "2026-08-18 12:00:04.607+0000" — into a time.Time.
func ParseValidTime(s string) (time.Time, error) {
	var lastErr error
	for _, layout := range odhTimeLayouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t, nil
		} else {
			lastErr = err
		}
	}
	return time.Time{}, lastErr
}
