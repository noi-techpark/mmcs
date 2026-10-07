// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Package tourism polls the Open Data Hub Tourism "Announcement" content
// API — road/traffic announcements published by A22 and the Province of
// Bolzano, distinct from the mobility "flat" endpoints the odh package
// covers (see backend/internal/feeds/odh).
package tourism

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"time"
)

const baseURL = "https://tourism.api.opendatahub.com/v1/Announcement"

// LangText is one language's wording for a Detail field.
type LangDetail struct {
	Title    string `json:"Title"`
	BaseText string `json:"BaseText"`
	Language string `json:"Language"`
}

type position struct {
	Latitude  float64 `json:"Latitude"`
	Longitude float64 `json:"Longitude"`
}

type geo struct {
	Position *position `json:"position"`
}

// Announcement is one Open Data Hub Tourism Announcement item, fields
// trimmed to what Normalize needs.
type Announcement struct {
	Id         string                `json:"Id"`
	Geo        geo                   `json:"Geo"`
	Active     bool                  `json:"Active"`
	Detail     map[string]LangDetail `json:"Detail"`
	Source     string                `json:"Source"`
	TagIds     []string              `json:"TagIds"`
	Shortname  string                `json:"Shortname"`
	StartTime  string                `json:"StartTime"`
	EndTime    *string               `json:"EndTime"`
	LastChange string                `json:"LastChange"`
}

type announcementResponse struct {
	TotalResults int            `json:"TotalResults"`
	NextPage     *string        `json:"NextPage"`
	Items        []Announcement `json:"Items"`
}

type Client struct {
	httpClient *http.Client
}

func NewClient() *Client {
	return &Client{httpClient: &http.Client{Timeout: 15 * time.Second}}
}

// FetchActive fetches every Announcement from the given sources (comma-
// joined "source" filter) currently in effect (begin/end both pinned to
// now, per the API's "intersecting with" semantics — see the endpoint's
// swagger docs), following pagination until exhausted.
func (c *Client) FetchActive(sources []string) ([]Announcement, error) {
	now := time.Now().UTC().Format("2006-01-02T15:04:05Z")
	sourceFilter := ""
	for i, s := range sources {
		if i > 0 {
			sourceFilter += ","
		}
		sourceFilter += s
	}

	u := fmt.Sprintf("%s?pagesize=200&removenullvalues=true&source=%s&begin=%s&end=%s",
		baseURL, url.QueryEscape(sourceFilter), url.QueryEscape(now), url.QueryEscape(now))

	var all []Announcement
	for u != "" {
		resp, err := c.httpClient.Get(u)
		if err != nil {
			return nil, fmt.Errorf("tourism: fetch %s: %w", u, err)
		}
		var parsed announcementResponse
		err = json.NewDecoder(resp.Body).Decode(&parsed)
		resp.Body.Close()
		if err != nil {
			return nil, fmt.Errorf("tourism: decode %s: %w", u, err)
		}
		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("tourism: fetch %s: unexpected status %d", u, resp.StatusCode)
		}
		all = append(all, parsed.Items...)
		if parsed.NextPage == nil {
			break
		}
		u = *parsed.NextPage
	}
	return all, nil
}
