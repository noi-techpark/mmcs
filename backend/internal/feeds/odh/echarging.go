package odh

import (
	"fmt"

	"github.com/noi-techpark/open-mmc/backend/internal/model"
)

const EChargingURL = "https://mobility.api.opendatahub.com/v2/flat/EChargingStation/number-available/latest?limit=-1&distinct=true&where=sactive.eq.true,sorigin.eq.%22Neogy-AMPECO%22"

// NormalizeECharging converts an EChargingStation "number-available" record
// into a Feature. mvalue is the number of currently available charging
// points; smetadata.capacity is the total.
func NormalizeECharging(r Record) (model.Feature, bool) {
	if !r.SActive {
		return model.Feature{}, false
	}

	// mvalidtime is the age of the data itself; an unparsable timestamp
	// means we can't judge freshness, so drop the record.
	recordedAt, err := ParseValidTime(r.MValidTime)
	if err != nil {
		return model.Feature{}, false
	}

	capacity, _ := r.SMetadata["capacity"].(float64)
	available := r.MValue

	status := model.StatusOK
	switch {
	case available <= 0:
		status = model.StatusCritical
	case capacity > 0 && available/capacity < 0.2:
		status = model.StatusWarning
	}

	f := model.NewFeature(
		fmt.Sprintf("odh:echarging:%s", r.SCode),
		model.LayerECharging,
		model.Point(r.SCoordinate.X, r.SCoordinate.Y),
		r.SName,
		"odh:"+r.SOrigin,
		map[string]any{
			"capacity":  capacity,
			"available": available,
		},
	)
	f.Properties.Status = status
	f.Properties.RecordedAt = recordedAt
	return f, true
}
