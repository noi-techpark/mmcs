import type { Feature } from '../types/feature'
import { formatDelay } from '../util/time'

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/**
 * Hover-popup content for train/bus vehicles — line number, direction, and
 * delay, all sourced from fields both SIRI normalizers already populate
 * (see backend/internal/feeds/siri/normalize.go Normalize/NormalizeLite).
 */
export function vehicleTooltip(props: Feature['properties']): string {
  const lineName = props.data.lineName
  const direction = props.data.direction
  const lines: string[] = []
  if (typeof lineName === 'string' && lineName) {
    lines.push(`<strong>${escapeHtml(lineName)}</strong>`)
  }
  if (typeof direction === 'string' && direction) {
    lines.push(escapeHtml(direction))
  }
  const delaySeconds = props.data.delaySeconds
  if (typeof delaySeconds === 'number') lines.push(formatDelay(delaySeconds))
  return lines.join('<br/>')
}
