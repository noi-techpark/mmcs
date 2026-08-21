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

/** Like withOutline, but for a shape already built as a Path2D (used for the train/bus glyphs, so their body outline is drawn from the exact same path data as the sidebar SVG in LayerIcon.tsx, just scaled up). */
function withOutlinePath(ctx: CanvasRenderingContext2D, color: string, path: Path2D) {
  withShadow(ctx, () => {
    ctx.fillStyle = color
    ctx.fill(path)
  })
  ctx.lineWidth = 7
  ctx.strokeStyle = 'rgba(255,255,255,0.95)'
  ctx.lineJoin = 'round'
  ctx.stroke(path)
}

function roundRectPath(x: number, y: number, w: number, h: number, r: number): Path2D {
  const path = new Path2D()
  path.moveTo(x + r, y)
  path.arcTo(x + w, y, x + w, y + h, r)
  path.arcTo(x + w, y + h, x, y + h, r)
  path.arcTo(x, y + h, x, y, r)
  path.arcTo(x, y, x + w, y, r)
  path.closePath()
  return path
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

// The same glyph as LayerIcon.tsx's train_vehicle case, scaled 8x from its
// 16x16 SVG viewBox to this module's 128x128 render size — kept in lockstep
// with the sidebar rather than redrawn as an approximation, so the map icon
// and the legend icon are the same shape.
const TRAIN_BODY_D = 'M20 52 A44 44 0 0 1 108 52 V96 A10 10 0 0 1 98 106 H30 A10 10 0 0 1 20 96 Z'
const TRAIN_RAILS_D = 'M58 98 L50 98 L8 126 L24 126 Z M70 98 L78 98 L120 126 L104 126 Z'

function trainIcon(color: string): ImageData {
  const ctx = newCtx()
  withOutlinePath(ctx, color, new Path2D(TRAIN_BODY_D))
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, 39, 34, 50, 32, 6)
  ctx.fill()
  ctx.fillRect(34, 78, 14, 14)
  ctx.fillRect(80, 78, 14, 14)
  // rails, beneath the vehicle — plain fill (no outline stroke), in the
  // same status color so they read as attached to it
  ctx.fillStyle = color
  ctx.fill(new Path2D(TRAIN_RAILS_D))
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

// The same glyph as LayerIcon.tsx's bus_vehicle case, scaled 8x from its
// 16x16 SVG viewBox — a plain rounded-rect body, one window band, and two
// wheel circles bumping out beneath it, drawn in that same order (body,
// window, wheels) so the wheels sit on top of the body fill as they do in
// the sidebar SVG.
function busIcon(color: string): ImageData {
  const ctx = newCtx()
  withOutlinePath(ctx, color, roundRectPath(8, 24, 112, 76, 16))
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, 20, 36, 88, 20, 4)
  ctx.fill()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(36, 100, 14, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(92, 100, 14, 0, Math.PI * 2)
  ctx.fill()
  return ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE)
}

// A triangle badge (the sixth base shape) with a white exclamation mark —
// for SIRI-SX service alerts, which aren't vehicles so shouldn't share the
// bus/train silhouettes.
function alertIcon(color: string): ImageData {
  const ctx = newCtx()
  withOutline(ctx, color, () => {
    ctx.beginPath()
    ctx.moveTo(64, 14)
    ctx.lineTo(116, 108)
    ctx.lineTo(12, 108)
    ctx.closePath()
  })
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, 57, 46, 14, 34, 6)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(64, 92, 7, 0, Math.PI * 2)
  ctx.fill()
  return ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE)
}

// A hexagon badge (the seventh base shape) with a white raindrop glyph —
// weather stations report both temperature and precipitation, so a
// generic drop (rather than a thermometer) reads as "weather" broadly
// instead of implying only one of the two.
function weatherIcon(color: string): ImageData {
  const ctx = newCtx()
  const hex = new Path2D()
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 3) * i - Math.PI / 2
    const x = 64 + 48 * Math.cos(angle)
    const y = 64 + 48 * Math.sin(angle)
    if (i === 0) hex.moveTo(x, y)
    else hex.lineTo(x, y)
  }
  hex.closePath()
  withOutlinePath(ctx, color, hex)
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(64, 30)
  ctx.quadraticCurveTo(94, 76, 64, 96)
  ctx.quadraticCurveTo(34, 76, 64, 30)
  ctx.closePath()
  ctx.fill()
  return ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE)
}

// A diamond badge (the eighth base shape, matching road-sign framing) with
// two white lane-stripe dashes — traffic sensors classify by lane/road
// flow, so a road-adjacent shape reads as "traffic" distinctly from the
// weather hexagon or the parking square.
function trafficIcon(color: string): ImageData {
  const ctx = newCtx()
  const diamond = new Path2D()
  diamond.moveTo(64, 10)
  diamond.lineTo(118, 64)
  diamond.lineTo(64, 118)
  diamond.lineTo(10, 64)
  diamond.closePath()
  withOutlinePath(ctx, color, diamond)
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, 58, 34, 12, 26, 4)
  ctx.fill()
  roundRect(ctx, 58, 68, 12, 26, 4)
  ctx.fill()
  return ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE)
}

const DRAWERS: Record<string, (color: string) => ImageData> = {
  parking: parkingIcon,
  e_charging: eChargingIcon,
  train_vehicle: trainIcon,
  bus_vehicle: busIcon,
  bus_alert: alertIcon,
  on_demand_vehicle: busIcon,
  flight: flightIcon,
  weather_station: weatherIcon,
  traffic_station: trafficIcon,
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

