import type { LayerOptionsPanelProps } from './types'

export function PointLayerOptions({ options, onChange }: LayerOptionsPanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={options.clustering === true}
          onChange={(e) => onChange({ ...options, clustering: e.target.checked })}
        />
        Cluster overlapping icons
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={options.labels === true}
          onChange={(e) => onChange({ ...options, labels: e.target.checked })}
        />
        Show name labels
      </label>
    </div>
  )
}
