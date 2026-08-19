import { Fragment } from 'react'
import { STATUS_COLORS, STATUS_LABELS } from '../map/colors'
import { LAYER_DEFINITIONS } from '../layers/definitions'
import { LayerIcon } from './LayerIcon'
import { relativeTime } from '../util/time'
import { nearestSegmentIndex, type LonLat } from '../util/geo'
import type { Journey } from '../util/journey'
import type { Feature } from '../types/feature'
import type { LineDetail } from '../types/line'

interface DetailPanelProps {
  feature: Feature
  lineDetail: LineDetail | null
  journey: Journey | null
  onClose: () => void
}

const LIVE_COLOR = '#3987e5'

/** A colored divider row marking "now"/"here" within a schedule list. */
function LiveDivider({ label }: { label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 0' }}>
      <span style={{ flex: 1, height: 1.5, background: LIVE_COLOR }} />
      <span style={{ fontSize: 10, color: LIVE_COLOR, fontWeight: 700, letterSpacing: 0.3, flexShrink: 0 }}>{label}</span>
      <span style={{ flex: 1, height: 1.5, background: LIVE_COLOR }} />
    </div>
  )
}

/** hh:mm, or "hh:mm–hh:mm" when a stop's arrival and departure differ (a dwell, not a pass-through). */
function formatStopTime(arrival?: string, departure?: string): string {
  const a = arrival?.slice(0, 5)
  const d = departure?.slice(0, 5)
  if (a && d && a !== d) return `${a}–${d}`
  return d || a || '—'
}

/** Which segment of the journey's stop sequence the vehicle's live position falls on, if it's close enough to tell. */
function liveSegment(journey: Journey, liveCoords: LonLat | null): number | null {
  if (!liveCoords) return null
  // The journey's own stop-point IDs come from whichever route variant that
  // particular ServiceJourney ran on, which can differ from the canonical
  // route's variant (NeTEx often has distinct ScheduledStopPoint IDs per
  // platform/direction for the same physical station). Station names are
  // consistent across variants, so fall back to a name match when the id
  // lookup misses.
  const stopById = new Map(journey.route.stops.map((s) => [s.id, s]))
  const stopByName = new Map(journey.route.stops.map((s) => [s.name.trim().toLowerCase(), s]))
  const path: LonLat[] = []
  for (const s of journey.departure.stops) {
    const stop = stopById.get(s.stopId) ?? stopByName.get(s.stopName.trim().toLowerCase())
    if (!stop) return null
    path.push([stop.lon, stop.lat])
  }
  return nearestSegmentIndex(liveCoords, path)
}

function JourneyStops({ journey, liveCoords }: { journey: Journey; liveCoords: LonLat | null }) {
  const { stops } = journey.departure
  const segmentIdx = liveSegment(journey, liveCoords)
  return (
    <div style={{ maxHeight: 260, overflowY: 'auto' }}>
      {stops.map((s, i) => (
        <Fragment key={s.stopId}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 10,
              fontSize: 12.5,
              padding: '4px 0',
              borderBottom: i < stops.length - 1 ? '1px solid #2f3237' : 'none',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.stopName}</span>
            <span style={{ color: '#9a9ea5', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
              {formatStopTime(s.arrival, s.departure)}
            </span>
          </div>
          {segmentIdx === i && <LiveDivider label="TRAIN IS HERE" />}
        </Fragment>
      ))}
    </div>
  )
}

interface FlightEntry {
  flightNumber: string
  direction: 'departure' | 'arrival'
  airportCode: string
  airportName: string
  time: string
}

function formatKey(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())
}

function formatValue(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (typeof value === 'number') return value.toLocaleString()
  if (value == null || value === '') return '—'
  return String(value)
}

/** Layer-specific headline metric shown next to the status dot, in place of the generic OK/Warning/Critical label. */
function statusValueText(layer: string, data: Record<string, unknown>): string | null {
  switch (layer) {
    case 'train_vehicle': {
      const delaySeconds = data.delaySeconds
      if (typeof delaySeconds !== 'number') return null
      const minutes = Math.round(delaySeconds / 60)
      if (minutes <= 0) return 'On time'
      return `+${minutes} min delay`
    }
    case 'parking': {
      const { occupied, capacity } = data
      if (typeof occupied !== 'number' || typeof capacity !== 'number' || capacity <= 0) return null
      return `${Math.round((occupied / capacity) * 100)}% occupied`
    }
    case 'e_charging': {
      const available = data.available
      if (typeof available !== 'number') return null
      return `${available} free`
    }
    default:
      return null
  }
}

function formatFlightTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return `Today ${time}`
  const tomorrow = new Date(now)
  tomorrow.setDate(now.getDate() + 1)
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`
  return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`
}

function isFlightList(value: unknown): value is FlightEntry[] {
  return Array.isArray(value) && (value.length === 0 || typeof (value[0] as FlightEntry)?.flightNumber === 'string')
}

function FlightsList({ flights }: { flights: FlightEntry[] }) {
  if (flights.length === 0) {
    return <div style={{ fontSize: 13, color: '#9a9ea5' }}>No flights scheduled.</div>
  }
  const now = Date.now()
  const nowIdx = flights.findIndex((f) => new Date(f.time).getTime() > now)
  const dividerAt = nowIdx === -1 ? flights.length : nowIdx

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {flights.map((f, i) => (
        <Fragment key={`${f.flightNumber}-${f.time}-${i}`}>
          {dividerAt === i && <LiveDivider label="NOW" />}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 10,
              fontSize: 13,
              padding: '7px 0',
              borderBottom: i < flights.length - 1 ? '1px solid #2f3237' : 'none',
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
              <span style={{ color: f.direction === 'departure' ? '#e8e8e8' : '#9a9ea5', flexShrink: 0 }}>
                {f.direction === 'departure' ? '✈︎ →' : '✈︎ ←'}
              </span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.airportName}</span>
            </span>
            <span style={{ color: '#9a9ea5', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
              {formatFlightTime(f.time)}
            </span>
          </div>
        </Fragment>
      ))}
      {dividerAt === flights.length && <LiveDivider label="NOW" />}
    </div>
  )
}

export function DetailPanel({ feature, lineDetail, journey, onClose }: DetailPanelProps) {
  const props = feature.properties
  const layerDef = LAYER_DEFINITIONS.find((d) => d.id === props.layer)
  const status = props.status ?? 'unknown'

  const dataEntries = Object.entries(props.data).filter(([key]) => key !== 'flights')
  const statusValue = statusValueText(props.layer, props.data)
  const flights = isFlightList(props.data.flights) ? props.data.flights : null
  const showRoute = props.layer === 'train_vehicle' && props.ref?.lineId
  const liveCoords: LonLat | null =
    feature.geometry.type === 'Point' && feature.geometry.coordinates.length === 2
      ? (feature.geometry.coordinates as LonLat)
      : null

  return (
    <div
      style={{
        position: 'absolute',
        top: 12,
        right: 12,
        width: 300,
        maxHeight: 'calc(100% - 24px)',
        overflowY: 'auto',
        background: '#1c1e22',
        color: '#e8e8e8',
        borderRadius: 10,
        boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
        fontFamily: 'sans-serif',
        zIndex: 2,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '14px 14px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#9a9ea5', textTransform: 'uppercase', letterSpacing: 0.5 }}>
          <LayerIcon layer={props.layer} />
          {layerDef?.label ?? props.layer}
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: '#9a9ea5',
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
            padding: 2,
          }}
          aria-label="Close"
        >
          ✕
        </button>
      </div>

      <div style={{ padding: '0 14px 14px' }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>{props.name || 'Unnamed'}</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginBottom: 10 }}>
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: '50%',
              background: STATUS_COLORS[status],
              border: '1.5px solid #fcfcfb',
              boxSizing: 'border-box',
              flexShrink: 0,
            }}
          />
          {statusValue ?? STATUS_LABELS[status] ?? status}
        </div>

        <div style={{ fontSize: 12, color: '#9a9ea5', marginBottom: 12 }}>
          Data recorded {relativeTime(props.recordedAt)} · seen by server {relativeTime(props.updatedAt)}
        </div>

        <div style={{ borderTop: '1px solid #2f3237', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {dataEntries.map(([key, value]) => (
            <div key={key} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
              <span style={{ color: '#9a9ea5' }}>{formatKey(key)}</span>
              <span style={{ textAlign: 'right' }}>{formatValue(value)}</span>
            </div>
          ))}
        </div>

        {flights && (
          <div style={{ borderTop: '1px solid #2f3237', marginTop: 10, paddingTop: 10 }}>
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: '#9a9ea5', marginBottom: 6 }}>
              Flights · next 7 days
            </div>
            <FlightsList flights={flights} />
          </div>
        )}

        {showRoute && (
          <div style={{ borderTop: '1px solid #2f3237', marginTop: 10, paddingTop: 10 }}>
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: '#9a9ea5', marginBottom: 6 }}>
              Route
            </div>
            {!lineDetail && <div style={{ fontSize: 12.5, color: '#9a9ea5' }}>Loading route…</div>}
            {lineDetail && (
              <>
                <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>
                  {lineDetail.name}
                  {lineDetail.shortName && lineDetail.shortName !== lineDetail.name ? ` (${lineDetail.shortName})` : ''}
                </div>
                <div style={{ fontSize: 12, color: '#9a9ea5', marginBottom: 8 }}>
                  {lineDetail.transportMode} · line {lineDetail.publicCode || lineDetail.id}
                </div>
                {journey ? (
                  <>
                    <div style={{ fontSize: 12, color: '#9a9ea5', marginBottom: 6 }}>
                      Scheduled {journey.departure.departureTime.slice(0, 5)} · {journey.route.stops.length} stops
                    </div>
                    <JourneyStops journey={journey} liveCoords={liveCoords} />
                  </>
                ) : (
                  <div style={{ fontSize: 12.5, color: '#9a9ea5' }}>
                    No scheduled journey found matching this vehicle.
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
