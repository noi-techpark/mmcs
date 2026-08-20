import { Fragment, useState } from 'react'
import { STATUS_COLORS, STATUS_LABELS } from '../map/colors'
import { LAYER_DEFINITIONS } from '../layers/definitions'
import { LayerIcon } from './LayerIcon'
import { relativeTime } from '../util/time'
import { nearestSegmentIndex, type LonLat } from '../util/geo'
import type { Feature } from '../types/feature'
import type { Journey, EstimatedTimetable } from '../types/line'

interface DetailPanelProps {
  feature: Feature
  journey: Journey | null
  /** True while /api/journey is in flight for the current selection — distinct from journey===null, which also means "no matching journey found". */
  journeyLoading: boolean
  estimatedTimetable: EstimatedTimetable | null
  etLoading: boolean
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

/** A clickable section label toggling its own collapsed state, with a chevron indicating which way. */
function SectionHeader({ title, collapsed, onToggle }: { title: string; collapsed: boolean; onToggle: () => void }) {
  return (
    <div
      onClick={onToggle}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onToggle()
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 6,
        cursor: 'pointer',
        userSelect: 'none',
        fontSize: 12,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        color: '#9a9ea5',
        marginBottom: collapsed ? 0 : 6,
      }}
    >
      {title}
      <span style={{ fontSize: 9, transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform 0.15s' }}>▾</span>
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
  const stopById = new Map(journey.stops.map((s) => [s.id, s]))
  const stopByName = new Map(journey.stops.map((s) => [s.name.trim().toLowerCase(), s]))
  const path: LonLat[] = []
  for (const s of journey.departure.stops) {
    const stop = stopById.get(s.stopId) ?? stopByName.get(s.stopName.trim().toLowerCase())
    if (!stop) return null
    path.push([stop.lon, stop.lat])
  }
  return nearestSegmentIndex(liveCoords, path)
}

function JourneyStops({ journey, liveCoords, hereLabel }: { journey: Journey; liveCoords: LonLat | null; hereLabel: string }) {
  const { stops } = journey.departure
  const segmentIdx = liveSegment(journey, liveCoords)
  return (
    <div style={{ flex: 1, minHeight: 120, overflowY: 'auto' }}>
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
          {segmentIdx === i && <LiveDivider label={hereLabel} />}
        </Fragment>
      ))}
    </div>
  )
}

/** hh:mm from a SIRI-ET timestamp, aimed vs. expected differing by more than a minute reads as a delay. */
function formatEstimatedTime(aimed?: string, expected?: string): { text: string; delayed: boolean } {
  const time = (expected || aimed)?.slice(11, 16)
  if (!time) return { text: '—', delayed: false }
  const delayed = !!aimed && !!expected && aimed.slice(0, 16) !== expected.slice(0, 16)
  return { text: time, delayed }
}

function EstimatedCalls({ timetable }: { timetable: EstimatedTimetable }) {
  const calls = timetable.EstimatedCalls.EstimatedCall
  return (
    <div style={{ flex: 1, minHeight: 120, overflowY: 'auto' }}>
      {calls.map((c, i) => {
        const arr = formatEstimatedTime(c.AimedArrivalTime, c.ExpectedArrivalTime)
        const dep = formatEstimatedTime(c.AimedDepartureTime, c.ExpectedDepartureTime)
        const timing = dep.text !== '—' ? dep : arr
        return (
          <div
            key={`${c.StopPointRef}-${i}`}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              gap: 10,
              fontSize: 12.5,
              padding: '4px 0',
              borderBottom: i < calls.length - 1 ? '1px solid #2f3237' : 'none',
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.StopPointName}</span>
            <span
              style={{
                color: timing.delayed ? STATUS_COLORS.warning : '#9a9ea5',
                flexShrink: 0,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {timing.text}
            </span>
          </div>
        )
      })}
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

function isSituation(layer: string, data: Record<string, unknown>): boolean {
  return layer === 'bus_alert' && Array.isArray(data.affectedStops)
}

function SituationDetail({ data }: { data: Record<string, unknown> }) {
  const affectedStops = Array.isArray(data.affectedStops) ? (data.affectedStops as string[]) : []
  return (
    <>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
        {typeof data.alertCause === 'string' && data.alertCause && (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
            <span style={{ color: '#9a9ea5' }}>Cause</span>
            <span style={{ textAlign: 'right' }}>{formatValue(data.alertCause)}</span>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
          <span style={{ color: '#9a9ea5' }}>Status</span>
          <span style={{ textAlign: 'right' }}>{formatValue(data.progress)}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
          <span style={{ color: '#9a9ea5' }}>Valid</span>
          <span style={{ textAlign: 'right' }}>
            {typeof data.validFrom === 'string' ? data.validFrom.slice(0, 10) : '—'}
            {' – '}
            {typeof data.validTo === 'string' ? data.validTo.slice(0, 10) : '—'}
          </span>
        </div>
      </div>
      {affectedStops.length > 0 && (
        <div style={{ borderTop: '1px solid #2f3237', paddingTop: 10 }}>
          <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: '#9a9ea5', marginBottom: 6 }}>
            Affected stops
          </div>
          <div style={{ fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {affectedStops.map((s, i) => (
              <div key={i}>{s}</div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

export function DetailPanel({ feature, journey, journeyLoading, estimatedTimetable, etLoading, onClose }: DetailPanelProps) {
  const props = feature.properties
  const layerDef = LAYER_DEFINITIONS.find((d) => d.id === props.layer)
  const status = props.status ?? 'unknown'
  const situation = isSituation(props.layer, props.data)
  const [routeCollapsed, setRouteCollapsed] = useState(false)
  const [etCollapsed, setEtCollapsed] = useState(false)

  const dataEntries = situation ? [] : Object.entries(props.data).filter(([key]) => key !== 'flights')
  const statusValue = statusValueText(props.layer, props.data)
  const flights = isFlightList(props.data.flights) ? props.data.flights : null
  const showRoute = (props.layer === 'train_vehicle' || props.layer === 'bus_vehicle') && props.ref?.lineId
  const showEstimatedTimetable = props.layer === 'bus_vehicle'
  const liveCoords: LonLat | null =
    feature.geometry.type === 'Point' && feature.geometry.coordinates.length === 2
      ? (feature.geometry.coordinates as LonLat)
      : null

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 300,
        display: 'flex',
        flexDirection: 'column',
        background: '#1c1e22',
        color: '#e8e8e8',
        boxShadow: '-4px 0 20px rgba(0,0,0,0.35)',
        fontFamily: 'sans-serif',
        zIndex: 2,
      }}
    >
      {/* Header (layer label, close button, name) is fixed — flexShrink: 0
          keeps it out of the scrolling body below regardless of content length. */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid #2f3237' }}>
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
        <div style={{ fontSize: 16, fontWeight: 700, padding: '0 14px 12px' }}>{props.name || 'Unnamed'}</div>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '14px', display: 'flex', flexDirection: 'column' }}>
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

        {situation && <SituationDetail data={props.data} />}

        {flights && (
          <div style={{ borderTop: '1px solid #2f3237', marginTop: 10, paddingTop: 10 }}>
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: '#9a9ea5', marginBottom: 6 }}>
              Flights · next 7 days
            </div>
            <FlightsList flights={flights} />
          </div>
        )}

        {/* Live ET, when available, is more useful than the static schedule
            it's paired with — shown first rather than after it. */}
        {showEstimatedTimetable && estimatedTimetable && !etLoading && (
          <div
            style={{
              borderTop: '1px solid #2f3237',
              marginTop: 10,
              paddingTop: 10,
              ...(etCollapsed ? {} : { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }),
            }}
          >
            <SectionHeader title="Live ETA (SIRI-ET)" collapsed={etCollapsed} onToggle={() => setEtCollapsed((c) => !c)} />
            {!etCollapsed && <EstimatedCalls timetable={estimatedTimetable} />}
          </div>
        )}

        {showRoute && (
          <div
            style={{
              borderTop: '1px solid #2f3237',
              marginTop: 10,
              paddingTop: 10,
              ...(journey && !routeCollapsed ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : {}),
            }}
          >
            <SectionHeader title="Route" collapsed={routeCollapsed} onToggle={() => setRouteCollapsed((c) => !c)} />
            {!routeCollapsed && (
              <>
                {journeyLoading && <div style={{ fontSize: 12.5, color: '#9a9ea5' }}>Loading route…</div>}
                {!journeyLoading && !journey && (
                  <div style={{ fontSize: 12.5, color: '#9a9ea5' }}>No scheduled journey found matching this vehicle.</div>
                )}
                {!journeyLoading && journey && (
                  <>
                    <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>
                      {journey.lineName}
                      {journey.shortName && journey.shortName !== journey.lineName ? ` (${journey.shortName})` : ''}
                    </div>
                    <div style={{ fontSize: 12, color: '#9a9ea5', marginBottom: 8 }}>
                      {journey.transportMode} · line {journey.publicCode || journey.lineId}
                    </div>
                    <div style={{ fontSize: 12, color: '#9a9ea5', marginBottom: 6 }}>
                      Scheduled {journey.departure.departureTime.slice(0, 5)} · {journey.stops.length} stops
                    </div>
                    <JourneyStops
                      journey={journey}
                      liveCoords={liveCoords}
                      hereLabel={props.layer === 'bus_vehicle' ? 'BUS IS HERE' : 'TRAIN IS HERE'}
                    />
                  </>
                )}
              </>
            )}
          </div>
        )}

        {/* ET section for the loading/not-found states — kept after Route
            since only a confirmed ET result earns the "show first" spot above. */}
        {showEstimatedTimetable && (etLoading || !estimatedTimetable) && (
          <div style={{ borderTop: '1px solid #2f3237', marginTop: 10, paddingTop: 10 }}>
            <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: '#9a9ea5', marginBottom: 6 }}>
              Live ETA (SIRI-ET)
            </div>
            {etLoading && <div style={{ fontSize: 12.5, color: '#9a9ea5' }}>Loading ETA…</div>}
            {!etLoading && !estimatedTimetable && (
              <div style={{ fontSize: 12.5, color: '#9a9ea5' }}>No estimated timetable found for this trip.</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
