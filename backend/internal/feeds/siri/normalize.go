package siri

import (
	"fmt"
	"time"

	"github.com/noi-techpark/open-mmc/backend/internal/model"
)

// Normalize converts a SIRI-VM VehicleActivity into a Feature. datasetID is
// used both for the source tag and to namespace feature IDs.
func Normalize(datasetID string, layer model.Layer, va VehicleActivity) (model.Feature, bool) {
	mvj := va.MonitoredVehicleJourney
	if mvj.VehicleRef == "" {
		return model.Feature{}, false
	}

	// RecordedAtTime is the age of the data itself (mirrors the
	// trains-realtime webcomponent's stale-vehicle filter); an unparsable
	// timestamp means we can't judge freshness, so drop the record.
	recordedAt, err := time.Parse(time.RFC3339, va.RecordedAtTime)
	if err != nil {
		return model.Feature{}, false
	}

	journeyRef := mvj.FramedVehicleJourney.DatedVehicleJourneyRef
	id := fmt.Sprintf("siri:%s:%s", datasetID, journeyRef)
	if journeyRef == "" {
		id = fmt.Sprintf("siri:%s:%s", datasetID, mvj.VehicleRef)
	}

	delaySeconds, _ := ParseISODurationSeconds(mvj.Delay)

	// Thresholds match the trains-realtime webcomponent's _delayColor:
	// on time or early is ok, any positive delay is a warning, 30+ min
	// late is critical. (The webcomponent has a 5th tier — a lighter
	// yellow for <5min vs orange for 5-30min — that our 3-state model
	// doesn't distinguish; both collapse into warning here.)
	status := model.StatusOK
	switch {
	case delaySeconds >= 1800:
		status = model.StatusCritical
	case delaySeconds > 0:
		status = model.StatusWarning
	}

	f := model.NewFeature(
		id,
		layer,
		model.Point(mvj.VehicleLocation.Longitude, mvj.VehicleLocation.Latitude),
		fmt.Sprintf("%s - %s", mvj.PublishedLineName, mvj.DirectionName),
		"siri-vm:"+datasetID,
		map[string]any{
			"vehicleRef":   mvj.VehicleRef,
			"lineName":     mvj.PublishedLineName,
			"direction":    mvj.DirectionName,
			"operatorRef":  mvj.OperatorRef,
			"delaySeconds": delaySeconds,
			"inCongestion": mvj.InCongestion,
		},
	)
	f.Properties.Status = status
	f.Properties.RecordedAt = recordedAt
	f.Properties.Ref = &model.Ref{LineID: mvj.LineRef}
	return f, true
}

// NormalizeLite converts a SIRI-lite VehicleActivity (STA's bus feed) into a
// Feature. Same shape/status logic as Normalize, adjusted for SIRI-lite's
// string-encoded numeric/boolean fields. datasetID namespaces feature ids
// the same way (e.g. "sta-bus").
func NormalizeLite(datasetID string, layer model.Layer, va LiteVehicleActivity) (model.Feature, bool) {
	mvj := va.MonitoredVehicleJourney
	if mvj.VehicleRef == "" {
		return model.Feature{}, false
	}

	recordedAt, err := time.Parse(time.RFC3339, va.RecordedAtTime)
	if err != nil {
		return model.Feature{}, false
	}

	journeyRef := mvj.FramedVehicleJourneyRef.DatedVehicleJourneyRef
	id := fmt.Sprintf("siri:%s:%s", datasetID, journeyRef)
	if journeyRef == "" {
		id = fmt.Sprintf("siri:%s:%s", datasetID, mvj.VehicleRef)
	}

	delaySeconds, _ := ParseISODurationSeconds(mvj.Delay)

	status := model.StatusOK
	switch {
	case delaySeconds >= 1800:
		status = model.StatusCritical
	case delaySeconds > 0:
		status = model.StatusWarning
	}

	f := model.NewFeature(
		id,
		layer,
		model.Point(parseLiteFloat(mvj.VehicleLocation.Longitude), parseLiteFloat(mvj.VehicleLocation.Latitude)),
		fmt.Sprintf("%s - %s", mvj.PublishedLineName, mvj.DirectionName),
		"siri-lite:"+datasetID,
		map[string]any{
			"vehicleRef":             mvj.VehicleRef,
			"lineName":               mvj.PublishedLineName,
			"direction":              mvj.DirectionName,
			"operatorRef":            mvj.OperatorRef,
			"delaySeconds":           delaySeconds,
			"inCongestion":           parseLiteBool(mvj.InCongestion),
			"datedVehicleJourneyRef": journeyRef,
		},
	)
	f.Properties.Status = status
	f.Properties.RecordedAt = recordedAt
	f.Properties.Ref = &model.Ref{LineID: mvj.LineRef}
	return f, true
}
