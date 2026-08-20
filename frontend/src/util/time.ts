/** "On time" / "+1m" / "+1m 30s" / "+45s" — seconds only shown once delay drops under a minute. */
export function formatDelay(delaySeconds: number): string {
  const totalSeconds = Math.round(delaySeconds)
  if (totalSeconds <= 0) return 'On time'
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes === 0) return `+${seconds}s`
  if (seconds === 0) return `+${minutes}m`
  return `+${minutes}m ${seconds}s`
}

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
