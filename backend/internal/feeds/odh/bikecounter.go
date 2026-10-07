// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

package odh

import (
	"fmt"

	"github.com/noi-techpark/open-mmc/backend/internal/model"
)

// BikeCounterURL fetches the latest hourly cyclist count from every active
// BikeCounter station. Folded into the same LayerBicycle as BikeParking (see
// bikeparking.go) — Data["kind"] tells the frontend which icon/legend entry
// to use, and feature ids are namespaced per feed so the two never collide
// in the store.
const BikeCounterURL = "https://mobility.api.opendatahub.com/v2/flat/BikeCounter/vehicle%20detection%20(count)/latest?limit=-1&distinct=true&shownull=false&where=sactive.eq.true"

// NormalizeBikeCounter converts a BikeCounter "vehicle detection (count)"
// record into a Feature. A counter has no good/bad reading of its own — it's
// a volume measure, not an availability one — so Status stays Unknown; the
// frontend classifies it by Data["kind"] instead of Status.
func NormalizeBikeCounter(r Record) (model.Feature, bool) {
	if !r.SActive {
		return model.Feature{}, false
	}

	recordedAt, err := ParseValidTime(r.MValidTime)
	if err != nil {
		return model.Feature{}, false
	}

	f := model.NewFeature(
		fmt.Sprintf("odh:bike_counter:%s", r.SCode),
		model.LayerBicycle,
		model.Point(r.SCoordinate.X, r.SCoordinate.Y),
		r.SName,
		"odh:"+r.SOrigin,
		map[string]any{
			"kind":  "counter",
			"count": r.MValue,
		},
	)
	f.Properties.RecordedAt = recordedAt
	return f, true
}
