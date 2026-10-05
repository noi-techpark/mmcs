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

// TrafficURL fetches A22 (Autostrada del Brennero) sensor readings, latest
// per sensor, for the datatypes PollTraffic needs. A22 is closed data and
// requires an authenticated client (see odhauth.NewClient /
// NewAuthenticatedClient), unlike the public feeds in this package.
//
// The color is driven by the average speed of light vehicles, a separate
// datatype on each sensor. "Nr. Light Vehicles" is its weight: when a
// direction has several lane sensors, each lane's speed is weighted by its
// own light-vehicle count (see aggregateLanes). Both datatypes sample on a
// fixed ~10-minute period (mperiod=600).
const TrafficURL = "https://mobility.api.opendatahub.com/v2/flat/TrafficSensor/" +
	"Nr.%20Light%20Vehicles,Average%20Speed%20Light%20Vehicles" +
	"/latest?limit=-1&distinct=true&shownull=false&where=sorigin.eq.A22,sactive.eq.true"

// trafficNoDataSentinel is A22's placeholder for "no vehicles of this class
// in this period" on the average-speed datatypes (observed as -999).
const trafficNoDataSentinel = -999.0

// Speed bands for light-vehicle average speed, in km/h. Bands are
// half-open at the lower edge: <40, 40–<70, 70–≤100, >100.
const (
	trafficBandVerySlowBelowKmh = 40.0
	trafficBandSlowBelowKmh     = 70.0
	trafficBandModerateMaxKmh   = 100.0
)

// Speed band identifiers sent to the frontend as Data["speedBand"]. The
// exact km/h figure stays server-side: A22 is closed data, so only the
// band (which the frontend colors) leaves the backend.
const (
	TrafficBandVerySlow = "very-slow"
	TrafficBandSlow     = "slow"
	TrafficBandModerate = "moderate"
	TrafficBandFreeFlow = "free-flow"
)

func trafficSpeedBand(speedKmh float64) string {
	switch {
	case speedKmh < trafficBandVerySlowBelowKmh:
		return TrafficBandVerySlow
	case speedKmh < trafficBandSlowBelowKmh:
		return TrafficBandSlow
	case speedKmh <= trafficBandModerateMaxKmh:
		return TrafficBandModerate
	default:
		return TrafficBandFreeFlow
	}
}

// trafficStatus is the coarse 3-tier status used for cluster coloring:
// only very-slow traffic reads as critical, any slowed-down band as warning.
func trafficStatus(speedKmh float64) model.Status {
	switch trafficSpeedBand(speedKmh) {
	case TrafficBandVerySlow:
		return model.StatusCritical
	case TrafficBandFreeFlow:
		return model.StatusOK
	default:
		return model.StatusWarning
	}
}

// trafficLane is one physical lane sensor (scode) — A22 reports several of
// these per direction (e.g. "marcia"/"sorpasso"), all sharing one
// pcode/pcoordinate. PollTraffic aggregates lanes up to one Feature per
// direction before upserting (see aggregateLanes).
type trafficLane struct {
	rec        Record
	lightCount float64
	hasCount   bool
	lightSpeed float64
	hasSpeed   bool
	recordedAt time.Time
}

type trafficDirection struct {
	rec         Record
	speedSum    float64 // sum(laneLightCount * laneLightSpeed), pooled across lanes
	speedWeight float64 // sum(laneLightCount), pooled across lanes
	recordedAt  time.Time
}

// aggregateLanes merges same-pcode lanes into one point per direction.
// Without this, lanes at the same physical section (identical scoordinate)
// render as fully overlapping map icons — worse, a lane in one status can
// visually sit on top of a same-point lane in a different status, making
// the topmost icon's color mismatch whichever lane a hover/click actually
// resolves to. Lanes with no light vehicles (or no usable speed) carry no
// weight and are skipped.
func aggregateLanes(lanes map[string]*trafficLane) map[string]*trafficDirection {
	directions := make(map[string]*trafficDirection)
	for _, lane := range lanes {
		if !lane.hasCount || !lane.hasSpeed || lane.lightSpeed == trafficNoDataSentinel || lane.lightCount <= 0 {
			continue
		}

		pcode := lane.rec.PCode
		d, ok := directions[pcode]
		if !ok {
			d = &trafficDirection{rec: lane.rec}
			directions[pcode] = d
		}
		d.speedSum += lane.lightCount * lane.lightSpeed
		d.speedWeight += lane.lightCount
		if lane.recordedAt.After(d.recordedAt) {
			d.recordedAt = lane.recordedAt
		}
	}
	return directions
}

// PollTraffic runs the A22 traffic flat endpoint on a fixed interval,
// grouping per-lane (scode) records into one Feature per direction (pcode —
// see aggregateLanes). A22 is closed data, so only the derived speed band
// (Data["speedBand"]) and Status reach the frontend — never the raw speeds
// or counts behind them.
func PollTraffic(ctx context.Context, client *Client, interval time.Duration, fs store.FeatureStore) {
	tick := func() {
		records, err := client.FetchFlat(TrafficURL)
		if err != nil {
			log.Printf("odh[traffic]: %v", err)
			return
		}

		// Despite being a "/latest" query, the API can return more than one
		// reading for the same (scode, tname) — observed on partially
		// decommissioned sensors serving up old (year(s)-stale) duplicates
		// alongside the current one. fieldSeenAt tracks the freshest
		// mvalidtime applied to each field so far, so an out-of-order older
		// duplicate arriving later in the array can't clobber a value
		// that's already newer — array order otherwise isn't meaningful.
		type fieldKey struct{ scode, tname string }
		fieldSeenAt := make(map[fieldKey]time.Time)

		lanes := make(map[string]*trafficLane)
		for _, r := range records {
			recordedAt, err := ParseValidTime(r.MValidTime)
			if err != nil {
				continue
			}
			fk := fieldKey{r.SCode, r.TName}
			if seenAt, ok := fieldSeenAt[fk]; ok && !recordedAt.After(seenAt) {
				continue
			}
			fieldSeenAt[fk] = recordedAt

			s, ok := lanes[r.SCode]
			if !ok {
				s = &trafficLane{rec: r}
				lanes[r.SCode] = s
			}
			switch r.TName {
			case "Nr. Light Vehicles":
				s.lightCount, s.hasCount = r.MValue, true
			case "Average Speed Light Vehicles":
				s.lightSpeed, s.hasSpeed = r.MValue, true
			default:
				continue
			}
			if recordedAt.After(s.recordedAt) {
				s.recordedAt = recordedAt
			}
		}

		n := 0
		for pcode, d := range aggregateLanes(lanes) {
			if d.speedWeight <= 0 {
				continue
			}
			avgSpeed := d.speedSum / d.speedWeight
			f := model.NewFeature(
				fmt.Sprintf("odh:traffic:%s", pcode),
				model.LayerTraffic,
				model.Point(d.rec.PCoordinate.X, d.rec.PCoordinate.Y),
				d.rec.PName,
				"odh:"+d.rec.SOrigin,
				map[string]any{"speedBand": trafficSpeedBand(avgSpeed)},
			)
			f.Properties.Status = trafficStatus(avgSpeed)
			f.Properties.RecordedAt = d.recordedAt
			fs.Upsert(f)
			n++
		}
		log.Printf("odh[traffic]: upserted %d features", n)
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
