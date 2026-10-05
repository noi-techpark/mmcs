// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

package odh

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/noi-techpark/open-mmc/backend/internal/model"
	"github.com/noi-techpark/open-mmc/backend/internal/store"
)

// OnDemandURL fetches the latest state and position of every active
// ON_DEMAND_VEHICLE (taxis). The two datatypes arrive as separate flat
// records sharing a vehicle via scode — PollOnDemand merges them into one
// Feature per vehicle. Vehicles without a position can't be placed on the
// map, so they're dropped.
const OnDemandURL = "https://mobility.api.opendatahub.com/v2/flat/ON_DEMAND_VEHICLE/state,position/latest?limit=-1&distinct=true&shownull=false&where=sactive.eq.true"

// onDemandStatus maps a vehicle's state to availability: only FREE and
// AVAILABLE (both observed in the feed) count as available; anything else
// (OCCUPIED, ...) reads as not available.
func onDemandStatus(state string) model.Status {
	switch state {
	case "FREE", "AVAILABLE":
		return model.StatusOK
	default:
		return model.StatusCritical
	}
}

// positionLonLat reads a "position" mvalue. Two shapes occur in the feed:
// GeoJSON-style {"type":"Point","coordinates":[lon,lat,...]} and
// {"lat":"46,673512","lon":"11,149236"} with comma decimal separators.
func positionLonLat(raw json.RawMessage) (lon, lat float64, ok bool) {
	var geo struct {
		Type        string    `json:"type"`
		Coordinates []float64 `json:"coordinates"`
	}
	if json.Unmarshal(raw, &geo) == nil && geo.Type == "Point" && len(geo.Coordinates) >= 2 {
		lon, lat = geo.Coordinates[0], geo.Coordinates[1]
	} else {
		var ll struct {
			Lat string `json:"lat"`
			Lon string `json:"lon"`
		}
		if json.Unmarshal(raw, &ll) != nil {
			return 0, 0, false
		}
		var errLat, errLon error
		lat, errLat = strconv.ParseFloat(strings.ReplaceAll(ll.Lat, ",", "."), 64)
		lon, errLon = strconv.ParseFloat(strings.ReplaceAll(ll.Lon, ",", "."), 64)
		if errLat != nil || errLon != nil {
			return 0, 0, false
		}
	}
	// A 0,0 position is the feed's placeholder (scoordinate is always 0,0
	// for these vehicles), not a real location.
	if lon == 0 && lat == 0 {
		return 0, 0, false
	}
	return lon, lat, true
}

type onDemandVehicle struct {
	name     string
	source   string
	state    string
	hasState bool
	stateAt  time.Time
	lon, lat float64
	hasPos   bool
	posAt    time.Time
}

// PollOnDemand runs the ON_DEMAND_VEHICLE endpoint on a fixed interval,
// merging each vehicle's state and position records into one Feature.
func PollOnDemand(ctx context.Context, client *Client, interval time.Duration, fs store.FeatureStore) {
	tick := func() {
		records, err := client.FetchFlat(OnDemandURL)
		if err != nil {
			log.Printf("odh[on_demand]: %v", err)
			return
		}

		vehicles := make(map[string]*onDemandVehicle)
		for _, r := range records {
			recordedAt, err := ParseValidTime(r.MValidTime)
			if err != nil {
				continue
			}
			v, ok := vehicles[r.SCode]
			if !ok {
				v = &onDemandVehicle{name: strings.TrimSpace(r.SName), source: "odh:" + r.SOrigin}
				vehicles[r.SCode] = v
			}
			// Each datatype keeps only its freshest reading, so an
			// out-of-order older duplicate can't overwrite a newer value.
			switch r.TName {
			case "state":
				state, ok := r.StringValue()
				if !ok || (v.hasState && !recordedAt.After(v.stateAt)) {
					continue
				}
				v.state, v.hasState, v.stateAt = state, true, recordedAt
			case "position":
				lon, lat, ok := positionLonLat(r.MValueRaw)
				if !ok || (v.hasPos && !recordedAt.After(v.posAt)) {
					continue
				}
				v.lon, v.lat, v.hasPos, v.posAt = lon, lat, true, recordedAt
			default:
				continue
			}
		}

		n := 0
		for scode, v := range vehicles {
			if !v.hasState || !v.hasPos {
				continue
			}
			recordedAt := v.stateAt
			if v.posAt.After(recordedAt) {
				recordedAt = v.posAt
			}
			f := model.NewFeature(
				fmt.Sprintf("odh:on_demand:%s", scode),
				model.LayerOnDemand,
				model.Point(v.lon, v.lat),
				v.name,
				v.source,
				map[string]any{"state": v.state},
			)
			f.Properties.Status = onDemandStatus(v.state)
			f.Properties.RecordedAt = recordedAt
			fs.Upsert(f)
			n++
		}
		log.Printf("odh[on_demand]: upserted %d features", n)
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
