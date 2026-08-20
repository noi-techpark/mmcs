// Greedy collision-avoiding placement for name-label bubbles: for each
// label target, try candidate positions around its glyph (increasing
// radius, 8 compass directions) and keep the first that doesn't overlap
// any glyph (from any layer) or any bubble already placed this pass —
// falling back to the least-bad candidate if nothing is fully clear.
import type * as maplibregl from 'maplibre-gl'
import { LAYER_DEFINITIONS } from '../layers/definitions'
import type { LayerOptions } from '../layers/types'
import type { Feature, Layer } from '../types/feature'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Point {
  x: number
  y: number
}

export interface Placement {
  id: string
  text: string
  color: string
  opacity: number
  lngLat: [number, number]
  dot: Point
  rect: Rect
  feature: Feature
}

const ICON_OBSTACLE_RADIUS = 13
const PILL_HEIGHT = 20
const PILL_PAD_X = 8
const BASE_RADIUS = 22
const RING_STEP = 20
const RING_COUNT = 3
const PLACEMENT_GAP = 4
const ANGLES_DEG = [0, -45, 45, -90, 90, -135, 135, 180]
// A candidate covering more than this fraction of the pill's own area is
// treated as "no room" — the label is dropped rather than forced in.
const MAX_OVERLAP_RATIO = 0.35

let measureCtx: CanvasRenderingContext2D | null = null
function measureTextWidth(text: string): number {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d')
  }
  if (!measureCtx) return text.length * 6.5
  measureCtx.font = '600 11px sans-serif'
  return measureCtx.measureText(text).width
}

function rectsOverlap(a: Rect, b: Rect, gap: number): boolean {
  return !(
    a.x + a.w + gap < b.x ||
    b.x + b.w + gap < a.x ||
    a.y + a.h + gap < b.y ||
    b.y + b.h + gap < a.y
  )
}

function overlapArea(a: Rect, b: Rect): number {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x))
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y))
  return ox * oy
}

/** Point on rect's boundary along the line from rect center towards `from`. */
export function edgePoint(from: Point, rect: Rect): Point {
  const cx = rect.x + rect.w / 2
  const cy = rect.y + rect.h / 2
  const dx = from.x - cx
  const dy = from.y - cy
  if (dx === 0 && dy === 0) return { x: cx, y: cy }
  const hw = rect.w / 2
  const hh = rect.h / 2
  const t = Math.min(dx !== 0 ? hw / Math.abs(dx) : Infinity, dy !== 0 ? hh / Math.abs(dy) : Infinity)
  return { x: cx + t * dx, y: cy + t * dy }
}

interface ComputeArgs {
  map: maplibregl.Map
  visibleLayers: Set<Layer>
  layerOptions: Record<Layer, LayerOptions>
}

export function computePlacements({ map, visibleLayers, layerOptions }: ComputeArgs): Placement[] {
  const obstacles: Rect[] = []
  for (const def of LAYER_DEFINITIONS) {
    if (!visibleLayers.has(def.id) || !def.iconLayerIds) continue
    const existing = def.iconLayerIds.filter((id) => map.getLayer(id))
    if (existing.length === 0) continue
    for (const f of map.queryRenderedFeatures({ layers: existing })) {
      const coords = (f.geometry as { coordinates?: [number, number] }).coordinates
      if (!coords) continue
      const pt = map.project(coords)
      obstacles.push({
        x: pt.x - ICON_OBSTACLE_RADIUS,
        y: pt.y - ICON_OBSTACLE_RADIUS,
        w: ICON_OBSTACLE_RADIUS * 2,
        h: ICON_OBSTACLE_RADIUS * 2,
      })
    }
  }

  const targets: { id: string; text: string; color: string; opacity: number; lngLat: [number, number]; dot: Point; feature: Feature }[] = []
  for (const def of LAYER_DEFINITIONS) {
    if (!visibleLayers.has(def.id) || !def.getLabelTargets) continue
    if (layerOptions[def.id]?.labels !== true) continue
    for (const t of def.getLabelTargets(map)) {
      const pt = map.project(t.lngLat)
      targets.push({
        id: `${def.id}:${t.id}`,
        text: t.text,
        color: t.color,
        opacity: t.opacity ?? 1,
        lngLat: t.lngLat,
        dot: { x: pt.x, y: pt.y },
        feature: t.feature,
      })
    }
  }

  const placedRects: Rect[] = []
  const placements: Placement[] = []

  for (const target of targets) {
    if (!target.text) continue
    const w = measureTextWidth(target.text) + PILL_PAD_X * 2
    const h = PILL_HEIGHT

    let best: { rect: Rect; overlap: number } | null = null

    ringLoop: for (let ring = 0; ring < RING_COUNT; ring++) {
      const radius = BASE_RADIUS + ring * RING_STEP
      for (const deg of ANGLES_DEG) {
        const rad = (deg * Math.PI) / 180
        const cx = target.dot.x + radius * Math.cos(rad)
        const cy = target.dot.y + radius * Math.sin(rad)
        const rect: Rect = { x: cx - w / 2, y: cy - h / 2, w, h }

        let overlap = 0
        for (const o of obstacles) if (rectsOverlap(rect, o, PLACEMENT_GAP)) overlap += overlapArea(rect, o) + 1
        for (const p of placedRects) if (rectsOverlap(rect, p, PLACEMENT_GAP)) overlap += overlapArea(rect, p) + 1

        if (overlap === 0) {
          best = { rect, overlap }
          break ringLoop
        }
        if (!best || overlap < best.overlap) best = { rect, overlap }
      }
    }

    if (!best) continue
    // Prefer hiding a label over crowding it in: if even the best candidate
    // still covers a large share of the pill (dense/zoomed-out area), drop
    // it rather than stack bubbles on top of each other or other glyphs.
    const pillArea = w * h
    if (best.overlap > pillArea * MAX_OVERLAP_RATIO) continue

    placedRects.push(best.rect)
    placements.push({
      id: target.id,
      text: target.text,
      color: target.color,
      opacity: target.opacity,
      lngLat: target.lngLat,
      dot: target.dot,
      rect: best.rect,
      feature: target.feature,
    })
  }

  return placements
}

/**
 * Cheap per-frame re-projection: keeps a placement's dot and rect glued to
 * its glyph during continuous pan/zoom by re-deriving screen position from
 * the stored lngLat, while keeping the same rect-relative-to-dot offset
 * computed by the last full computePlacements pass. Correct for panning
 * (a pure screen-space translation); during a zoom gesture the offset
 * doesn't rescale until the next full recompute on 'idle', which is a
 * brief, acceptable simplification.
 */
export function reprojectPlacement(map: maplibregl.Map, placement: Placement): Placement {
  const dot = map.project(placement.lngLat)
  const dx = dot.x - placement.dot.x
  const dy = dot.y - placement.dot.y
  return {
    ...placement,
    dot,
    rect: { ...placement.rect, x: placement.rect.x + dx, y: placement.rect.y + dy },
  }
}
