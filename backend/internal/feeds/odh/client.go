// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

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
	Timestamp  string `json:"_timestamp"`
	TName      string `json:"tname"`
	MValidTime string `json:"mvalidtime"`
	// MValue is set only when mvalue is numeric; see MValueRaw for the rest.
	MValue float64 `json:"-"`
	// MValueRaw is mvalue as sent. Some datatypes carry a string instead
	// (on-demand vehicle "state") or an object (vehicle "position").
	MValueRaw   json.RawMessage `json:"-"`
	SCode       string          `json:"scode"`
	SName       string          `json:"sname"`
	SCoordinate Coordinate      `json:"scoordinate"`
	SMetadata   map[string]any  `json:"smetadata"`
	SOrigin     string          `json:"sorigin"`
	SType       string          `json:"stype"`
	SActive     bool            `json:"sactive"`
	SAvailable  bool            `json:"savailable"`
	// PCode/PName/PCoordinate identify the parent "station" a sensor
	// belongs to — e.g. several TrafficSensor lane sensors (scode) sharing
	// one physical road section and direction (pcode). Unused by feeds that
	// treat scode as the final granularity; traffic.go groups by pcode
	// instead, since same-pcode sensors share an identical scoordinate and
	// would otherwise render as fully overlapping map icons.
	PCode       string     `json:"pcode"`
	PName       string     `json:"pname"`
	PCoordinate Coordinate `json:"pcoordinate"`
}

// UnmarshalJSON keeps mvalue lenient: numeric values land in MValue, anything
// else is left in MValueRaw instead of failing the whole response.
func (r *Record) UnmarshalJSON(b []byte) error {
	type plain Record
	aux := struct {
		*plain
		MValue json.RawMessage `json:"mvalue"`
	}{plain: (*plain)(r)}
	if err := json.Unmarshal(b, &aux); err != nil {
		return err
	}
	r.MValueRaw = aux.MValue
	r.MValue = 0
	var n float64
	if json.Unmarshal(aux.MValue, &n) == nil {
		r.MValue = n
	}
	return nil
}

// StringValue returns mvalue as a string, for datatypes that carry text.
func (r Record) StringValue() (string, bool) {
	var s string
	if err := json.Unmarshal(r.MValueRaw, &s); err != nil {
		return "", false
	}
	return s, true
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

// NewAuthenticatedClient wraps an already-authenticating *http.Client (e.g.
// from odhauth.NewClient, which attaches/refreshes a Bearer token) for feeds
// that need closed/restricted ODH data rather than the public flat endpoints.
func NewAuthenticatedClient(hc *http.Client) *Client {
	return &Client{httpClient: hc}
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
