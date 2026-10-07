// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { createPointLayer } from './pointLayer'
import { DISPLACE_FROM_ZOOM } from '../map/displace'
import { hslToHex } from '../map/colorGradient'
import { PALETTE_SATURATION, STATUS_COLORS } from '../map/colors'
import type { ColorRule } from './types'
import type { Feature } from '../types/feature'

const HUE_YELLOW = 60

// Yellow at the shared PALETTE_LIGHTNESS (0.60) is the one hue in this
// wheel that reads as noticeably lighter than the rest: HSL's "L" isn't
// perceptually uniform across hues, and yellow (high R+G) ends up with a
// relative luminance around 0.83 at L=0.60 vs ~0.71–0.45 for the orange/
// green/red the rest of the palette uses at that same L — close enough to
// the map's white-washed basemap to wash out. A dedicated, darker lightness
// (yielding ~0.72, matching STATUS_COLORS.warning's orange) fixes that
// without changing the hue or touching the icon's outline/shadow.
const roadworkColor = hslToHex(HUE_YELLOW, PALETTE_SATURATION, 0.46)

function hasTag(props: Feature['properties'], tag: string): boolean {
  const tags = props.data.tags
  return Array.isArray(tags) && tags.includes(tag)
}

// SIRI-SX situations (backend/internal/feeds/siri/sx.go) are always about
// the public-transport network — resolved to a stop on a bus/train line —
// tagged by their Source ("siri-lite:sx"), unlike the tourism Announcement
// alerts (road-work, closures, ...) sharing this layer (Source
// "tourism:<a22|PROVINCE_BZ>").
function isTransitAlert(props: Feature['properties']): boolean {
  return props.source.startsWith('siri')
}

// Tourism Announcement items carry a TagIds list (see
// backend/internal/feeds/tourism/normalize.go Data["tags"]); SIRI-SX
// alerts carry none, so they're only ever matched by isTransitAlert.
// Closure checked before road-work: a closure that happens to be for road
// work should still read as a hard stop, not a caution sign.
const ALERT_COLOR_RULES: ColorRule[] = [
  { key: 'closure', color: STATUS_COLORS.critical, score: 100, test: (p) => hasTag(p, 'traffic-event:closure') },
  { key: 'roadwork', color: roadworkColor, score: 40, test: (p) => hasTag(p, 'traffic-event:road-work') },
  { key: 'transit', color: STATUS_COLORS.warning, score: 0, test: isTransitAlert },
  { key: 'alert', color: STATUS_COLORS.warning, score: 0, test: () => true },
]

// SIRI-SX service alerts/disruptions — placed at the first affected stop
// the backend could resolve to a NeTEx Quay coordinate (see
// backend/internal/feeds/siri/sx.go); situations with no resolvable stop
// never reach the frontend at all. Also carries A22/Province of Bolzano
// road-traffic announcements (backend/internal/feeds/tourism), merged into
// the same layer id.
export const situationsLayer = createPointLayer('bus_alert', 'Service Alerts', {}, ALERT_COLOR_RULES, true, undefined, [], DISPLACE_FROM_ZOOM)
