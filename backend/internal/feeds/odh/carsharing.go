// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

package odh

import (
	"fmt"

	"github.com/noi-techpark/open-mmc/backend/internal/model"
)

// CarsharingURL fetches the latest available-vehicle count for every active
// AlpsGo carsharing station. ODH also carries carsharing stations under
// CARSHARINGBZ and sharedmobility-ch origins, but only AlpsGo was asked for.
const CarsharingURL = "https://mobility.api.opendatahub.com/v2/flat/CarsharingStation/number-available/latest?limit=-1&distinct=true&shownull=false&where=sorigin.eq.AlpsGo,sactive.eq.true"

// NormalizeCarsharing converts a CarsharingStation "number-available" record
// into a Feature. mvalue is the number of vehicles currently available at
// the station; smetadata.capacity_max is its parking capacity (0 means
// "unbounded"/not fixed, per the feed).
func NormalizeCarsharing(r Record) (model.Feature, bool) {
	if !r.SActive {
		return model.Feature{}, false
	}

	recordedAt, err := ParseValidTime(r.MValidTime)
	if err != nil {
		return model.Feature{}, false
	}

	capacity, _ := r.SMetadata["capacity_max"].(float64)
	available := r.MValue

	status := model.StatusOK
	if available <= 0 {
		status = model.StatusCritical
	}

	f := model.NewFeature(
		fmt.Sprintf("odh:carsharing:%s", r.SCode),
		model.LayerCarsharing,
		model.Point(r.SCoordinate.X, r.SCoordinate.Y),
		r.SName,
		"odh:"+r.SOrigin,
		map[string]any{
			"available": available,
			"capacity":  capacity,
		},
	)
	f.Properties.Status = status
	f.Properties.RecordedAt = recordedAt
	return f, true
}
