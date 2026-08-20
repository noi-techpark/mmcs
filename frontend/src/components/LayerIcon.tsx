import type { Layer } from '../types/feature'

// Sidebar-scale mirrors of the on-map SDF glyphs (map/icons.ts) — same
// shapes, drawn as inline SVG for crisp rendering at small sizes.
export function LayerIcon({ layer, color = '#e8e8e8' }: { layer: Layer; color?: string }) {
  switch (layer) {
    case 'parking':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill={color} />
          <text x="8" y="11.5" textAnchor="middle" fontSize="9" fontWeight="700" fill="#1c1e22" fontFamily="sans-serif">
            P
          </text>
        </svg>
      )
    case 'e_charging':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="8" r="6.5" fill={color} />
          <path d="M8.7 3.5 5.5 8.2h1.7L6.3 12.5l4.2-5.2H8.3z" fill="#1c1e22" />
        </svg>
      )
    case 'train_vehicle':
      // Mini mirror of the map glyph (map/icons.ts trainIcon): a dome-top
      // body (mostly colored, small window/lights), rails clearly visible
      // beneath it — the detail distinguishing it from the bus icon.
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M2.5 6.5 A5.5 5.5 0 0 1 13.5 6.5 V12 A1.25 1.25 0 0 1 12.25 13.25 H3.75 A1.25 1.25 0 0 1 2.5 12 Z" fill={color} />
          <rect x="4.9" y="4.25" width="6.25" height="4" rx="0.75" fill="#1c1e22" />
          <rect x="4.25" y="9.75" width="1.75" height="1.75" fill="#1c1e22" />
          <rect x="10" y="9.75" width="1.75" height="1.75" fill="#1c1e22" />
          <path d="M7.25 12.25 L6.25 12.25 L1 15.75 L3 15.75 Z M8.75 12.25 L9.75 12.25 L15 15.75 L13 15.75 Z" fill={color} />
        </svg>
      )
    case 'bus_vehicle':
    case 'on_demand_vehicle':
      // Mini mirror of the map glyph (map/icons.ts busIcon): a wide,
      // side-on body — as simple as possible — one window band, two wheels.
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="1" y="3" width="14" height="9.5" rx="2" fill={color} />
          <rect x="2.5" y="4.5" width="11" height="2.5" rx="0.5" fill="#1c1e22" />
          <circle cx="4.5" cy="12.5" r="1.75" fill={color} />
          <circle cx="11.5" cy="12.5" r="1.75" fill={color} />
        </svg>
      )
    case 'bus_alert':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 1.5 14.5 13.5H1.5Z" fill={color} />
          <rect x="7.2" y="5.5" width="1.6" height="4.2" rx="0.8" fill="#1c1e22" />
          <circle cx="8" cy="11.3" r="0.9" fill="#1c1e22" />
        </svg>
      )
    case 'flight':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M8 2 14 8 8 14 2 8Z" fill={color} />
          <rect x="7.25" y="2.5" width="1.5" height="9" rx="0.75" fill="#1c1e22" />
          <path d="M8.75 7.25 13.75 10.75 8.75 9Z" fill="#1c1e22" />
          <path d="M7.25 7.25 2.25 10.75 7.25 9Z" fill="#1c1e22" />
          <path d="M8.75 9.75 11 11.75 8.75 11Z" fill="#1c1e22" />
          <path d="M7.25 9.75 5 11.75 7.25 11Z" fill="#1c1e22" />
        </svg>
      )
  }
}
