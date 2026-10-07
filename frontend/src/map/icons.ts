// SPDX-FileCopyrightText: 2026 NOI Techpark
//
// SPDX-License-Identifier: AGPL-3.0-or-later

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

// Same warning-triangle badge as alertIcon, but with a road-work glyph
// (diagonal hazard stripes) instead of the exclamation mark — tagged
// "traffic-event:road-work" announcements (see layers/situations.ts), kept
// in yellow rather than the generic alert's orange so it reads as
// "planned work", not "danger".
function roadworkIcon(color: string): ImageData {
  const ctx = newCtx()
  withOutline(ctx, color, () => {
    ctx.beginPath()
    ctx.moveTo(64, 14)
    ctx.lineTo(116, 108)
    ctx.lineTo(12, 108)
    ctx.closePath()
  })
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 9
  ctx.lineCap = 'round'
  for (const dx of [-16, 0, 16]) {
    ctx.beginPath()
    ctx.moveTo(50 + dx, 92)
    ctx.lineTo(66 + dx, 56)
    ctx.stroke()
  }
  return ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE)
}

// Same warning-triangle badge as alertIcon, but with a small bus
// silhouette instead of the exclamation mark — SIRI-SX alerts (see
// layers/situations.ts) are always about the public-transport network
// (resolved to a stop on a bus/train line), unlike the tourism Announcement
// alerts (road-work, closures, ...) sharing this layer, so this is what
// marks one as "about a bus/train service" rather than "about a road".
function transitAlertIcon(color: string): ImageData {
  const ctx = newCtx()
  withOutline(ctx, color, () => {
    ctx.beginPath()
    ctx.moveTo(64, 14)
    ctx.lineTo(116, 108)
    ctx.lineTo(12, 108)
    ctx.closePath()
  })
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, 40, 56, 48, 28, 6)
  ctx.fill()
  ctx.fillStyle = color
  roundRect(ctx, 46, 62, 36, 10, 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(50, 90, 6, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(78, 90, 6, 0, Math.PI * 2)
  ctx.fill()
  return ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE)
}

// An octagon badge (the ninth base shape, echoing a stop sign) with a
// white horizontal bar — tagged "traffic-event:closure" announcements (see
// layers/situations.ts). Deliberately not another triangle: a closure is a
// hard stop, not a hazard to drive past carefully.
function closureIcon(color: string): ImageData {
  const ctx = newCtx()
  const octagon = new Path2D()
  const r = 52
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI / 4) * i + Math.PI / 8
    const x = 64 + r * Math.cos(angle)
    const y = 64 + r * Math.sin(angle)
    if (i === 0) octagon.moveTo(x, y)
    else octagon.lineTo(x, y)
  }
  octagon.closePath()
  withOutlinePath(ctx, color, octagon)
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, 32, 56, 64, 16, 8)
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

// A sedan silhouette (side view, facing right) with a small roof sign — the
// taxi marker. Built in the same 128-unit space as the other glyphs, and
// the sidebar's LayerIcon uses this exact path at a 128 viewBox so the two
// stay identical. Not a bus or train: no window band, wheels in white rings.
const CAR_BODY_D =
  'M14 84 V66 Q14 58 24 56 L42 52 L56 32 Q60 26 68 26 H88 Q95 26 99 32 L110 52 L116 56 Q122 58 122 66 V84 Q122 90 116 90 H20 Q14 90 14 84 Z'

function carIcon(color: string): ImageData {
  const ctx = newCtx()
  withOutlinePath(ctx, color, new Path2D(CAR_BODY_D))
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.moveTo(46, 54)
  ctx.lineTo(58, 36)
  ctx.lineTo(66, 36)
  ctx.lineTo(66, 54)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(70, 36)
  ctx.lineTo(88, 36)
  ctx.lineTo(98, 54)
  ctx.lineTo(70, 54)
  ctx.closePath()
  ctx.fill()
  // roof sign, a small badge sitting on top of the cabin
  withOutlinePath(ctx, color, roundRectPath(62, 12, 24, 14, 4))
  // wheels: white ring with the body color inside
  for (const cx of [36, 98]) {
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(cx, 90, 16, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(cx, 90, 9, 0, Math.PI * 2)
    ctx.fill()
  }
  return ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE)
}

// A map-pin silhouette (teardrop, the only non-polygonal base shape) with a
// white bicycle inside — reads as a bike spot without competing with the
// square "P" parking marker. Geometry is shared with LayerIcon.tsx.
const BIKE_PIN_D = 'M64 116 C52 100 26 80 26 52 A38 38 0 0 1 102 52 C102 80 76 100 64 116 Z'

function bikeParkingIcon(color: string): ImageData {
  const ctx = newCtx()
  withOutlinePath(ctx, color, new Path2D(BIKE_PIN_D))
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 5
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const cx of [52, 76]) {
    ctx.beginPath()
    ctx.arc(cx, 58, 9, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.moveTo(52, 58)
  ctx.lineTo(63, 45)
  ctx.lineTo(76, 58)
  ctx.moveTo(63, 45)
  ctx.lineTo(70, 40)
  ctx.stroke()
  return ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE)
}

// A circle badge (distinct from the bike-parking teardrop) with the same
// white bicycle glyph — a counter isn't a parking spot, so it gets the
// rounder, more neutral base shape, matching eChargingIcon's silhouette
// family but with the parking icon's cutout drawing re-used for the glyph.
function bikeCounterIcon(color: string): ImageData {
  const ctx = newCtx()
  withOutline(ctx, color, () => {
    ctx.beginPath()
    ctx.arc(64, 64, 44, 0, Math.PI * 2)
  })
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 6
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const cx of [48, 80]) {
    ctx.beginPath()
    ctx.arc(cx, 72, 11, 0, Math.PI * 2)
    ctx.stroke()
  }
  ctx.beginPath()
  ctx.moveTo(48, 72)
  ctx.lineTo(62, 52)
  ctx.lineTo(80, 72)
  ctx.moveTo(62, 52)
  ctx.lineTo(70, 44)
  ctx.stroke()
  return ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE)
}

// A rounded-square badge (echoing the parking "P" square, since a
// carsharing bay is a kind of parking spot) with a simple white car
// silhouette inside — distinguishes from the bare taxi glyph (carIcon),
// which has no badge background, by framing the car in a square.
function carsharingIcon(color: string): ImageData {
  const ctx = newCtx()
  withOutline(ctx, color, () => roundRect(ctx, 14, 14, 100, 100, 20))
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, 30, 58, 68, 20, 8)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(38, 58)
  ctx.lineTo(46, 42)
  ctx.quadraticCurveTo(49, 38, 54, 38)
  ctx.lineTo(74, 38)
  ctx.quadraticCurveTo(79, 38, 82, 42)
  ctx.lineTo(90, 58)
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = color
  for (const cx of [44, 84]) {
    ctx.beginPath()
    ctx.arc(cx, 80, 8, 0, Math.PI * 2)
    ctx.fill()
  }
  return ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE)
}

// A rounded-rect "van" body (narrower and more boxlike than the bus, with a
// single rear window instead of a long band) for the SIRI-VM demand-
// responsive-transport layer — visually distinct from both the taxi
// silhouette (bare car, no badge) and the regular-line bus glyph.
function shuttleIcon(color: string): ImageData {
  const ctx = newCtx()
  withOutlinePath(ctx, color, roundRectPath(22, 20, 84, 82, 14))
  ctx.fillStyle = '#ffffff'
  roundRect(ctx, 34, 32, 60, 24, 5)
  ctx.fill()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(42, 102, 13, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(86, 102, 13, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = '#ffffff'
  ctx.beginPath()
  ctx.arc(42, 102, 6, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(86, 102, 6, 0, Math.PI * 2)
  ctx.fill()
  return ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE)
}

// A shield badge (a pentagon pointing down, distinct from every other base
// shape) with three white wind lines — EAQI describes air, not a place or a
// vehicle, so a wind glyph reads as "air quality" rather than weather.
function airQualityIcon(color: string): ImageData {
  const ctx = newCtx()
  const shield = new Path2D('M64 12 L110 30 L110 64 Q110 96 64 118 Q18 96 18 64 L18 30 Z')
  withOutlinePath(ctx, color, shield)
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 6
  ctx.lineCap = 'round'
  for (const [y, x1, x2] of [
    [46, 34, 84],
    [62, 34, 94],
    [78, 34, 78],
  ] as const) {
    ctx.beginPath()
    ctx.moveTo(x1, y)
    ctx.lineTo(x2, y)
    ctx.stroke()
  }
  return ctx.getImageData(0, 0, RENDER_SIZE, RENDER_SIZE)
}

// Most layers draw one fixed shape regardless of color rule (status/band
// only changes the fill). bicycle is the exception: it merges two feed
// kinds (BikeParking boxes, BikeCounter sensors — see
// layers/bicycle.ts) under one layer id, so its drawer picks a shape by
// the rule's key prefix as well as its color.
function bicycleIcon(color: string, key: string): ImageData {
  return key.startsWith('counter') ? bikeCounterIcon(color) : bikeParkingIcon(color)
}

// bus_alert is the other multi-shape layer: tagged announcements (see
// layers/situations.ts ALERT_COLOR_RULES) get a shape that matches their
// category, everything else (untagged SIRI-SX alerts, unrecognized tags)
// keeps the generic warning triangle.
function alertIconByKey(color: string, key: string): ImageData {
  if (key === 'closure') return closureIcon(color)
  if (key === 'roadwork') return roadworkIcon(color)
  if (key === 'transit') return transitAlertIcon(color)
  return alertIcon(color)
}

const DRAWERS: Record<string, (color: string, key: string) => ImageData> = {
  parking: parkingIcon,
  e_charging: eChargingIcon,
  train_vehicle: trainIcon,
  bus_vehicle: busIcon,
  bus_alert: alertIconByKey,
  on_demand_vehicle: carIcon,
  on_demand_vm_vehicle: shuttleIcon,
  bicycle: bicycleIcon,
  carsharing_station: carsharingIcon,
  air_quality: airQualityIcon,
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
    map.addImage(iconImageId(layer, rule.key), draw(rule.color, rule.key))
  }
}

