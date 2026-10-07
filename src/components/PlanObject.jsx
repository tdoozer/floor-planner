import React from 'react';
import { Rnd } from 'react-rnd';

import { pxToWorld } from '../viewport.js';

// Object on the plan: dragged with the mouse, resized by the corners, rotated by the handle.
// The pattern was carried over from landscape-app/src/components/LandscapeObject.jsx —
// react-rnd works in pixels, state lives in metres, conversion happens at the boundary.
//
// IMPORTANT: do NOT call stopPropagation in onMouseDown on children of Rnd.
// react-draggable listens for mousedown on the Rnd root div, and an event stopped
// in a descendant never reaches it — the object stops being draggable.

const SNAP = 0.01; // snap to 10 mm
const MIN_SIZE = 0.15; // m, minimum size

function snap(v) {
  return Math.round(v / SNAP) * SNAP;
}

export default function PlanObject({
  kind,
  id,
  label,
  glyph,
  color,
  // The second colour is only for the two-gang switch: one colour
  // per gang, otherwise the plan does not show which controls what
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
      // 15° step — fixtures are almost always placed along walls
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
      // The rotation handle sits inside Rnd — exclude it from the drag area,
      // otherwise rotating turns into dragging.
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
          // The two-gang switch is painted in two colours along the diagonal:
          // one half is one gang with its own lamps.
          //
          // The stop syntax is OLD and verbose on purpose: html2canvas
          // cannot parse the modern “colour 0 50%” notation with two positions
          // in one stop and fails on it — and with it the PNG and PDF
          // export, silently, without a single message.
          background: color2
            ? `linear-gradient(135deg, ${color} 0%, ${color} 50%, ${color2} 50%, ${color2} 100%)`
            : color,
          borderStyle: confirmed === false ? 'dashed' : 'solid',
          borderColor: selected ? '#2563eb' : isNode ? color : '#64748b'
        }}
        title={label}
        // Selection only. No stopPropagation — otherwise dragging breaks.
        onMouseDown={() => onSelect()}
      >
        {isNode && <span className="node-glyph">{glyph}</span>}
        {kind === 'equipment' && <span className="equipment-label">{label}</span>}
        {existing && <span className="badge-existing" title="Existing node">E</span>}
        {confirmed === false && (
          <span className="badge-draft" title="Position not confirmed by measurement">?</span>
        )}
      </div>

      {selected && onRotate && !locked && (
        <div className="rotate-handle" onMouseDown={handleRotateStart} title="Rotate (15° step)">
          ⟳
        </div>
      )}
    </Rnd>
  );
}
