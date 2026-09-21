// Generic "Filters…" control anchored top-left of the map. Fully
// layer-agnostic: it just walks LAYER_DEFINITIONS for whichever ones
// declare `filters` (see layers/types.ts) and renders each FilterInstance's
// own Control — the filter logic and UI live entirely in filters/*, this
// component only handles panel open/close, value plumbing into
// LayerOptions.filterValues, and the active-filter tags.
import { useEffect, useRef, useState } from 'react'
import { LAYER_DEFINITIONS } from '../layers/definitions'
import type { LayerOptions } from '../layers/types'
import type { Layer } from '../types/feature'

interface FiltersControlProps {
  visibleLayers: Set<Layer>
  layerOptions: Record<Layer, LayerOptions>
  onOptionsChange: (layer: Layer, options: LayerOptions) => void
}

const ALL_LAYERS_WITH_FILTERS = LAYER_DEFINITIONS.filter((d) => (d.filters?.length ?? 0) > 0)

function filterKey(layer: Layer, filterId: string): string {
  return `${layer}|${filterId}`
}

export function FiltersControl({ visibleLayers, layerOptions, onOptionsChange }: FiltersControlProps) {
  const [open, setOpen] = useState(false)
  // Set (briefly) when a tag is clicked, so the matching filter row in the
  // panel below can scroll into view and flash a highlight — lets the user
  // jump straight to adjusting a value instead of hunting through sections.
  const [focusedKey, setFocusedKey] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    return () => window.removeEventListener('mousedown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (!focusedKey) return
    rowRefs.current.get(focusedKey)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    const timeout = setTimeout(() => setFocusedKey(null), 1400)
    return () => clearTimeout(timeout)
  }, [focusedKey])

  // Only layers the user actually has turned on are worth filtering — a
  // hidden layer's filter would have no visible effect.
  const layersWithFilters = ALL_LAYERS_WITH_FILTERS.filter((d) => visibleLayers.has(d.id))

  if (layersWithFilters.length === 0) return null

  const setFilterValue = (layer: Layer, filterId: string, value: unknown) => {
    const options = layerOptions[layer]
    onOptionsChange(layer, { ...options, filterValues: { ...options.filterValues, [filterId]: value } })
  }

  const openFilter = (layer: Layer, filterId: string) => {
    setOpen(true)
    setFocusedKey(filterKey(layer, filterId))
  }

  const activeTags = layersWithFilters.flatMap((def) =>
    (def.filters ?? []).flatMap((f) => {
      const value = layerOptions[def.id]?.filterValues?.[f.id] ?? f.defaultValue
      if (!f.isActive(value)) return []
      return [{ layer: def.id, layerLabel: def.label, filterId: f.id, label: f.label, text: f.describe(value), defaultValue: f.defaultValue }]
    }),
  )

  return (
    <div ref={rootRef} style={{ position: 'absolute', top: 14, left: 14, zIndex: 2, display: 'flex', flexDirection: 'column', gap: 6, fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            background: '#1c1e22',
            color: '#e8e8e8',
            border: '1px solid #2f3237',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
            boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
          }}
        >
          Filters{activeTags.length > 0 ? ` (${activeTags.length})` : '…'}
        </button>
        {activeTags.map((tag) => (
          <span
            key={`${tag.layer}-${tag.filterId}`}
            role="button"
            tabIndex={0}
            onClick={() => openFilter(tag.layer, tag.filterId)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                openFilter(tag.layer, tag.filterId)
              }
            }}
            title="Click to adjust"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: '#24272c',
              color: '#e8e8e8',
              border: '1px solid #2f3237',
              borderRadius: 14,
              padding: '4px 6px 4px 10px',
              fontSize: 12,
              boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
              cursor: 'pointer',
            }}
          >
            <span style={{ color: '#9a9ea5' }}>{tag.layerLabel}</span>
            {tag.label}: {tag.text}
            <button
              onClick={(e) => {
                e.stopPropagation()
                setFilterValue(tag.layer, tag.filterId, tag.defaultValue)
              }}
              aria-label={`Clear ${tag.layerLabel} ${tag.label} filter`}
              style={{
                background: 'none',
                border: 'none',
                color: '#9a9ea5',
                cursor: 'pointer',
                fontSize: 12,
                lineHeight: 1,
                padding: '0 2px',
              }}
            >
              ✕
            </button>
          </span>
        ))}
      </div>

      {open && (
        <div
          style={{
            background: '#1c1e22',
            color: '#e8e8e8',
            border: '1px solid #2f3237',
            borderRadius: 8,
            padding: '10px 14px 14px',
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            maxHeight: '70vh',
            overflowY: 'auto',
          }}
        >
          {layersWithFilters.map((def) => (
            <div key={def.id}>
              <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.5, color: '#9a9ea5', marginBottom: 8 }}>
                {def.label}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(def.filters ?? []).map((f) => {
                  const value = layerOptions[def.id]?.filterValues?.[f.id] ?? f.defaultValue
                  const key = filterKey(def.id, f.id)
                  const highlighted = focusedKey === key
                  return (
                    <div
                      key={f.id}
                      ref={(el) => {
                        if (el) rowRefs.current.set(key, el)
                        else rowRefs.current.delete(key)
                      }}
                      style={{
                        borderRadius: 6,
                        padding: 6,
                        margin: -6,
                        boxShadow: highlighted ? '0 0 0 2px #6da7ec' : '0 0 0 2px transparent',
                        transition: 'box-shadow 200ms ease',
                      }}
                    >
                      <div style={{ fontSize: 12.5, marginBottom: 4 }}>{f.label}</div>
                      <f.Control value={value} onChange={(v) => setFilterValue(def.id, f.id, v)} />
                    </div>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
