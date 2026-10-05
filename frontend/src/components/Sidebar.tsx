// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

import { useLayoutEffect, useRef, useState } from 'react'
import { LAYER_DEFINITIONS } from '../layers/definitions'
import type { LayerOptions } from '../layers/types'
import type { Layer } from '../types/feature'
import { useFeatureStore } from '../store/featureStore'
import { LayerIcon } from './LayerIcon'

export const SIDEBAR_WIDTH = 280

interface SidebarProps {
  visibleLayers: Set<Layer>
  onToggle: (layer: Layer) => void
  layerOptions: Record<Layer, LayerOptions>
  onOptionsChange: (layer: Layer, options: LayerOptions) => void
  layerOrder: Layer[]
  onReorder: (order: Layer[]) => void
}


function DragHandle() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true" style={{ flexShrink: 0, cursor: 'grab' }}>
      {[2.5, 8, 13.5].flatMap((cy) =>
        [2.5, 7.5].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.3" fill="#6b6f76" />),
      )}
    </svg>
  )
}

export function Sidebar({ visibleLayers, onToggle, layerOptions, onOptionsChange, layerOrder, onReorder }: SidebarProps) {
  const layers = useFeatureStore((s) => s.layers)
  const connected = useFeatureStore((s) => s.connected)
  const [expanded, setExpanded] = useState<Set<Layer>>(new Set())

  // Custom pointer-driven drag (not native HTML5 DnD) so we can render a
  // floating clone that tracks the cursor and animate the other cards
  // sliding into place (FLIP) instead of just highlighting a drop target.
  const [dragId, setDragId] = useState<Layer | null>(null)
  const [pointerY, setPointerY] = useState(0)
  const dragOffsetYRef = useRef(0)
  const floatingRectRef = useRef({ left: 0, width: 0, height: 0 })
  const cardRefs = useRef<Map<Layer, HTMLDivElement>>(new Map())
  const prevTopsRef = useRef<Map<Layer, number>>(new Map())

  const toggleExpanded = (layer: Layer) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(layer)) next.delete(layer)
      else next.add(layer)
      return next
    })
  }

  // The drag reads the order from this ref, not from a closure: a closure
  // captured at drag start would keep building new orders from the stale
  // starting order, which is what made the cards jump around.
  const orderRef = useRef(layerOrder)
  orderRef.current = layerOrder
  const listRef = useRef<HTMLDivElement>(null)

  // Drag: the slots (each card's vertical range in the list) are measured
  // once, at drag start, from offsetTop — which ignores the FLIP transforms
  // still animating from the previous move. The card under the pointer
  // then decides the slot it should occupy.
  const startDrag = (id: Layer) => (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const el = cardRefs.current.get(id)
    const list = listRef.current
    if (!el || !list) return
    const rect = el.getBoundingClientRect()
    dragOffsetYRef.current = e.clientY - rect.top
    floatingRectRef.current = { left: rect.left, width: rect.width, height: rect.height }
    setDragId(id)
    setPointerY(e.clientY)

    const listRect = list.getBoundingClientRect()
    const slots = orderRef.current.map((layer) => {
      const card = cardRefs.current.get(layer)
      return { top: card?.offsetTop ?? 0, bottom: (card?.offsetTop ?? 0) + (card?.offsetHeight ?? 0) }
    })

    const onMove = (ev: MouseEvent) => {
      setPointerY(ev.clientY)
      const centerY = ev.clientY - dragOffsetYRef.current + floatingRectRef.current.height / 2 - listRect.top + list.scrollTop
      let slot = slots.findIndex((r) => centerY < r.bottom)
      if (slot === -1) slot = slots.length - 1
      if (slot < 0) return
      const current = orderRef.current
      const others = current.filter((x) => x !== id)
      const next = [...others.slice(0, slot), id, ...others.slice(slot)]
      if (next.join() !== current.join()) onReorder(next)
    }
    const onUp = () => {
      setDragId(null)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // FLIP: whenever the order changes (live, as the dragged card crosses
  // another one), snap each non-dragged card back to its previous screen
  // position with no transition, then release it into a transitioned move
  // to its new position — the "other layers slide in real time" effect.
  useLayoutEffect(() => {
    // offsetTop is the card's layout slot. getBoundingClientRect would include
    // the transform a card is still animating from the previous move, so the
    // far-away cards would be measured mid-slide and wobble.
    const newTops = new Map<Layer, number>()
    for (const [id, el] of cardRefs.current) newTops.set(id, el.offsetTop)

    for (const [id, el] of cardRefs.current) {
      if (id === dragId) continue
      const prevTop = prevTopsRef.current.get(id)
      const newTop = newTops.get(id)
      if (prevTop == null || newTop == null || prevTop === newTop) continue
      const delta = prevTop - newTop
      el.style.transition = 'none'
      el.style.transform = `translateY(${delta}px)`
      requestAnimationFrame(() => {
        el.style.transition = 'transform 220ms ease'
        el.style.transform = ''
      })
    }
    prevTopsRef.current = newTops
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerOrder])

  const orderedDefs = layerOrder
    .map((id) => LAYER_DEFINITIONS.find((d) => d.id === id))
    .filter((d): d is (typeof LAYER_DEFINITIONS)[number] => d != null)

  const draggedDef = dragId ? LAYER_DEFINITIONS.find((d) => d.id === dragId) : null

  return (
    <div
      style={{
        width: SIDEBAR_WIDTH,
        flexShrink: 0,
        height: '100%',
        background: '#1c1e22',
        color: '#e8e8e8',
        fontFamily: 'sans-serif',
        borderRight: '1px solid #2f3237',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ padding: '16px 18px', borderBottom: '1px solid #2f3237' }}>
        <div style={{ fontSize: 16, fontWeight: 700 }}>Mobility Control Center</div>
        <div style={{ fontSize: 12, marginTop: 4, color: connected ? '#2ecc8f' : '#ff5c5c' }}>
          ● {connected ? 'live' : 'disconnected'}
        </div>
      </div>

      <div ref={listRef} style={{ padding: '14px 18px', overflowY: 'auto', flex: 1, position: 'relative' }}>
        <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.6, color: '#9a9ea5', marginBottom: 10 }}>
          Layers
        </div>
        {orderedDefs.map((def) => {
          const visible = visibleLayers.has(def.id)
          const isExpanded = expanded.has(def.id)
          const isDragging = dragId === def.id
          const options = layerOptions[def.id] ?? def.defaultOptions
          const OptionsPanel = def.OptionsPanel

          return (
            <div
              key={def.id}
              ref={(el) => {
                if (el) cardRefs.current.set(def.id, el)
                else cardRefs.current.delete(def.id)
              }}
              style={{
                borderRadius: 8,
                margin: '0 -10px 4px',
                overflow: 'hidden',
                visibility: isDragging ? 'hidden' : 'visible',
              }}
            >
              <div
                role="button"
                tabIndex={0}
                onClick={() => onToggle(def.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onToggle(def.id)
                  }
                }}
                className="layer-card"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 10px',
                  cursor: 'pointer',
                  fontSize: 14,
                  opacity: visible ? 1 : 0.5,
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span onMouseDown={startDrag(def.id)} onClick={(e) => e.stopPropagation()} title="Drag to reorder">
                    <DragHandle />
                  </span>
                  <input type="checkbox" checked={visible} readOnly tabIndex={-1} style={{ pointerEvents: 'none' }} />
                  <LayerIcon layer={def.id} />
                  {def.label}
                </span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#9a9ea5', fontVariantNumeric: 'tabular-nums' }}>
                    {layers[def.id]?.size ?? 0}
                  </span>
                  {/* Only the arrow opens the options; the rest of the row toggles the layer. */}
                  {OptionsPanel && (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={isExpanded ? 'Hide options' : 'Show options'}
                      title="Options"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleExpanded(def.id)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          e.stopPropagation()
                          toggleExpanded(def.id)
                        }
                      }}
                      style={{
                        display: 'inline-block',
                        padding: '0 4px',
                        cursor: 'pointer',
                        transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                        transition: 'transform 150ms ease',
                        color: '#9a9ea5',
                        fontSize: 11,
                      }}
                    >
                      ▶
                    </span>
                  )}
                </span>
              </div>

              {isExpanded && OptionsPanel && (
                <div style={{ padding: '2px 10px 12px' }} onClick={(e) => e.stopPropagation()}>
                  <OptionsPanel options={options} onChange={(next) => onOptionsChange(def.id, next)} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {draggedDef && (
        <div
          style={{
            position: 'fixed',
            left: floatingRectRef.current.left,
            width: floatingRectRef.current.width,
            top: pointerY - dragOffsetYRef.current,
            zIndex: 1000,
            pointerEvents: 'none',
            background: '#2a2d33',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            transform: 'scale(1.02)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '10px 10px',
              fontSize: 14,
            }}
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <DragHandle />
              <input type="checkbox" checked={visibleLayers.has(draggedDef.id)} readOnly />
              <LayerIcon layer={draggedDef.id} />
              {draggedDef.label}
            </span>
            <span style={{ color: '#9a9ea5', fontVariantNumeric: 'tabular-nums' }}>
              {layers[draggedDef.id]?.size ?? 0}
            </span>
          </div>
        </div>
      )}

      <style>{`
        .layer-card:hover { background: #24272c; }
        .layer-card:focus-visible { outline: 2px solid #6da7ec; outline-offset: -2px; }
      `}</style>
    </div>
  )
}
