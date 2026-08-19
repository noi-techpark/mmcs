// Renders per-layer, per-status icon images at build time (canvas, not
// SDF): shape carries layer identity, fill color carries status. Plain
// canvas fills anti-alias naturally and can carry a baked drop shadow —
// unlike a binary-alpha SDF mask, which reads jagged at small sizes.
import type * as maplibregl from 'maplibre-gl'
import type { Layer } from '../types/feature'
import type { ColorRule } from '../layers/types'

const RENDER_SIZE = 128
export const ICON_DISPLAY_SIZE = 24
export const ICON_RENDER_SCALE = ICON_DISPLAY_SIZE / RENDER_SIZE

function newCtx(): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas')
  canvas.width = RENDER_SIZE
  canvas.height = RENDER_SIZE
  return canvas.getContext('2d')!
}

function withShadow(ctx: CanvasRenderingContext2D, draw: () => void) {
  ctx.save()
  ctx.shadowColor = 'rgba(20,18,16,0.5)'
  ctx.shadowBlur = 14
  ctx.shadowOffsetY = 5
  draw()
  ctx.restore()
}

/**
 * Fills `shape` (with a drop shadow, for separation from the basemap
 * underneath) then strokes it with a crisp white ring (no shadow, so it
 * stays sharp) — the ring is what keeps a glyph readable when it overlaps
 * another layer's icon or a label bubble, not just the basemap.
 */
function withOutline(ctx: CanvasRenderingContext2D, color: string, shape: () => void) {
  withShadow(ctx, () => {
    ctx.fillStyle = color
    shape()
    ctx.fill()
  })
  ctx.lineWidth = 7
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.lineJoin = 'round'
  shape()
  ctx.stroke()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function parkingIcon(color: string): ImageData {
  const ctx = newCtx()
  withOutline(ctx, color, () => roundRect(ctx, 20, 20, 88, 88, 24))
  ctx.fillStyle = '#ffffff'
  ctx.font = '700 60px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('P', 64, 68)
  return ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE)
}

function trainIcon(color: string): ImageData {
  const ctx = newCtx()
  const shape = () => {
    roundRect(ctx, 28, 16, 72, 76, 20)
    ctx.moveTo(58, 100)
    ctx.arc(48, 100, 10, 0, Math.PI * 2)
    ctx.moveTo(90, 100)
    ctx.arc(80, 100, 10, 0, Math.PI * 2)
  }
  withOutline(ctx, color, shape)
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, 38, 28, 52, 30, 8)
  ctx.fill()
  return ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE)
}

// A circle badge with a white bolt inside — a third distinct base shape
// (parking is a rounded square, train a rounded rect + wheels), and a
// bare bolt outline reads too jagged/noisy at marker size on its own, so
// it's a simple solid glyph inside the circle instead, matching the
// white-accent treatment (letter/window) the other two icons use.
function eChargingIcon(color: string): ImageData {
  const ctx = newCtx()
  withOutline(ctx, color, () => {
    ctx.beginPath()
    ctx.arc(64, 64, 44, 0, Math.PI * 2)
  })
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(68, 30)
  ctx.lineTo(44, 66)
  ctx.lineTo(58, 66)
  ctx.lineTo(50, 98)
  ctx.lineTo(84, 58)
  ctx.lineTo(66, 58)
  ctx.closePath()
  ctx.fill()
  return ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE)
}

// A diamond badge (the fourth distinct base shape, after square/rect/
// circle) with a simple hand-drawn top-down plane silhouette — fuselage,
// swept wings, small tail fins — rather than a text glyph, since emoji
// font rendering isn't reliably monochrome/colorable across browsers.
function flightIcon(color: string): ImageData {
  const ctx = newCtx()
  withOutline(ctx, color, () => {
    ctx.beginPath()
    ctx.moveTo(64, 16)
    ctx.lineTo(112, 64)
    ctx.lineTo(64, 112)
    ctx.lineTo(16, 64)
    ctx.closePath()
  })
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, 58, 20, 12, 72, 6)
  ctx.fill()
  const wing = (dir: 1 | -1) => {
    ctx.beginPath()
    ctx.moveTo(64 + dir * 6, 58)
    ctx.lineTo(64 + dir * 46, 86)
    ctx.lineTo(64 + dir * 6, 72)
    ctx.closePath()
    ctx.fill()
  }
  wing(1)
  wing(-1)
  const tail = (dir: 1 | -1) => {
    ctx.beginPath()
    ctx.moveTo(64 + dir * 6, 78)
    ctx.lineTo(64 + dir * 24, 94)
    ctx.lineTo(64 + dir * 6, 88)
    ctx.closePath()
    ctx.fill()
  }
  tail(1)
  tail(-1)
  return ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE)
}

const DRAWERS: Record<string, (color: string) => ImageData> = {
  parking: parkingIcon,
  e_charging: eChargingIcon,
  train_vehicle: trainIcon,
  bus_vehicle: trainIcon,
  on_demand_vehicle: trainIcon,
  flight: flightIcon,
}

export function iconImageId(layer: Layer, colorKey: string): string {
  return `icon-${layer}-${colorKey}`
}

/** Renders and registers this layer's icon, once per entry in its color rules. */
export function registerIcons(map: maplibregl.Map, layer: Layer, colorRules: ColorRule[]) {
  const draw = DRAWERS[layer]
  if (!draw) return
  for (const rule of colorRules) {
    map.addImage(iconImageId(layer, rule.key), draw(rule.color))
  }
}
