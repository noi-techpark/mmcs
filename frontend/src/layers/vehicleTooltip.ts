import type { Feature } from '../types/feature'

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
}

/** hh:mm-free delay phrasing shared with DetailPanel's statusValueText, but standalone since the popup only needs the string, not a full component. */
function delayText(delaySeconds: unknown): string | null {
  if (typeof delaySeconds !== 'number') return null
  const minutes = Math.round(delaySeconds / 60)
  if (minutes <= 0) return 'On time'
  return `+${minutes} min delay`
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
  const delay = delayText(props.data.delaySeconds)
  if (delay) lines.push(delay)
  return lines.join('<br/>')
}
