export function relativeTime(iso: string): string {
  if (!iso) return 'unknown'
  const diffSec = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const min = Math.round(diffSec / 60)
  if (min < 60) return `${min} min ago`
  const hr = Math.round(min / 60)
  return `${hr}h ago`
}
