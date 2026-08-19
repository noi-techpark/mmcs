# Design — Mobility Management Control Center

## Implementation status

First vertical slice implemented: `backend/` (Go, pollers for ODH parking, ODH e-charging (Neogy-AMPECO), SIRI-VM trains via the Anshar instance at siri.api.opendatahub.com; in-memory `FeatureStore`; WS hub; REST snapshot endpoint) and `frontend/` (Vite + React + MapLibre, modular per-layer definitions with clustering, sidebar with expandable per-layer options). `docker-compose.yml` runs both with hot reload. No middleware chain, ReferenceStore, or NeTEx handling yet — feeds are normalized straight into the store.

**Freshness policy**: every `Feature.Properties.RecordedAt` carries the age of the data itself (SIRI `RecordedAtTime`, ODH `mvalidtime`) — not when our system last touched it. `store.MaxFeatureAge` (30 min) is enforced two ways: `Upsert` rejects anything already stale on arrival, and a background sweeper (`main.go: runStaleSweeper`, ticks every minute) evicts features that stop being refreshed. Mirrors the trains-realtime webcomponent's own stale-vehicle filter (there: a 10 min cutoff on `RecordedAtTime` per fetch), generalized to a store-wide rule across all feeds.

**Unified Properties**: every feature (any layer) now shares `Layer`, `Status`, `Name` (human-identifying label), `UpdatedAt` (our processing time), `RecordedAt` (source data age), `Source`, optional `Ref`, and feed-specific `Data`. `Name` powers both the frontend detail panel and the optional label bubbles.

**Frontend layer options are modular and overridable**: `createPointLayer(id, label, overrides?, colorRules?)` merges `overrides` over its own base defaults (`{ opacity: 1, clustering: false, labels: false }`). Each layer is instantiated in its own file — `layers/parking.ts`, `layers/eCharging.ts`, `layers/trains.ts` — so its defaults (and coloring, see below) can be hand-tuned independently; `layers/definitions.ts` just imports and lists them for MapView/Sidebar to iterate. Adding a layer means adding a new file alongside these, not editing a shared config blob. Each `LayerDefinition` can supply its own `OptionsPanel` component — currently `PointLayerOptions` (clustering + labels checkboxes), shared by all three point layers since they're all built on the same factory.

**Icon separation**: `map/icons.ts`'s `withOutline` wraps every icon's base shape — fills it with a drop shadow (for separation from the basemap), then strokes the same path again with a crisp white ring (no shadow, so it stays sharp) on top. The ring is what matters once layer z-order is user-configurable (see draggable layer order below): a shadow alone doesn't stop one icon from blending into another overlapping icon or a label bubble, only a hard-edged outline does.

**Per-layer icon coloring** (`layers/types.ts` `ColorRule[]`): a layer classifies each feature into `{key, color}` via an ordered rule list (first match wins, must end with a catch-all) — decoupled from the backend's coarse `Status` field. Mechanically: `pointLayer.ts`'s `setData` tags each feature with a `_colorKey` property computed via the layer's rule set before pushing to the GL source (classification is plain JS, so rules can test anything on `Properties`), and the `icon-image` paint expression is just a `match` on that precomputed key — MapLibre expressions can't run arbitrary JS predicates, so classification has to happen before the data reaches the map. Clustering intentionally does *not* use `colorRules` — a cluster bubble always reflects the worst backend `Status` (critical > warning > ok), since that coarse signal is what "how bad is this cluster" should mean regardless of a layer's fancier per-feature scheme.

**Unified palette, one color-wheel**: `map/colors.ts` exports `PALETTE_SATURATION`/`PALETTE_LIGHTNESS` (0.73/0.63) — the single saturation/lightness every hue-based color in the app is built from, via `map/colorGradient.ts`'s `hslToHex(hue, s, l)`. `STATUS_COLORS` (ok/warning/critical, hues 137°/42°/0°; `unknown` stays a deliberately-hueless neutral gray) is itself generated this way, and everything downstream inherits it for free:
- `STATUS_COLOR_RULES` (the default `ColorRule[]` every layer uses unless it overrides) is built from `STATUS_COLORS`.
- `parking.ts`'s `PARKING_OCCUPANCY_COLOR_RULES` is a continuous green→yellow→red gradient on occupancy percent (`occupied/capacity`, breakpoints at 70%/90%) via `colorGradient.ts`'s `twoBreakpointHueGradient`, using `STATUS_HUES.ok/warning/critical` (also exported from `colors.ts`, the same anchors `STATUS_COLORS` is built from) at the shared `PALETTE_SATURATION`/`PALETTE_LIGHTNESS`. Interpolates *hue* (shortest path around the wheel), not RGB — mixing green and orange as raw RGB channels cuts through a desaturated, muddy brown instead of passing through yellow; hue-only interpolation at constant S/L stays vivid the whole way through. (`twoBreakpointGradient`, the RGB-mixing version, is kept for mixing towards a genuinely neutral color like gray, where there's no hue path to follow.) Bucketed into 5%-wide steps (21 + an "unknown" fallback for missing/zero capacity) since icons are pre-rendered rasters, not computed per pixel; visually indistinguishable from a true continuous gradient at marker size.
- `trains.ts`'s `TRAIN_DELAY_COLOR_RULES` keeps the trains-realtime webcomponent's 5 delay tiers (early/on-time/<5min/5-30min/30min+, classifying on `data.delaySeconds` instead of `status`) but reuses `STATUS_COLORS.ok/warning/critical` directly for on-time/minor-delay/severe-delay (same hues, so literally the same constants), and derives "early"/"moderate-delay" from two more hues (205°/22°) on the same `PALETTE_SATURATION`/`PALETTE_LIGHTNESS` wheel.

A new layer gets the unified look for free by using the default `STATUS_COLOR_RULES`; one that needs its own tiers (like trains) stays unified by deriving from `PALETTE_SATURATION`/`PALETTE_LIGHTNESS` rather than picking arbitrary hex.

**Detail view**: clicking any glyph (or label bubble) calls `ctx.onSelectFeature` (threaded through `LayerDefinition.mount(map, ctx)`) instead of opening a raw-JSON map popup. `App.tsx` holds `selectedFeature` state and renders `DetailPanel` — layer icon/label, name, status badge, both timestamps (relative), then the remaining `Data` fields auto-formatted as key/value rows.

**Known risk**: cluster-count and label text both need font glyphs, currently fetched from `demotiles.maplibre.org` — a shared community demo endpoint that rate-limits (429) under sustained/concurrent load. Fine for this prototype; self-hosting glyphs (or a paid provider) is a pre-production TODO.

**Name-label bubbles**, revised: the earlier `icon-text-fit` GL-native approach (no connector line, no collision avoidance across layers) was replaced by a custom placement pass, matching the trains-realtime webcomponent's leader-line bubbles but generalized across layers:
- `LayerDefinition` gained two optional hooks — `iconLayerIds` (GL layer ids whose rendered glyphs count as placement obstacles) and `getLabelTargets(map)` (visible, unclustered `{id, lngLat, text, color}` targets; a layer returns `[]` to opt out per-instance, e.g. when its own `labels` option is off).
- `map/labelPlacement.ts` is a pure function (`computePlacements`) — for each target, tries candidate positions (8 compass directions × 3 radius rings) around its glyph, keeping the first that doesn't overlap any glyph obstacle (any layer) or already-placed bubble (falls back to least-overlap if none is fully clear).
- `MapView.tsx` recomputes on the map's `idle` event (covers both camera moves and data/paint updates in one debounced hook) plus immediately when `visibleLayers`/`layerOptions` change, and renders the result as a plain SVG overlay (leader line + rounded-rect + text) sitting above the MapLibre canvas.

**Label overlay follow-up fixes**:
- *Most bubbles were missing*: `getLabelTargets`'s dedupe key fell back to `f.id ?? name`. MapLibre auto-assigns its own numeric `.id` per tile for GeoJSON sources with non-numeric ids (ours are strings) — that id repeats across unrelated features, and `??` doesn't treat `0` as missing, so most trains collapsed onto one label. `name` isn't unique either (it's `"line - direction"`, shared by every vehicle on a route). Fixed by keying/deduping on `coordinates + name` instead, ignoring `f.id` entirely.
- *Crowded/zoomed-out areas*: added `MAX_OVERLAP_RATIO` in `labelPlacement.ts` — if even the best candidate still covers >35% of the bubble's own area, the label is dropped rather than forced in, so density degrades into fewer visible labels instead of stacked/illegible ones.
- *Bubbles detached from glyphs while panning*: the GL canvas moves every animation frame during a drag, but placements were only recomputed on `idle` (i.e. after the gesture ends), so the SVG overlay visibly lagged. Fixed with `reprojectPlacement` (cheap: re-`project()`s the stored `lngLat` and re-applies the same rect-relative-to-dot pixel offset) driven by a rAF-coalesced `map.on('move', …)` listener — correct for pans; during a zoom gesture the offset doesn't rescale until the next `idle`, an accepted brief simplification.

**Per-layer freshness threshold**: `store.MaxFeatureAge` (30 min) is now a default, not a hardcoded global — `FeatureStore.SetMaxAge(layer, duration)` overrides it per layer, called once in `main.go` at startup (not exposed via any API/UI). E-charging is set to 48h since that feed only re-pushes a station when its state actually changes, not on a fixed cadence — the 30-min default was evicting stations that were simply quiet, not stale.

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

**Draggable layer order (sidebar order = map z-order)**: `App.tsx` holds `layerOrder: Layer[]` (default: `LAYER_DEFINITIONS` registry order — trains, parking, e-charging), a single list that drives both the sidebar's card order and which layer's icons render on top on the map (first = topmost in both). `Sidebar.tsx` implements drag-to-reorder with native HTML5 DnD on a small grip handle per card (not the whole card, so it doesn't fight with the existing click-to-expand); dropping computes the new order (remove dragged id, reinsert before the drop target) and calls `onReorder`. `MapView.tsx` applies it via a new `LayerDefinition.mapLayerIds` field (every GL layer id a point layer owns — cluster circle, cluster-count text, both point symbol layers) and `map.moveLayer(id)` (no second arg = "move to top of current stack"), walking `layerOrder` back-to-front so the first entry ends up highest; the basemap raster layer is never touched, so it stays at the bottom automatically. The label overlay (SVG bubbles) is a separate DOM layer stacked above the whole map canvas via CSS, so it's unaffected by — and always sits above — this z-order.

**Flights (GTFS)**: `backend/internal/feeds/gtfs` — a fourth feed shape, distinct from odh/siri's poller+normalizer-many-records pattern. GTFS is a static weekly schedule (a zip of CSVs: stops/trips/stop_times/calendar — no calendar_dates in this feed), so `gtfs.Poll` fetches and rebuilds **one aggregate Feature** per cycle (hourly) rather than upserting many. `FetchAirportFeature` parses the zip in memory, and for every trip touching the given airport stop (Skyalps flights are always exactly 2 stop_times — direct only) expands its `calendar.txt` weekday/date-range row into actual dates over the next N days, producing a sorted `flights: [...]` array embedded in the one Feature's `Data`. `store.SetMaxAge(model.LayerFlight, 3h)` gives it headroom over the hourly poll (same per-layer-override mechanism as e-charging). The frontend (`layers/flights.ts`) reuses `createPointLayer` even though there's only ever one feature — clustering/labels are irrelevant at n=1 but cost nothing to leave wired up. `DetailPanel.tsx` special-cases a `data.flights` array (detected via shape-sniffing, not a hardcoded layer check) into a simple sorted departure/arrival list instead of falling through to the generic key/value renderer, which can't sensibly print an array of objects.

Two integration points that are easy to miss when adding a layer, both hit here: the WS hub's `activeLayers` allowlist (`internal/ws/hub.go`) and the frontend store's `emptyLayers()` (`store/featureStore.ts`) both hardcode the layer list rather than deriving it from the registry — a new backend layer needs both updated or it silently never reaches the client over WS.

**Per-layer default visibility**: `LayerDefinition.defaultVisible` (default `true`) — `createPointLayer`'s 5th param. `eCharging.ts` sets it `false` (795 stations dominates the map on first load); `App.tsx`'s initial `visibleLayers` state reads it instead of assuming everything starts on.

**Sidebar drag rework**: replaced native HTML5 DnD (a static browser drag-ghost, no control over the other cards) with pointer-event-driven dragging for full control: `Sidebar.tsx` tracks `dragId`/`pointerY` via `mousedown` on the grip handle + window `mousemove`/`mouseup`, renders the dragged card as a `position: fixed` floating clone that tracks the cursor (the real card stays in the DOM at `visibility: hidden` to hold its layout slot), and reorders `layerOrder` live the moment the cursor's center crosses another card's vertical midpoint. The other cards' movement is animated via FLIP (`useLayoutEffect` keyed on `layerOrder`: measure each card's new position, snap it back to its last-known position with no transition via an inverse `translateY`, then release it into a transitioned move to zero on the next frame) — plain reordering doesn't animate on its own since the DOM nodes just appear in new positions.

**NeTEx reference data (lines, routes, stops, timetables)** — `backend/internal/netex`: the ReferenceStore concept sketched early in this doc, finally implemented. This is a genuinely different shape from every other feed: static schedule data (~800MB uncompressed XML, refreshed at most weekly) fetched over **FTP** (`github.com/jlaffaye/ftp`; `net/http` doesn't do `ftp://`), covering the whole province's rail *and* bus network in one file, looked up on demand by line id rather than pushed as Features.

- **Fetch**: `client.go` builds the dated URL (`.../NX-PI_01_it_apb_LINE_apb__YYYYMMDD.xml.zip`) from "today", falling back a few days if a day's export isn't published. `ftp.Retr` accepts the full path directly (verified against the real server — no `CWD` chase needed, unlike how `curl` does it by default). The ~23MB compressed zip is buffered in memory, but the ~800MB uncompressed XML **never** is: `archive/zip`'s per-entry reader is decompressed and handed straight to `encoding/xml.Decoder`, which is streamed token-by-token — full end-to-end fetch+parse of the real file takes ~15s.
- **Selective retention**: the streaming decoder only decodes the handful of element types the app needs (`ScheduledStopPoint`, `Line`, `Route`, `ServiceJourneyPattern`, `ServiceJourney`) — everything else (fares, accessibility, notices, ...) is skipped by never matching the `switch`. Lines/Routes/Stops are resolved for *every* transport mode (so a future bus layer has them ready, per the "include both" ask), but full per-stop timetable detail (`ServiceJourney.passingTimes`) is only kept for `TransportMode: rail` — ~4.3k of the file's ~56k service journeys — since nothing else needs it yet and retaining all of it would multiply memory for no current benefit.
- **Route geometry**: `Route.pointsInSequence` gives the ordered stop sequence directly (this feed's `RoutePointRef` happens to point straight at a `ScheduledStopPoint` id, skipping the usual `RoutePoint` indirection) — so the "route polygon" is a straight-line polyline through consecutive stops' coordinates, not NeTEx's actual road/rail-following `ServiceLink` geometry (which would require assembling per-segment `gml:posList`s in journey-pattern order — a materially bigger undertaking, deliberately out of scope here).
- **Consolidation**: the raw file models every minor timing/stopping variant of a direction as its own `Route` (one line had 32 near-duplicate Route ids for what's really just "outbound"/"inbound"). `resolve()` groups by `(line, direction, first stop, last stop)` — not just `(line, direction)` — keeps the variant with the most stops as the representative stop list, and merges every variant's departures into one timetable — deduplicated on `trainNumber + departureTime` rather than raw `ServiceJourneyID`, because the export carries a distinct `ServiceJourney` per seasonal validity period for what's logically one daily trip, so the ID alone doesn't dedupe. The endpoints are part of the key because a single `Line` can legitimately umbrella several distinct physical branches under the same generic `DirectionRef` code (e.g. one `REG` line covering both the Brenner-line and Valsugana-line services) — grouping on direction alone merged those into one fabricated "route" whose stop list belonged to a different branch than the trains actually running it, which silently broke live-position matching (see below) for any train on the minority branch.
- **Live position ("train is here")**: `DetailPanel`'s `liveSegment()` takes the selected vehicle's current GPS point and the matched journey's ordered stop coordinates, and finds the nearest line segment via `util/geo.ts`'s `nearestSegmentIndex` (point-to-segment distance with a cos-latitude correction, since the route polyline is straight-line-between-stops rather than true track geometry — see above). A stop lookup first tries the departure's own `stopId` against the canonical route's stop list, falling back to a name match, since a journey's `ServiceJourneyPattern` can reference a different-but-equivalent `ScheduledStopPoint` id (alternate platform/track) than the one the canonical route variant uses. Renders as a colored "TRAIN IS HERE" divider between the two stop rows. The flight timetable gets the analogous treatment: a "NOW" divider inserted at the point in the sorted flight list where the current time falls.
- **Line versioning**: a `Line` id can have several versions with different `ValidBetween` windows (seasonal schedule changes); `resolve()` picks whichever version's window covers "now", falling back to the highest version number if none does (e.g. right at a season boundary).
- **Weekly refresh gate**: `store.go`'s `MaxAge` (7 days) + `poll.go`, which checks cheaply and often (hourly) but only actually re-fetches (and re-parses the ~800MB) when the held data has aged past it — same shape as the FeatureStore's per-layer `SetMaxAge`, just for a single global store rather than per-layer.
- **API**: `GET /api/lines/{id}` (id = SIRI's `LineRef`, which is exactly the NeTEx `Line` id modulo a trailing colon NeTEx ids carry and SIRI's don't — `resolve()` strips it so lookups match directly). This is pull-on-demand reference data, not a pushed Feature, so it's a plain REST endpoint rather than living in the WS stream.
- **Frontend**: `App.tsx` fetches `/api/lines/:id` when the selected feature is a train with a `ref.lineId`, holds it in `lineDetail` state. `util/journey.ts`'s `findJourney` then matches the live vehicle's `data.vehicleRef` against `Departure.trainNumber` across the line's routes, picking out the one scheduled `Departure` that *is* this specific real-time train — not just "a" timetable entry for its line. `DetailPanel` shows that single journey's stop-by-stop schedule (station name + arrival–departure, collapsed into one range when a stop's arrival/departure match — i.e. no dwell) instead of a generic stops-list-plus-full-timetable; `MapView`'s `selected-route` GeoJSON source/layer (added before the per-layer icon layers, so it renders underneath the glyphs) draws only that matched route's polyline, not both directions. Falls back to a "no scheduled journey found" message if the vehicle ref doesn't match anything (e.g. an unscheduled/extra service) rather than showing an unrelated timetable.
- Buses aren't wired to any layer yet — the reference data is there (`Line.transportMode` distinguishes rail from bus), but per the ask, only the train layer's detail view uses it for now.

## Open questions / TODO

- Flights realtime source unclear (per requirements.md) — needs investigation.
- Threshold definitions for traffic status per road type, and for bike counters — TBD.
- At what point do we actually introduce a persistent DB (Valkey and/or SQLite/Postgres) — revisit once in-memory limitations are actually felt.
