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
// A22 has no single "vehicle count" / "average speed" datatype — traffic is
// reported per vehicle class instead (light/heavy/buses), each on a fixed
// ~10-minute sampling period (confirmed against live data: mperiod=600).
// "Nr. Equivalent Vehicles" is A22's own PCU-weighted volume metric (heavy
// vehicles counted as more than one "equivalent" car) and is used as-is for
// the vehicle-count side of the classification; average speed has to be
// reconstructed here as a per-class-count-weighted mean of the three
// "Average Speed <class>" datatypes (see PollTraffic) since ODH doesn't
// publish a combined figure. A plain "Nr. Vehicles" datatype exists too but
// was observed to update only once a day (stale by design), so it's
// deliberately not used here.
const TrafficURL = "https://mobility.api.opendatahub.com/v2/flat/TrafficSensor/" +
	"Nr.%20Equivalent%20Vehicles,Nr.%20Light%20Vehicles,Nr.%20Heavy%20Vehicles,Nr.%20Buses," +
	"Average%20Speed%20Light%20Vehicles,Average%20Speed%20Heavy%20Vehicles,Average%20Speed%20Buses" +
	"/latest?limit=-1&distinct=true&shownull=false&where=sorigin.eq.A22,sactive.eq.true"

// trafficNoDataSentinel is A22's placeholder for "no vehicles of this class
// in this period" on the per-class average-speed datatypes (observed as
// -999, e.g. when Nr. Buses is 0 there's no bus speed to average).
const trafficNoDataSentinel = -999.0

// Classification thresholds, chosen from live A22 mid-day traffic, post
// lane-aggregation (see PollTraffic/aggregateLanes — one point per
// direction, "Nr. Equivalent Vehicles" summed across that direction's
// lanes): trafficVehiclesHighCount sits around the 75th percentile of the
// aggregated per-direction count observed on 2026-08-21 (median 401, p75
// 500, p90 533), and trafficSpeedLowKmh sits below the observed p25
// (~67 km/h, pre-aggregation) on a road with a 130 km/h limit. Revisit once
// more data (rush hour, incidents) is seen — see design.md "Threshold
// definitions for traffic status per road type ... — TBD".
const (
	trafficVehiclesHighCount = 480.0 // aggregated "Nr. Equivalent Vehicles" per direction, per ~10-minute period
	trafficSpeedLowKmh       = 60.0
)

// trafficStatus implements the user-facing traffic/vehicles/speed rule:
// low speed always reads as problematic (red) regardless of volume; among
// free-flowing sensors, high volume is the only thing that downgrades
// green to yellow.
func trafficStatus(vehicles, speedKmh float64) model.Status {
	if speedKmh < trafficSpeedLowKmh {
		return model.StatusCritical
	}
	if vehicles >= trafficVehiclesHighCount {
		return model.StatusWarning
	}
	return model.StatusOK
}

type trafficClassSample struct {
	count    float64
	hasCount bool
	speedKmh float64
	hasSpeed bool
}

// trafficLane is one physical lane sensor (scode) — A22 reports several of
// these per direction (e.g. "marcia"/"sorpasso"), all sharing one
// pcode/pcoordinate. Kept as an intermediate step; PollTraffic aggregates
// lanes up to one Feature per direction before upserting (see aggregateLanes).
type trafficLane struct {
	rec           Record
	equivVehicles float64
	hasEquivVeh   bool
	light, heavy  trafficClassSample
	buses         trafficClassSample
	recordedAt    time.Time
}

// weightedAvgSpeed combines per-vehicle-class average speeds into one
// figure, weighted by each class's own vehicle count so a handful of slow
// trucks don't skew the result as much as the much larger stream of light
// vehicles. Classes with no vehicles (hasCount false, or the sentinel
// speed) contribute zero weight rather than being treated as 0 km/h.
func weightedAvgSpeed(classes ...trafficClassSample) (avg float64, ok bool) {
	var weightedSum, totalWeight float64
	for _, c := range classes {
		if !c.hasCount || !c.hasSpeed || c.speedKmh == trafficNoDataSentinel || c.count <= 0 {
			continue
		}
		weightedSum += c.count * c.speedKmh
		totalWeight += c.count
	}
	if totalWeight <= 0 {
		return 0, false
	}
	return weightedSum / totalWeight, true
}

type trafficDirection struct {
	rec           Record
	equivVehicles float64
	speedSum      float64 // sum(laneCount * laneAvgSpeed), pooled across lanes
	speedWeight   float64 // sum(laneCount), pooled across lanes
	recordedAt    time.Time
}

// aggregateLanes merges same-pcode lanes into one point per direction.
// Without this, lanes at the same physical section (identical scoordinate)
// render as fully overlapping map icons — worse, a lane in one status can
// visually sit on top of a same-point lane in a different status, making
// the topmost icon's color mismatch whichever lane a hover/click actually
// resolves to.
func aggregateLanes(lanes map[string]*trafficLane) map[string]*trafficDirection {
	directions := make(map[string]*trafficDirection)
	for _, lane := range lanes {
		if !lane.hasEquivVeh {
			continue
		}
		laneAvgSpeed, ok := weightedAvgSpeed(lane.light, lane.heavy, lane.buses)
		if !ok {
			continue
		}
		laneCount := lane.light.count + lane.heavy.count + lane.buses.count

		pcode := lane.rec.PCode
		d, ok := directions[pcode]
		if !ok {
			d = &trafficDirection{rec: lane.rec}
			directions[pcode] = d
		}
		d.equivVehicles += lane.equivVehicles
		d.speedSum += laneCount * laneAvgSpeed
		d.speedWeight += laneCount
		if lane.recordedAt.After(d.recordedAt) {
			d.recordedAt = lane.recordedAt
		}
	}
	return directions
}

// PollTraffic runs the A22 traffic flat endpoint on a fixed interval,
// grouping per-lane (scode) records into one Feature per direction (pcode —
// see aggregateLanes). A22 is closed data, so only the classification
// (Properties.Status — see trafficStatus) reaches the frontend; the vehicle
// counts and speeds behind it stay server-side, in Data only long enough to
// compute Status.
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
			case "Nr. Equivalent Vehicles":
				s.equivVehicles = r.MValue
				s.hasEquivVeh = true
			case "Nr. Light Vehicles":
				s.light.count, s.light.hasCount = r.MValue, true
			case "Nr. Heavy Vehicles":
				s.heavy.count, s.heavy.hasCount = r.MValue, true
			case "Nr. Buses":
				s.buses.count, s.buses.hasCount = r.MValue, true
			case "Average Speed Light Vehicles":
				s.light.speedKmh, s.light.hasSpeed = r.MValue, true
			case "Average Speed Heavy Vehicles":
				s.heavy.speedKmh, s.heavy.hasSpeed = r.MValue, true
			case "Average Speed Buses":
				s.buses.speedKmh, s.buses.hasSpeed = r.MValue, true
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
				// Deliberately empty: A22 is closed data, so only the
				// derived Status (see trafficStatus) reaches the frontend —
				// not the vehicle counts/speeds behind it.
				map[string]any{},
			)
			f.Properties.Status = trafficStatus(d.equivVehicles, avgSpeed)
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
