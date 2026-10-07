// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

package odh

import (
	"fmt"

	"github.com/noi-techpark/open-mmc/backend/internal/model"
)

// BikeParkingURL fetches the latest free-space count of every active bike
// parking box (BikeParking stations, one "free" datatype per box).
const BikeParkingURL = "https://mobility.api.opendatahub.com/v2/flat/BikeParking/free/latest?limit=-1&distinct=true&shownull=false&where=sactive.eq.true"

// NormalizeBikeParking converts a BikeParking "free" record into a Feature.
// mvalue is the number of free spaces; smetadata.totalPlaces is the total.
func NormalizeBikeParking(r Record) (model.Feature, bool) {
	if !r.SActive {
		return model.Feature{}, false
	}

	// mvalidtime is the age of the data itself; an unparsable timestamp
	// means we can't judge freshness, so drop the record.
	recordedAt, err := ParseValidTime(r.MValidTime)
	if err != nil {
		return model.Feature{}, false
	}

	capacity, _ := r.SMetadata["totalPlaces"].(float64)
	free := r.MValue

	status := model.StatusOK
	switch {
	case free <= 0:
		status = model.StatusCritical
	case capacity > 0 && free/capacity < 0.2:
		status = model.StatusWarning
	}
	if capacity <= 0 && free > 0 {
		status = model.StatusUnknown
	}

	f := model.NewFeature(
		fmt.Sprintf("odh:bike_parking:%s", r.SCode),
		model.LayerBicycle,
		model.Point(r.SCoordinate.X, r.SCoordinate.Y),
		r.SName,
		"odh:"+r.SOrigin,
		map[string]any{
			"kind":     "parking",
			"capacity": capacity,
			"free":     free,
		},
	)
	f.Properties.Status = status
	f.Properties.RecordedAt = recordedAt
	return f, true
}
