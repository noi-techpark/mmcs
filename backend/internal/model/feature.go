// Package model defines the common Feature shape shared by all feeds,
// the store, the WebSocket hub, and the frontend. See design.md.
package model

import "time"

type Layer string

const (
	LayerParking   Layer = "parking"
	LayerECharging Layer = "e_charging"
	LayerTrainVeh  Layer = "train_vehicle"
	LayerBusVeh    Layer = "bus_vehicle"
	LayerBusAlert  Layer = "bus_alert"
	LayerOnDemand  Layer = "on_demand_vehicle"
	LayerFlight    Layer = "flight"
	LayerWeather   Layer = "weather_station"
)

type Status string

const (
	StatusOK       Status = "ok"
	StatusWarning  Status = "warning"
	StatusCritical Status = "critical"
	StatusUnknown  Status = "unknown"
)

// Geometry is a minimal GeoJSON geometry (Point / LineString / Polygon as needed).
type Geometry struct {
	Type        string    `json:"type"`
	Coordinates []float64 `json:"coordinates"`
}

func Point(lon, lat float64) Geometry {
	return Geometry{Type: "Point", Coordinates: []float64{lon, lat}}
}

type Ref struct {
	LineID  string `json:"lineId,omitempty"`
	RouteID string `json:"routeId,omitempty"`
	StopID  string `json:"stopId,omitempty"`
}

// Properties is the shared shape every realtime feed normalizes into,
// regardless of layer: a Layer + Status to drive rendering, a Name that
// identifies the point to a human, and two distinct timestamps (see
// UpdatedAt/RecordedAt below). Feed-specific detail lives in Data.
type Properties struct {
	Layer  Layer  `json:"layer"`
	Status Status `json:"status,omitempty"`
	// Name identifies this point to a human (station name, vehicle +
	// line/destination, ...) — shown first in the frontend detail view
	// and label bubbles.
	Name string `json:"name"`
	// UpdatedAt is when our system last processed this feature.
	UpdatedAt time.Time `json:"updatedAt"`
	// RecordedAt is the age of the data itself — the source feed's own
	// timestamp for the reading (SIRI RecordedAtTime, ODH mvalidtime, ...).
	// The store uses this, not UpdatedAt, to decide staleness.
	RecordedAt time.Time      `json:"recordedAt"`
	Source     string         `json:"source"`
	Ref        *Ref           `json:"ref,omitempty"`
	Data       map[string]any `json:"data"`
}

// Feature is a GeoJSON Feature, consumable directly by MapLibre GeoJSON sources.
type Feature struct {
	Type       string     `json:"type"`
	ID         string     `json:"id"`
	Geometry   Geometry   `json:"geometry"`
	Properties Properties `json:"properties"`
}

func NewFeature(id string, layer Layer, geom Geometry, name string, source string, data map[string]any) Feature {
	return Feature{
		Type:     "Feature",
		ID:       id,
		Geometry: geom,
		Properties: Properties{
			Layer:     layer,
			Status:    StatusUnknown,
			Name:      name,
			UpdatedAt: time.Now().UTC(),
			Source:    source,
			Data:      data,
		},
	}
}

// FeatureCollection is a GeoJSON FeatureCollection, used for snapshot responses.
type FeatureCollection struct {
	Type     string    `json:"type"`
	Features []Feature `json:"features"`
}

func NewFeatureCollection(features []Feature) FeatureCollection {
	return FeatureCollection{Type: "FeatureCollection", Features: features}
}

// Diff is what the WS hub broadcasts to clients as store state changes.
type DiffAction string

const (
	DiffUpsert DiffAction = "upsert"
	DiffDelete DiffAction = "delete"
)

type Diff struct {
	Layer   Layer      `json:"layer"`
	Action  DiffAction `json:"action"`
	Feature Feature    `json:"feature"`
}
