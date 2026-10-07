// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

package odh

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/noi-techpark/open-mmc/backend/internal/model"
	"github.com/noi-techpark/open-mmc/backend/internal/store"
)

// LinkStationURL fetches A22's road-section travel-time data: each
// LinkStation is one section between two measurement points (not a sensor
// at a single point like TrafficSensor), described by a qualitative level-
// of-service string per vehicle class rather than a speed figure.
const LinkStationURL = "https://mobility.api.opendatahub.com/v2/flat/LinkStation/" +
	"lds_leggeri_desc,lds_pesanti_desc" +
	"/latest?limit=-1&distinct=true&shownull=false&where=sorigin.eq.A22,sactive.eq.true"

// linkTrafficStatus classifies A22's Italian light-vehicle level-of-service
// string (lds_leggeri_desc) into the coarse 3-tier Status used for the
// detail panel's status dot. The frontend's line coloring is driven
// directly off the raw string (Data["lightTraffic"]), not off this —  see
// layers/trafficSegment.ts's LINK_TRAFFIC_SEVERITY, which the five values
// below were enumerated for (sampled live from the feed; order here is the
// same best→worst severity order used there).
func linkTrafficStatus(desc string) model.Status {
	switch desc {
	case "traffico scorrevole":
		return model.StatusOK
	case "rallentamenti", "code a tratti":
		return model.StatusWarning
	case "traffico rallentato con code", "traffico critico":
		return model.StatusCritical
	default:
		return model.StatusUnknown
	}
}

type linkSection struct {
	rec             Record
	lightDesc       string
	heavyDesc       string
	hasLight        bool
	hasHeavy        bool
	recordedAt      time.Time
	lonStart, latSt float64
	lonEnd, latEnd  float64
	hasGeometry     bool
}

// linkGeometry reads the section's start/end coordinates out of smetadata
// (LinkStation has no scoordinate/pcoordinate pair of its own — the section
// itself is the geometry). Comma-decimal "longitudininizio" typo is the
// feed's own field name, not ours.
func linkGeometry(meta map[string]any) (lonStart, latStart, lonEnd, latEnd float64, ok bool) {
	get := func(key string) (float64, bool) {
		v, ok := meta[key].(float64)
		return v, ok
	}
	var okLonS, okLatS, okLonE, okLatE bool
	lonStart, okLonS = get("longitudininizio")
	latStart, okLatS = get("latitudineinizio")
	lonEnd, okLonE = get("longitudinefine")
	latEnd, okLatE = get("latitudinefine")
	return lonStart, latStart, lonEnd, latEnd, okLonS && okLatS && okLonE && okLatE
}

// PollLinkTraffic runs the LinkStation travel-time endpoint on a fixed
// interval, merging each section's light/heavy-vehicle level-of-service
// records into one LineString Feature per section (scode).
func PollLinkTraffic(ctx context.Context, client *Client, interval time.Duration, fs store.FeatureStore) {
	tick := func() {
		records, err := client.FetchFlat(LinkStationURL)
		if err != nil {
			log.Printf("odh[traffic-link]: %v", err)
			return
		}

		sections := make(map[string]*linkSection)
		for _, r := range records {
			recordedAt, err := ParseValidTime(r.MValidTime)
			if err != nil {
				continue
			}
			s, ok := sections[r.SCode]
			if !ok {
				lonS, latS, lonE, latE, hasGeom := linkGeometry(r.SMetadata)
				s = &linkSection{rec: r, lonStart: lonS, latSt: latS, lonEnd: lonE, latEnd: latE, hasGeometry: hasGeom}
				sections[r.SCode] = s
			}
			desc, _ := r.StringValue()
			switch r.TName {
			case "lds_leggeri_desc":
				if s.hasLight && !recordedAt.After(s.recordedAt) {
					continue
				}
				s.lightDesc, s.hasLight = desc, true
			case "lds_pesanti_desc":
				if s.hasHeavy && !recordedAt.After(s.recordedAt) {
					continue
				}
				s.heavyDesc, s.hasHeavy = desc, true
			default:
				continue
			}
			if recordedAt.After(s.recordedAt) {
				s.recordedAt = recordedAt
			}
		}

		n := 0
		for scode, s := range sections {
			if !s.hasLight || !s.hasGeometry {
				continue
			}
			f := model.NewFeature(
				fmt.Sprintf("odh:traffic-link:%s", scode),
				model.LayerTrafficSegment,
				model.LineString([][2]float64{{s.lonStart, s.latSt}, {s.lonEnd, s.latEnd}}),
				s.rec.SName,
				"odh:"+s.rec.SOrigin,
				map[string]any{
					"lightTraffic": s.lightDesc,
					"heavyTraffic": s.heavyDesc,
				},
			)
			f.Properties.Status = linkTrafficStatus(s.lightDesc)
			f.Properties.RecordedAt = s.recordedAt
			fs.Upsert(f)
			n++
		}
		log.Printf("odh[traffic-link]: upserted %d features", n)
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
