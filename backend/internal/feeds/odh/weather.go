package odh

import (
	"context"
	"fmt"
	"log"
	"time"

	"github.com/noi-techpark/open-mmc/backend/internal/model"
	"github.com/noi-techpark/open-mmc/backend/internal/store"
)

// WeatherURL fetches both precipitation and air-temperature, latest reading
// per station, from SIAG weather stations. The two datatypes arrive as
// separate flat records sharing a station via scode — PollWeather merges
// them into one Feature per station.
//
// No mvalidtime.gt cutoff here: the ODH API only accepts a literal
// timestamp (not a relative expression), which would need rebuilding every
// poll — and this feed's real-world ingestion lag (observed ~2-3h between
// a reading's mvalidtime and it showing up as "latest") makes a tight
// server-side cutoff actively harmful: it can filter out everything before
// the store even sees it. Staleness is left entirely to the store's own
// MaxFeatureAge check on Upsert (see store.MaxFeatureAge / SetMaxAge).
const WeatherURL = "https://mobility.api.opendatahub.com/v2/flat/MeteoStation/precipitation,air-temperature/latest?limit=-1&where=sorigin.eq.SIAG,sactive.eq.true"

// Coarse status thresholds (drives clustering only — see frontend
// layers/weather.ts for the finer-grained color rules actually shown per
// station, tuned the same way; keep both in sync if these change).
// Precipitation is mm accumulated since the station's last reading — not a
// fixed interval, since stations report on wildly varying cadences.
const (
	weatherPrecipitationHighMM = 2.0
	weatherTempVeryHighC       = 32.0
)

func weatherStatus(hasTemp bool, tempC float64, hasPrecip bool, precipMM float64) model.Status {
	if hasPrecip && precipMM >= weatherPrecipitationHighMM {
		return model.StatusCritical
	}
	if !hasTemp {
		return model.StatusUnknown
	}
	if tempC <= 0 || tempC >= weatherTempVeryHighC {
		return model.StatusWarning
	}
	return model.StatusOK
}

type weatherStation struct {
	rec        Record
	tempC      float64
	hasTemp    bool
	precipMM   float64
	hasPrecip  bool
	recordedAt time.Time
}

// PollWeather runs the weather flat endpoint on a fixed interval, grouping
// same-station (scode) precipitation/air-temperature records into one
// Feature per station before upserting.
func PollWeather(ctx context.Context, client *Client, interval time.Duration, fs store.FeatureStore) {
	tick := func() {
		records, err := client.FetchFlat(WeatherURL)
		if err != nil {
			log.Printf("odh[weather]: %v", err)
			return
		}

		stations := make(map[string]*weatherStation)
		for _, r := range records {
			recordedAt, err := ParseValidTime(r.MValidTime)
			if err != nil {
				continue
			}
			st, ok := stations[r.SCode]
			if !ok {
				st = &weatherStation{rec: r}
				stations[r.SCode] = st
			}
			switch r.TName {
			case "air-temperature":
				st.tempC = r.MValue
				st.hasTemp = true
			case "precipitation":
				st.precipMM = r.MValue
				st.hasPrecip = true
			default:
				continue
			}
			if recordedAt.After(st.recordedAt) {
				st.recordedAt = recordedAt
			}
		}

		n := 0
		for scode, st := range stations {
			if !st.hasTemp && !st.hasPrecip {
				continue
			}
			data := map[string]any{}
			if st.hasTemp {
				data["temperatureC"] = st.tempC
			}
			if st.hasPrecip {
				data["precipitationMM"] = st.precipMM
			}
			f := model.NewFeature(
				fmt.Sprintf("odh:weather:%s", scode),
				model.LayerWeather,
				model.Point(st.rec.SCoordinate.X, st.rec.SCoordinate.Y),
				st.rec.SName,
				"odh:"+st.rec.SOrigin,
				data,
			)
			f.Properties.Status = weatherStatus(st.hasTemp, st.tempC, st.hasPrecip, st.precipMM)
			f.Properties.RecordedAt = st.recordedAt
			fs.Upsert(f)
			n++
		}
		log.Printf("odh[weather]: upserted %d features", n)
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
