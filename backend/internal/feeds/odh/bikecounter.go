// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

package odh

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"
	"time"

	"github.com/noi-techpark/open-mmc/backend/internal/model"
	"github.com/noi-techpark/open-mmc/backend/internal/store"
)

// BikeCounterURL fetches Ecocounter's cyclist counts. ODH also carries a
// FAMAS-origin BikeCounter dataset, but at the time of writing its newest
// reading was over a year stale (last update mid-2025) — Ecocounter is the
// one that's actually live, so this feed is scoped to it rather than all
// BikeCounter stations. "vehicle-detection" is Ecocounter's bike-count
// datatype; the same stations also publish "countpeople" (pedestrians) and
// "nr. vehicles" (cars) under the same stype, which this URL excludes.
const BikeCounterURL = "https://mobility.api.opendatahub.com/v2/flat/BikeCounter/vehicle-detection/latest?limit=-1&distinct=true&shownull=false&where=sorigin.eq.Ecocounter,sactive.eq.true"

// bikeCounterSite aggregates one physical counting site — Ecocounter
// reports each direction (":IN"/":OUT" scode suffix) as its own record,
// sharing one coordinate (smetadata.siteId) — into one Feature. Without
// this, every site would render as two fully overlapping map icons (same
// pattern as traffic.go's aggregateLanes, for the same reason).
type bikeCounterSite struct {
	rec        Record
	count      float64
	recordedAt time.Time
}

// bikeCounterSiteName strips Ecocounter's "(in) - <flow description>" /
// "(out) - <flow description>" suffix (see BikeCounterURL sample data) down
// to the shared site name both directions' sname carry as a prefix.
func bikeCounterSiteName(sname string) string {
	if i := strings.Index(sname, " ("); i >= 0 {
		return sname[:i]
	}
	return sname
}

// bikeCounterSiteID reads smetadata.siteId — the id Ecocounter's IN/OUT
// scode pair shares — falling back to the record's own scode if absent.
func bikeCounterSiteID(r Record) string {
	switch v := r.SMetadata["siteId"].(type) {
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case string:
		return v
	default:
		return r.SCode
	}
}

// PollBikeCounter runs the Ecocounter bike-count endpoint on a fixed
// interval, summing each site's directional (IN+OUT) records into one
// Feature per site.
func PollBikeCounter(ctx context.Context, client *Client, interval time.Duration, fs store.FeatureStore) {
	tick := func() {
		records, err := client.FetchFlat(BikeCounterURL)
		if err != nil {
			log.Printf("odh[bike-counter]: %v", err)
			return
		}

		sites := make(map[string]*bikeCounterSite)
		for _, r := range records {
			recordedAt, err := ParseValidTime(r.MValidTime)
			if err != nil {
				continue
			}
			siteID := bikeCounterSiteID(r)
			s, ok := sites[siteID]
			if !ok {
				s = &bikeCounterSite{rec: r}
				sites[siteID] = s
			}
			s.count += r.MValue
			if recordedAt.After(s.recordedAt) {
				s.recordedAt = recordedAt
			}
		}

		n := 0
		for siteID, s := range sites {
			f := model.NewFeature(
				fmt.Sprintf("odh:bike_counter:%s", siteID),
				model.LayerBicycle,
				model.Point(s.rec.SCoordinate.X, s.rec.SCoordinate.Y),
				bikeCounterSiteName(s.rec.SName),
				"odh:"+s.rec.SOrigin,
				map[string]any{
					"kind":  "counter",
					"count": s.count,
				},
			)
			f.Properties.RecordedAt = s.recordedAt
			fs.Upsert(f)
			n++
		}
		log.Printf("odh[bike-counter]: upserted %d features", n)
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
