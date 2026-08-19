package odh

import (
	"fmt"

	"github.com/noi-techpark/open-mmc/backend/internal/model"
)

const ParkingURL = "https://mobility.api.opendatahub.com/v2/flat/ParkingStation/occupied/latest?limit=-1&distinct=true&where=sactive.eq.true"

// NormalizeParking converts a ParkingStation "occupied" record into a Feature.
// mvalue is the number of occupied spaces; smetadata.capacity is the total.
func NormalizeParking(r Record) (model.Feature, bool) {
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
	occupied := r.MValue
	free := capacity - occupied

	status := model.StatusOK
	if capacity > 0 {
		occupancy := occupied / capacity
		switch {
		case occupancy >= 0.95:
			status = model.StatusCritical
		case occupancy >= 0.8:
			status = model.StatusWarning
		}
	} else {
		status = model.StatusUnknown
	}

	f := model.NewFeature(
		fmt.Sprintf("odh:parking:%s", r.SCode),
		model.LayerParking,
		model.Point(r.SCoordinate.X, r.SCoordinate.Y),
		r.SName,
		"odh:"+r.SOrigin,
		map[string]any{
			"capacity": capacity,
			"occupied": occupied,
			"free":     free,
		},
	)
	f.Properties.Status = status
	f.Properties.RecordedAt = recordedAt
	return f, true
}
