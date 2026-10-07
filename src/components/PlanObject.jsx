import React from 'react';
import { Rnd } from 'react-rnd';

import { pxToWorld } from '../viewport.js';

// Объект на плане: перетаскивается мышкой, тянется за углы, поворачивается за ручку.
// Паттерн перенесён из landscape-app/src/components/LandscapeObject.jsx —
// react-rnd работает в пикселях, состояние живёт в метрах, конвертация на границе.
//
// ВАЖНО: на дочерних элементах Rnd НЕЛЬЗЯ вызывать stopPropagation в onMouseDown.
// react-draggable слушает mousedown на корневом div Rnd, и остановленное
// в потомке событие до него не доходит — объект перестаёт таскаться.

const SNAP = 0.01; // привязка к 10 мм
const MIN_SIZE = 0.15; // м, минимальный габарит

function snap(v) {
  return Math.round(v / SNAP) * SNAP;
}

export default function PlanObject({
  kind,
  id,
  label,
  glyph,
  color,
  // Второй цвет — только у двухклавишного выключателя: по цвету
  // на клавишу, иначе на плане не видно, какая чем управляет
  color2,
  existing,
  confirmed,
  left,
  top,
  widthPx,
  heightPx,
  rotation,
  locked,
  selected,
  pxPerMeter,
  resizable,
  onSelect,
  onMove,
  onResize,
  onRotate,
  setDraggingObj
}) {
  const isNode = kind === 'node';
  const isStair = kind === 'stair';

  const handleRotateStart = (e) => {
    if (!onRotate || locked) return;
    e.stopPropagation();
    e.preventDefault();

    const rect = e.currentTarget.parentElement.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;

    const angleOf = (x, y) => (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
    const startAngle = angleOf(e.clientX, e.clientY);
    const startRotation = rotation || 0;

    const move = (ev) => {
      let delta = angleOf(ev.clientX, ev.clientY) - startAngle;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      // Шаг 15° — приборы почти всегда ставятся вдоль стен
      let next = Math.round((startRotation + delta) / 15) * 15;
      next = ((next % 360) + 360) % 360;
      onRotate(next);
    };

    const end = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', end);
    };

    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', end);
  };

  const canResize = resizable && !locked;

  return (
    <Rnd
      className={`plan-object ${selected ? 'is-selected' : ''} ${locked ? 'is-locked' : ''}`}
      enableResizing={
        canResize
          ? { top: true, right: true, bottom: true, left: true, topRight: true, bottomRight: true, bottomLeft: true, topLeft: true }
          : false
      }
      resizeHandleClasses={
        canResize
          ? {
              top: 'rz rz-t', right: 'rz rz-r', bottom: 'rz rz-b', left: 'rz rz-l',
              topRight: 'rz rz-tr', bottomRight: 'rz rz-br', bottomLeft: 'rz rz-bl', topLeft: 'rz rz-tl'
            }
          : undefined
      }
      disableDragging={locked}
      bounds="parent"
      // Ручка поворота лежит внутри Rnd — исключаем её из области захвата,
      // иначе поворот превращается в перетаскивание.
      cancel=".rotate-handle"
      position={{ x: left, y: top }}
      size={{ width: widthPx, height: heightPx }}
      onDragStart={() => onSelect()}
      onDrag={(e, d) => {
        const w = pxToWorld(d.x, d.y, pxPerMeter);
        setDraggingObj?.({ id, x: w.x, y: w.y });
      }}
      onDragStop={(e, d) => {
        const w = pxToWorld(d.x, d.y, pxPerMeter);
        onMove(snap(w.x), snap(w.y));
        setDraggingObj?.(null);
      }}
      onResizeStart={() => onSelect()}
      onResizeStop={(e, dir, refEl, delta, position) => {
        if (!onResize) return;
        const w = pxToWorld(position.x, position.y, pxPerMeter);
        onResize({
          x: snap(w.x),
          y: snap(w.y),
          w: Math.max(MIN_SIZE, snap(refEl.offsetWidth / pxPerMeter)),
          d: Math.max(MIN_SIZE, snap(refEl.offsetHeight / pxPerMeter))
        });
      }}
      style={{ zIndex: selected ? 40 : isStair ? 12 : isNode ? 30 : 20 }}
    >
      <div
        className={`plan-object-body ${kind} ${selected ? 'selected' : ''}`}
        style={{
          width: '100%',
          height: '100%',
          transform: `rotate(${rotation || 0}deg)`,
          transformOrigin: 'center center',
          // Двухклавишный выключатель красится двумя цветами по диагонали:
          // одна половина — одна клавиша со своими лампами.
          //
          // Синтаксис стопов СТАРЫЙ и многословный намеренно: html2canvas
          // не разбирает современную запись «цвет 0 50%» с двумя позициями
          // в одном стопе и валится на ней — а вместе с ним и экспорт
          // в PNG и PDF, молча, без единого сообщения.
          background: color2
            ? `linear-gradient(135deg, ${color} 0%, ${color} 50%, ${color2} 50%, ${color2} 100%)`
            : color,
          borderStyle: confirmed === false ? 'dashed' : 'solid',
          borderColor: selected ? '#2563eb' : isNode ? color : '#64748b'
        }}
        title={label}
        // Только выбор. Без stopPropagation — иначе ломается перетаскивание.
        onMouseDown={() => onSelect()}
      >
        {isNode && <span className="node-glyph">{glyph}</span>}
        {kind === 'equipment' && <span className="equipment-label">{label}</span>}
        {existing && <span className="badge-existing" title="Существующий узел">Е</span>}
        {confirmed === false && (
          <span className="badge-draft" title="Привязка не подтверждена замером">?</span>
        )}
      </div>

      {selected && onRotate && !locked && (
        <div className="rotate-handle" onMouseDown={handleRotateStart} title="Повернуть (шаг 15°)">
          ⟳
        </div>
      )}
    </Rnd>
  );
}
