// Small geo helpers for "where along this route is the vehicle right now"
// — see DetailPanel's train position indicator. The area covered (one
// province) is small enough that a longitude scale correction by cos(lat)
// is plenty accurate for *ranking* segments by proximity; no real
// projection needed.
export type LonLat = [number, number]

function distSqToSegment(p: LonLat, a: LonLat, b: LonLat, xScale: number): number {
  const ax = a[0] * xScale, ay = a[1]
  const bx = b[0] * xScale, by = b[1]
  const px = p[0] * xScale, py = p[1]
  const dx = bx - ax
  const dy = by - ay
  const lenSq = dx * dx + dy * dy
  let t = lenSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lenSq
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return (px - cx) ** 2 + (py - cy) ** 2
}

/**
 * Finds which segment of an ordered path a point is closest to, returning
 * its start index (so segment [i, i+1]) — "the vehicle is between stop i
 * and stop i+1". Returns null if the path has fewer than 2 points, or if
 * the point is farther than maxDegrees from every segment (a rough ~
 * maxDegrees*111km sanity check — don't claim a position when the vehicle
 * clearly isn't near this route at all, e.g. a mismatched journey).
 */
export function nearestSegmentIndex(point: LonLat, path: LonLat[], maxDegrees = 0.05): number | null {
  if (path.length < 2) return null
  const xScale = Math.cos((point[1] * Math.PI) / 180)
  let bestIdx: number | null = null
  let bestDistSq = Infinity
  for (let i = 0; i < path.length - 1; i++) {
    const d = distSqToSegment(point, path[i], path[i + 1], xScale)
    if (d < bestDistSq) {
      bestDistSq = d
      bestIdx = i
    }
  }
  if (bestIdx == null || Math.sqrt(bestDistSq) > maxDegrees) return null
  return bestIdx
}
