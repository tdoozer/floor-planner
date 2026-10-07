import React from 'react';
import { Eye, EyeOff, Lock, Unlock } from 'lucide-react';

import { LAYER_DEFS } from '../data/project.js';

// Layers panel “like in Photoshop”: the eye is visibility, the lock is drag blocking.
// The { visible, locked } state pattern was carried over from landscape-app.
export default function LayerPanel({ layers, onUpdateLayer }) {
  const allVisible = LAYER_DEFS.every((l) => layers[l.id]?.visible);

  return (
    <div className="layer-panel">
      <div className="panel-head">
        <span>Layers</span>
        <button
          className="link-btn"
          onClick={() => LAYER_DEFS.forEach((l) => onUpdateLayer(l.id, { visible: !allVisible }))}
        >
          {allVisible ? 'Hide all' : 'Show all'}
        </button>
      </div>

      {LAYER_DEFS.map((def) => {
        const state = layers[def.id] || { visible: true, locked: false };
        return (
          <div key={def.id} className={`layer-row ${state.visible ? '' : 'hidden-layer'}`}>
            <button
              className="icon-btn"
              onClick={() => onUpdateLayer(def.id, { visible: !state.visible })}
              title={state.visible ? 'Hide layer' : 'Show layer'}
            >
              {state.visible ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
            <button
              className="icon-btn"
              onClick={() => onUpdateLayer(def.id, { locked: !state.locked })}
              title={state.locked ? 'Unlock' : 'Lock dragging'}
            >
              {state.locked ? <Lock size={16} /> : <Unlock size={16} />}
            </button>
            <span className="layer-swatch" style={{ background: def.color }} />
            <div className="layer-text">
              <div className="layer-name">{def.name}</div>
              <div className="layer-hint">{def.hint}</div>
            </div>
          </div>
        );
      })}

      <p className="panel-note">
        PNG and PDF export contains only the visible layers. The combination
        “Architecture + Plumbing” gives the drainage plan, “Architecture + Underfloor heating” gives
        the installation scheme for the fitter.
      </p>
    </div>
  );
}
