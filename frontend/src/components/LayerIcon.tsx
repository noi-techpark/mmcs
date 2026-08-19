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
    case 'bus_vehicle':
    case 'on_demand_vehicle':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="3" y="2" width="10" height="9" rx="2.4" fill={color} />
          <rect x="4.3" y="3.3" width="7.4" height="3.4" fill="#1c1e22" />
          <circle cx="5.3" cy="12.8" r="1.3" fill={color} />
          <circle cx="10.7" cy="12.8" r="1.3" fill={color} />
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
