// Package api exposes REST endpoints for initial/on-demand data.
package api

import (
	"encoding/json"
	"net/http"
	"strings"

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
