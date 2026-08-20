import type { ComponentType } from 'react'
import type { LayerOptionsPanelProps } from './types'

function PointLayerOptions({ options, onChange, showDynamicOpacity }: LayerOptionsPanelProps & { showDynamicOpacity: boolean }) {
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
      {showDynamicOpacity && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={options.dynamicOpacity !== false}
            onChange={(e) => onChange({ ...options, dynamicOpacity: e.target.checked })}
          />
          Dynamic opacity
        </label>
      )}
    </div>
  )
}

/** Binds showDynamicOpacity per layer at layer-definition time (see pointLayer.ts), since LayerDefinition.OptionsPanel takes no layer-specific props beyond options/onChange. */
export function createPointLayerOptions(showDynamicOpacity: boolean): ComponentType<LayerOptionsPanelProps> {
  return (props: LayerOptionsPanelProps) => <PointLayerOptions {...props} showDynamicOpacity={showDynamicOpacity} />
}
