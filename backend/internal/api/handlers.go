// Package api exposes REST endpoints for initial/on-demand data.
package api

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/noi-techpark/open-mmc/backend/internal/feeds/siri"
	"github.com/noi-techpark/open-mmc/backend/internal/model"
	"github.com/noi-techpark/open-mmc/backend/internal/netex"
	"github.com/noi-techpark/open-mmc/backend/internal/store"
)

// SnapshotHandler serves GET /api/layers/{layer}/snapshot as a GeoJSON FeatureCollection.
func SnapshotHandler(fs store.FeatureStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		layer := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/layers/"), "/snapshot")
		if layer == "" {
			http.Error(w, "missing layer", http.StatusBadRequest)
			return
		}
		fc := model.NewFeatureCollection(fs.Snapshot(model.Layer(layer)))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(fc)
	}
}

// LineHandler serves GET /api/lines/{id} — NeTEx reference detail (name,
// routes, stops, timetable) for a line, looked up by SIRI's LineRef.
func LineHandler(ns *netex.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/api/lines/")
		if id == "" {
			http.Error(w, "missing line id", http.StatusBadRequest)
			return
		}
		line, ok := ns.Line(id)
		if !ok {
			http.Error(w, "line not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(line)
	}
}

// JourneyHandler serves GET /api/journey?lineId=...&vehicleRef=...&journeyRef=...
// — the specific scheduled trip a live vehicle is running (route stops,
// geometry, and timetable), resolved server-side so the frontend can
// request it directly instead of fetching the whole line and matching
// the vehicle to a Departure itself. journeyRef (SIRI's
// DatedVehicleJourneyRef) is optional — rail matches on vehicleRef alone,
// but some bus operators need it (see netex.FindJourney).
func JourneyHandler(ns *netex.Store) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		lineID := r.URL.Query().Get("lineId")
		vehicleRef := r.URL.Query().Get("vehicleRef")
		journeyRef := r.URL.Query().Get("journeyRef")
		if lineID == "" || vehicleRef == "" {
			http.Error(w, "missing lineId or vehicleRef", http.StatusBadRequest)
			return
		}
		journey, ok := ns.FindJourney(lineID, vehicleRef, journeyRef, time.Now())
		if !ok {
			http.Error(w, "journey not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(journey)
	}
}

// EstimatedTimetableHandler serves GET /api/estimated-timetable?journeyRef=...
// — the SIRI-ET real-time ETA schedule for a single bus trip, looked up by
// the DatedVehicleJourneyRef its live VM feature already carries. Shown
// as-is in the detail view, not merged with the NeTEx schedule.
func EstimatedTimetableHandler(es *siri.ETStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		journeyRef := r.URL.Query().Get("journeyRef")
		if journeyRef == "" {
			http.Error(w, "missing journeyRef", http.StatusBadRequest)
			return
		}
		journey, ok := es.Journey(journeyRef)
		if !ok {
			http.Error(w, "journey not found", http.StatusNotFound)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(journey)
	}
}
