// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

package odh

import (
	"fmt"

	"github.com/noi-techpark/open-mmc/backend/internal/model"
)

// AirQualityURL fetches the latest European Air Quality Index rating for
// NO2 at every active environment station, as published for the A22 air
// quality web component.
const AirQualityURL = "https://mobility.api.opendatahub.com/v2/flat,node/EnvironmentStation/EAQI-NO2/latest?where=sactive.eq.true&origin=webcomp-a22-air-quality&limit=-1"

// airQualityStatus maps an EAQI rating to the coarse status used for
// clustering: only the two worst bands count as critical.
func airQualityStatus(rating string) model.Status {
	switch rating {
	case "good", "fair":
		return model.StatusOK
	case "moderate", "poor":
		return model.StatusWarning
	case "very poor", "extremely poor":
		return model.StatusCritical
	default:
		return model.StatusUnknown
	}
}

// NormalizeAirQuality converts an EAQI-NO2 rating record into a Feature.
// mvalue is the rating name (e.g. "good"); the band's concentration range
// is a fixed table on the frontend, not something the feed carries.
func NormalizeAirQuality(r Record) (model.Feature, bool) {
	if !r.SActive {
		return model.Feature{}, false
	}
	recordedAt, err := ParseValidTime(r.MValidTime)
	if err != nil {
		return model.Feature{}, false
	}
	rating, ok := r.StringValue()
	if !ok || rating == "" {
		return model.Feature{}, false
	}

	f := model.NewFeature(
		fmt.Sprintf("odh:air_quality:%s", r.SCode),
		model.LayerAirQuality,
		model.Point(r.SCoordinate.X, r.SCoordinate.Y),
		r.SName,
		"odh:"+r.SOrigin,
		map[string]any{"rating": rating},
	)
	f.Properties.Status = airQualityStatus(rating)
	f.Properties.RecordedAt = recordedAt
	return f, true
}
