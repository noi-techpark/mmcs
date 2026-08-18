# Design — Mobility Management Control Center

Living document, updated as decisions are made. See [requirements.md](requirements.md) for source requirements.

## Goals / constraints

- MVP prototype, kept minimal and low to the ground.
- Realtime: new events from feeds must propagate to open dashboards without a page reload (push, not poll-on-client).
- Single `docker-compose.yml` for local dev; single deployable unit set on k8s later.
- No hosted/managed external services (no AWS RDS etc.). Self-hosted containers (Postgres, Valkey, ...) are fine if actually needed.
- Ideally no state is lost on restart — but nothing to implement yet; the architecture must keep storage abstracted so a real DB can be dropped in later without reshaping the rest of the system.

## Frontend-only (WASM) option — rejected

Considered running everything client-side (WASM + embedded DB in-browser, no backend). Rejected because:
- SIRI-VM/NeTEx/ODH feeds need server-side polling (CORS, possible auth/rate limits).
- Multiple control-room viewers should share one poll+normalize pipeline, not each re-poll/re-parse independently.
- True push-on-event to all connected clients needs a server-side fan-out point (WebSocket hub) — a browser-only setup can't provide this.

## High-level architecture

```
[SIRI VM] [NeTEx] [ODH REST feeds] [Traffic/A22] [Weather/AQI] ...
        \      |         |              |            /
         v     v         v              v           v
                 feed pollers (one goroutine per source)
                              |
                              v
                        normalizer
                    (common Feature shape)
                              |
                              v
                       event bus (per-feature events)
                              |
                              v
                     middleware chain  <---- read access to FeatureStore
              (elaboration/aggregation,        + ReferenceStore
               single- or cross-feed,
               may emit derived features
               e.g. road status from
               sensors+incidents+weather)
                          /        \
                         v          v
                 FeatureStore   ReferenceStore
                 (realtime,      (NeTEx: lines,
                  volatile)       routes, stops,
                         \        timetables)
                          \          |
                           v         v
                          WebSocket hub  <---- REST API (initial snapshot,
                              |                 on-demand detail queries)
                              v
                        connected clients
                              |
                              v
                  frontend: MapLibre + layer toggles
```

### Middleware chain

Sits between the normalizer and the stores. Needed because some elaborations aren't single-feed (e.g. "is this road segment problematic" may combine traffic sensor readings + open incidents + weather; a threshold check on one feed is just the trivial case of this).

Each middleware handles normalized feature events off the bus, can read current state of *any* layer from `FeatureStore`/`ReferenceStore` for cross-feed context, and writes results (into the same layer, a derived layer, or both) back through `FeatureStore`. Chain is an ordered list, registered in `main.go`.

```go
type Middleware interface {
    // Handle a normalized feature event. May read other layers via store
    // for cross-feed context, and upsert derived features (own layer or
    // a new synthetic layer, e.g. "road-status") via store.
    Handle(ctx context.Context, evt FeatureEvent, store FeatureStore, ref ReferenceStore)
}
```

Examples: per-feed threshold evaluator (bike counters, weather → temperature/precipitation status), cross-feed road-status aggregator (traffic sensors + incidents + weather → derived congestion/problem layer).

## Common Feature shape

Wire/store format is a GeoJSON Feature — MapLibre GeoJSON sources consume this natively, so no translation step between WS and the map. Our metadata lives in `properties`.

```go
type Feature struct {
    Type       string     `json:"type"`      // always "Feature"
    ID         string     `json:"id"`        // stable, source-prefixed: "siri:sasa:1234"
    Geometry   Geometry   `json:"geometry"`   // GeoJSON geometry (Point / LineString / Polygon)
    Properties Properties `json:"properties"`
}

type Properties struct {
    Layer     Layer          `json:"layer"`
    Status    Status         `json:"status,omitempty"`    // ok | warning | critical | unknown
    UpdatedAt time.Time      `json:"updatedAt"`
    Source    string         `json:"source"`               // provenance, e.g. "siri-vm:sasa"
    Ref       *Ref           `json:"ref,omitempty"`         // link into ReferenceStore (NeTEx)
    Data      map[string]any `json:"data"`                  // layer-specific fields
}

type Ref struct {
    LineID  string `json:"lineId,omitempty"`
    RouteID string `json:"routeId,omitempty"`
    StopID  string `json:"stopId,omitempty"`
}
```

WS messages carry diffs, not raw snapshots: `{"layer": "bus_vehicle", "action": "upsert"|"delete", "feature": {...}}`. On connect, clients get a `FeatureCollection` snapshot per active layer via REST/WS. `Status` drives map coloring and is what the middleware chain reads/writes for threshold- and cross-feed-derived layers.

`Data` stays `map[string]any` at the wire/store boundary to keep `Feature` uniform across the store/WS/frontend; pollers/normalizers build it from typed structs internally before serializing, and frontend layer modules know their own `Data` shape by convention (layer → TS type).

### Layer types

| Layer | Geometry | `Data` fields (indicative) |
|---|---|---|
| `train_vehicle`, `bus_vehicle`, `on_demand_vehicle` | Point | lineName, direction, bearing, speedKmh, delaySeconds, nextStopId |
| `flight` | Point (or none, list-only) | flightNumber, airline, direction (arr/dep), scheduledTime, estimatedTime, status, gate |
| `taxi` | Point | available bool |
| `parking` | Point | name, capacity, free |
| `bike_parking` | Point | name, capacity, free |
| `car_sharing` | Point | provider, available bool |
| `e_charging` | Point | provider, plugType, availablePlugs, totalPlugs |
| `traffic_segment` | LineString | roadName, roadType, speedKmh, travelTimeSeconds, freeFlowTimeSeconds |
| `traffic_incident` | Point or LineString | incidentType, severity, description, startTime, endTime |
| `air_quality` | Point | stationName, pm10, pm25, no2, o3, aqi |
| `weather_station` | Point | temperature, precipitationMm, windSpeedKmh |
| `bike_counter` | Point | countWindow, direction |
| `road_status` *(derived)* | LineString | congestionRatio, contributingIncidentIds — produced by middleware, not a raw feed |

Two backend storage concerns, kept behind separate interfaces because they have very different access patterns:

### FeatureStore — realtime layer state

Vehicle positions, traffic status, parking occupancy, weather station readings, etc. High write rate (seconds), read pattern is "give me current state of layer X" + "notify me of changes." No relational queries needed.

```go
type FeatureStore interface {
    Upsert(layer string, f Feature)
    Delete(layer string, id string)
    Snapshot(layer string) []Feature
    Subscribe() <-chan Diff // for the WS hub to fan out
}
```

- **Now**: in-memory implementation (mutex/sync.Map-guarded), single process. Restart = re-poll from source feeds, state rebuilds within one polling cycle. Acceptable for MVP.
- **Later, if needed**: back this with Valkey (pub/sub + shared state) — mainly motivated by wanting multiple backend replicas, not by data value (this data is inherently ephemeral/re-derivable from source feeds).

### ReferenceStore — NeTEx relational data

Lines, routes, stop points, timetables, route geometries. Parsed from NeTEx, changes infrequently (periodic feed refresh, not per-second). Needs actual relational queries — the driving example: user clicks a vehicle on the map → look up its line → timetable + route polygon.

```go
type ReferenceStore interface {
    Line(id string) (Line, error)
    RoutesForLine(lineID string) ([]Route, error)
    TimetableForVehicle(vehicleID string) (Timetable, error)
    RouteGeometry(routeID string) (Geometry, error)
    // ...
}
```

- **Now**: in-memory implementation over parsed NeTEx structs + simple indexes (maps). Rebuilt from source NeTEx files/feed on startup.
- **Later**: this is the stronger candidate for a real relational DB (SQLite embedded, or Postgres) — NeTEx data is genuinely relational and reference-style, so query complexity is expected to grow past what in-memory indexes comfortably handle. Swappable behind the interface above without touching pollers, WS hub, or frontend.

Both interfaces live in `internal/store`; concrete implementations are swapped via constructor injection in `main.go`. No DB code is written yet — just the interfaces and the in-memory implementations.

## Stack

- **Backend: Go.** `encoding/xml` for SIRI-VM/NeTEx (no clear library advantage for either language here), goroutines are a natural fit for N independent feed pollers, `nhooyr.io/websocket` or `gorilla/websocket` for the fan-out hub.
- **Frontend: React + TypeScript + MapLibre GL JS** (open-source, no Mapbox token lock-in), Vite build, WebSocket client into a small live store (zustand or similar), toggleable per-layer panel per the [trains-realtime](https://webcomponents.opendatahub.com/webcomponent/trains-realtime) UX reference.

## Deployment

- **Dev**: `docker-compose.yml` — backend (air hot-reload) + frontend (vite dev server) over WS.
- **Prod/k8s**: Go backend serves the built frontend static assets itself — one container, one Deployment. No nginx, no DB, no external service, matches "no moving parts outside the deployment."

## Project layout

```
open-mmc/
  backend/
    main.go
    internal/
      feeds/
        siri/        # VM: trains, buses, on-demand
        netex/        # lines, timetables, GTFS flights fallback
        odh/          # taxis, parking, bike parking, carsharing, e-charging,
                       # traffic, incidents, air quality, weather, bike counters
      middleware/      # elaboration/aggregation chain (single- and cross-feed),
                       # e.g. threshold evaluation, derived road status
      store/           # FeatureStore + ReferenceStore interfaces + in-memory impls
      ws/              # hub + client, diff broadcast
      api/             # REST (snapshot/init data, detail queries) + ws upgrade handler
    go.mod
  frontend/
    src/
      map/             # MapLibre setup, Bolzano basemap
      layers/           # one module per overlay (trains, buses, flights, ...)
      ws/               # client, live store
      components/        # layer toggle panel, legends
    package.json
    vite.config.ts
  docker-compose.yml
  requirements.md
  design.md
```

## Open questions / TODO

- Flights realtime source unclear (per requirements.md) — needs investigation.
- Threshold definitions for traffic status per road type, and for bike counters — TBD.
- At what point do we actually introduce a persistent DB (Valkey and/or SQLite/Postgres) — revisit once in-memory limitations are actually felt.
