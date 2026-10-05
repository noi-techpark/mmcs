// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Which icon is "the one you see" when several sit on the same spot. Icons
// draw in two nested orders: layers by the sidebar's z-order (later in the
// style stack = on top), then within a layer by symbol-sort-key (the
// rule's score, carried on each feature as _sortKey). Clicks and overlap
// badges both rank by that same order, so the icon you click is the one
// drawn on top.
import type * as maplibregl from 'maplibre-gl'

/** Sorts rendered features topmost-first. */
export function rankFeatures(map: maplibregl.Map, features: maplibregl.MapGeoJSONFeature[]): maplibregl.MapGeoJSONFeature[] {
  const styleOrder = map.getStyle().layers.map((l) => l.id)
  const layerRank = (f: maplibregl.MapGeoJSONFeature) => styleOrder.indexOf(f.layer.id)
  const sortKey = (f: maplibregl.MapGeoJSONFeature) => Number(f.properties?._sortKey ?? 0)
  return [...features].sort((a, b) => layerRank(b) - layerRank(a) || sortKey(b) - sortKey(a))
}
