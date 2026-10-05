// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

// Spreads overlapping icons apart on screen, symmetrically around the real
// point. Icons whose screen positions are closer than an icon width form a
// group; the group's members are laid out on a ring centred on the group's
// real point, so the point sits between them rather than under one of them.
// A lone icon is never moved.
import type * as maplibregl from 'maplibre-gl'

/** Minimum center-to-center distance (screen px) between two icons. Icons are 24px. */
const MIN_SEP_PX = 22

/**
 * Zoom at which nudging starts for layers that only need it when zoomed in
 * (trains, buses, alerts, taxis). Below it their icons stay on their points.
 */
export const DISPLACE_FROM_ZOOM = 17

export interface DisplaceItem {
  /** Unique across all layers (layer id + feature id). */
  key: string
  lngLat: [number, number]
}

/** Returns new lngLat positions for the items that had to move; items that didn't move are absent. */
export function computeDisplacements(map: maplibregl.Map, items: DisplaceItem[]): Map<string, [number, number]> {
  const screen = items.map((it) => map.project(it.lngLat))
  const groups = overlapGroups(screen)
  const moved = new Map<string, [number, number]>()

  for (const group of groups) {
    if (group.length < 2) continue
    // The group's real point: the mean of its members' actual positions.
    const cx = group.reduce((s, i) => s + screen[i].x, 0) / group.length
    const cy = group.reduce((s, i) => s + screen[i].y, 0) / group.length
    // Members sit on a ring whose neighbours are exactly MIN_SEP apart
    // (chord = 2R·sin(π/n)), so the ring is as tight as the group allows.
    const n = group.length
    const radius = MIN_SEP_PX / (2 * Math.sin(Math.PI / n))
    // Stable order: members keep the same slots frame to frame.
    const ordered = [...group].sort((a, b) => items[a].key.localeCompare(items[b].key))
    ordered.forEach((i, k) => {
      const a = (2 * Math.PI * k) / n
      const ll = map.unproject([cx + radius * Math.cos(a), cy + radius * Math.sin(a)])
      moved.set(items[i].key, [ll.lng, ll.lat])
    })
  }
  return moved
}

/**
 * Largest group laid out on one ring. Bigger piles are split into several
 * groups, so a ring stays compact and a whole zoomed-out view never becomes
 * one enormous circle.
 */
const MAX_GROUP = 12

/**
 * Groups screen points by proximity. Each group grows outward from a seed
 * (members are within MIN_SEP_PX of the seed), rather than chaining through
 * neighbours of neighbours — chaining is what fused a zoomed-out city into
 * one group. Singletons are returned too. A grid of one icon-width cells
 * keeps the neighbour search local.
 */
function overlapGroups(points: { x: number; y: number }[]): number[][] {
  const cells = new Map<string, number[]>()
  const cellOf = (x: number, y: number): [number, number] => [Math.floor(x / MIN_SEP_PX), Math.floor(y / MIN_SEP_PX)]
  points.forEach((p, i) => {
    const [cx, cy] = cellOf(p.x, p.y)
    const key = `${cx},${cy}`
    const list = cells.get(key)
    if (list) list.push(i)
    else cells.set(key, [i])
  })

  const assigned = new Array<boolean>(points.length).fill(false)
  const groups: number[][] = []
  points.forEach((seed, i) => {
    if (assigned[i]) return
    assigned[i] = true
    const group = [i]
    const [cx, cy] = cellOf(seed.x, seed.y)
    for (let dx = -1; dx <= 1 && group.length < MAX_GROUP; dx++) {
      for (let dy = -1; dy <= 1 && group.length < MAX_GROUP; dy++) {
        for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (group.length >= MAX_GROUP) break
          if (assigned[j]) continue
          if (Math.hypot(points[j].x - seed.x, points[j].y - seed.y) < MIN_SEP_PX) {
            assigned[j] = true
            group.push(j)
          }
        }
      }
    }
    groups.push(group)
  })
  return groups
}
