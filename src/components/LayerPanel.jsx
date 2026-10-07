import React from 'react';
import { Eye, EyeOff, Lock, Unlock } from 'lucide-react';

import { LAYER_DEFS } from '../data/project.js';

// Панель слоёв «как в фотошопе»: глаз — видимость, замок — блокировка перетаскивания.
// Паттерн состояния { visible, locked } перенесён из landscape-app.
export default function LayerPanel({ layers, onUpdateLayer }) {
  const allVisible = LAYER_DEFS.every((l) => layers[l.id]?.visible);

  return (
    <div className="layer-panel">
      <div className="panel-head">
        <span>Слои</span>
        <button
          className="link-btn"
          onClick={() => LAYER_DEFS.forEach((l) => onUpdateLayer(l.id, { visible: !allVisible }))}
        >
          {allVisible ? 'Скрыть все' : 'Показать все'}
        </button>
      </div>

      {LAYER_DEFS.map((def) => {
        const state = layers[def.id] || { visible: true, locked: false };
        return (
          <div key={def.id} className={`layer-row ${state.visible ? '' : 'hidden-layer'}`}>
            <button
              className="icon-btn"
              onClick={() => onUpdateLayer(def.id, { visible: !state.visible })}
              title={state.visible ? 'Скрыть слой' : 'Показать слой'}
            >
              {state.visible ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
            <button
              className="icon-btn"
              onClick={() => onUpdateLayer(def.id, { locked: !state.locked })}
              title={state.locked ? 'Разблокировать' : 'Заблокировать перетаскивание'}
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
        Экспорт PNG и PDF содержит только видимые слои. Комбинация
        «Архитектура + Сантехника» даёт план канализации, «Архитектура + Тёплый пол» —
        монтажную схему для укладчика.
      </p>
    </div>
  );
}
