import React, { useMemo } from 'react';
import { forwardRef } from 'react';
import { Rnd } from 'react-rnd';

import PlanObject from './PlanObject.jsx';
import { WORLD, pxToWorld, worldToPx } from '../viewport.js';
import { INNER_D, INNER_W, LAYOUT_LIMITS, buildRooms, buildWalls, partitionHandleDefs } from '../data/project.js';
import { CONNECTION_META, connectionPoints, dims, getFixture } from '../data/fixtures.js';
import { buildWorktop } from '../data/worktop.js';
import { EDGE_ZONE, pathSegments } from '../calc/loops.js';
import {
  STAIR_STRUCTURE_THICKNESS,
  doorSwing,
  drainRoute,
  openingRect,
  polygonArea,
  riserPoint,
  wallRect
} from '../calc/geometry.js';

// Иконки узлов рисуем текстом — так они попадают в html2canvas без внешних шрифтов.
const NODE_GLYPH = {
  gas_point: 'G',
  boiler: '▣',
  flue: '◎',
  sewer_riser: '●',
  water_inlet: '◆',
  electrical_panel: '⚡',
  vent_duct: '↑',
  manifold: '≡',
  embed: '■'
};

const NODE_COLOR = {
  gas_point: '#f59e0b',
  boiler: '#dc2626',
  flue: '#b91c1c',
  sewer_riser: '#0f766e',
  water_inlet: '#2563eb',
  electrical_panel: '#ca8a04',
  vent_duct: '#0891b2',
  manifold: '#dc2626',
  // Закладные — сталь в бетоне, поэтому серо-стальной
  embed: '#475569'
};

// Цвета контуров тёплого пола — чтобы их можно было различить на плане
const LOOP_COLORS = ['#dc2626', '#ea580c', '#0891b2', '#7c3aed', '#16a34a'];

// Цвет трубы по ходу петли: подача горячая (красная) → обратка остывшая (синяя).
// Промежуточные значения идут через фиолетовый, чтобы переход читался.
function pipeColor(t) {
  const hot = [220, 38, 38];
  const cold = [37, 99, 235];
  const c = hot.map((h, i) => Math.round(h + (cold[i] - h) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

const Plan = forwardRef(function Plan(
  {
    project,
    layers,
    pxPerMeter,
    selectedId,
    onSelect,
    onUpdateEquipment,
    onUpdateNode,
    onUpdateStair,
    onUpdateLayout,
    setDraggingObj,
    showConnections,
    showDrainRoutes,
    loops,
    electrical,
    warnings,
    focusPoint
  },
  ref
) {
  const { layout, openings, stair, nodes, equipment } = project;

  const walls = useMemo(() => buildWalls(layout), [layout]);

  // Цвет группы освещения: выключатель и лампы, которыми он управляет,
  // красятся одинаково. Проходная пара берёт цвет своего напарника —
  // иначе одна и та же лампа выглядела бы принадлежащей двум группам.
  //
  // У двухклавишного групп ДВЕ, и цвет у каждой свой: сам выключатель
  // рисуется двумя цветами по диагонали, иначе непонятно, какая клавиша
  // к каким лампам. Клавиши пары совпадают по порядку.
  const lightGroupColor = useMemo(() => {
    const PALETTE = ['#dc2626', '#2563eb', '#16a34a', '#9333ea', '#ea580c', '#0d9488'];
    const map = {}; // id → цвет (для ламп и для первой клавиши выключателя)
    const second = {}; // id выключателя → цвет второй клавиши
    let next = 0;

    const switches = equipment.filter((e) => getFixture(e.catalogId)?.gangs);
    const gangsOf = (sw) => sw.groups ?? [sw.controls ?? []];

    switches.forEach((sw) => {
      const pair = sw.pairWith && switches.find((o) => o.id === sw.pairWith);
      gangsOf(sw).forEach((ids, i) => {
        // Цвет клавиши берём у уже покрашенной лампы этой же группы —
        // так напарник по проходной схеме получает те же цвета
        const inherited = ids.map((id) => map[id]).find(Boolean);
        const color = inherited || PALETTE[next++ % PALETTE.length];
        ids.forEach((id) => { map[id] ??= color; });
        if (i === 0) map[sw.id] = color;
        else if (i === 1) second[sw.id] = color;
      });
      if (!map[sw.id]) map[sw.id] = (pair && map[pair.id]) || PALETTE[next++ % PALETTE.length];
    });
    return { map, second };
  }, [equipment]);

  // Цепочки проёмов по наружным стенам: от угла до окна, окно, до следующего.
  // Габаритный размер 5500 снят — он и так известен, а место занимал.
  const openingChains = useMemo(() => {
    const SIDES = [
      { wallId: 'w-n', horizontal: true, off: -0.4, below: false },
      { wallId: 'w-s', horizontal: true, off: INNER_D + 0.4, below: true },
      { wallId: 'w-w', horizontal: false, off: -0.4, below: false },
      { wallId: 'w-e', horizontal: false, off: INNER_W + 0.4, below: true }
    ];
    const span = (h) => (h ? INNER_W : INNER_D);

    return SIDES.map((side) => {
      const wall = walls.find((w) => w.id === side.wallId);
      if (!wall) return null;

      const spans = openings
        .filter((o) => o.wallId === side.wallId)
        .map((o) => {
          const r = openingRect(wall, o);
          return side.horizontal ? [r.x, r.x + r.w] : [r.y, r.y + r.h];
        })
        .sort((a, b) => a[0] - b[0]);

      if (!spans.length) return null;

      const segments = [];
      let cursor = 0;
      spans.forEach(([a, b]) => {
        if (a - cursor > 0.02) segments.push({ a: cursor, b: a, opening: false });
        segments.push({ a, b, opening: true });
        cursor = b;
      });
      if (span(side.horizontal) - cursor > 0.02) {
        segments.push({ a: cursor, b: span(side.horizontal), opening: false });
      }

      return { ...side, segments };
    }).filter(Boolean);
  }, [walls, openings]);
  const rooms = useMemo(() => buildRooms(layout), [layout]);

  const widthPx = WORLD.w * pxPerMeter;
  const heightPx = WORLD.h * pxPerMeter;
  const toPx = (x, y) => worldToPx(x, y, pxPerMeter);

  const riser = nodes.find((n) => n.type === 'sewer_riser');
  const manifoldNode = nodes.find((n) => n.type === 'manifold');

  const allConnections = useMemo(() => equipment.flatMap((item) => connectionPoints(item)), [equipment]);

  const drainRoutes = useMemo(() => {
    if (!riser) return [];
    const at = riserPoint(riser);
    return allConnections
      .filter((c) => c.kind === 'drain')
      .map((c) => ({ id: c.id, dia: c.dia, ...drainRoute(c, at) }));
  }, [allConnections, riser]);

  // Изолинии высоты прохода под маршем — где какой прибор поместится
  const headroomLines = useMemo(() => {
    if (!stair) return [];
    const slope = stair.totalRise / stair.risers / stair.tread;
    const bottom = stair.y + stair.length;
    return [1.3, 1.9, 2.1]
      .map((h) => ({ h, y: bottom - (h + STAIR_STRUCTURE_THICKNESS) / slope }))
      .filter((l) => l.y >= stair.y && l.y <= bottom);
  }, [stair]);

  const warnPoints = useMemo(
    () => warnings.filter((w) => w.at && layers[w.layer]?.visible),
    [warnings, layers]
  );

  const strokeM = 1 / pxPerMeter; // 1 пиксель в метрах — постоянная толщина линий

  // Перетаскиваемые перегородки: двинул — пересчитались помещения, площади и смета.
  const partitionHandles = partitionHandleDefs(layout);

  // Столешница ВЫВОДИТСЯ из расстановки, а не хранится: двинули посудомойку —
  // фронт пересчитался сам. Рисуется пунктиром: это плоскость на отметке 900,
  // а не предмет на полу, и она перекрывает приборы под собой.
  const worktop = useMemo(
    () => buildWorktop(layout, equipment),
    [layout, equipment]
  );

  const HANDLE = 11; // px

  return (
    <div
      className="plan-area"
      ref={ref}
      style={{ width: `${widthPx}px`, height: `${heightPx}px` }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onSelect(null);
      }}
    >
      <svg
        className="plan-svg"
        width={widthPx}
        height={heightPx}
        viewBox={`${WORLD.minX} ${WORLD.minY} ${WORLD.w} ${WORLD.h}`}
      >
        <defs>
          <pattern id="grid" width="0.5" height="0.5" patternUnits="userSpaceOnUse">
            <path d="M 0.5 0 L 0 0 0 0.5" fill="none" stroke="#e2e8f0" strokeWidth={strokeM * 0.8} />
          </pattern>
        </defs>
        <rect x={0} y={0} width={INNER_W} height={INNER_D} fill="url(#grid)" />

        {/* --- Помещения --- */}
        {rooms.map((room) => {
          const area = polygonArea(room.polygon);
          // Подпись зала ставим в его широкой части, иначе она попадает на вырез
          let label;
          if (room.id !== 'living') {
            label = {
              x: room.polygon.reduce((s, p) => s + p.x, 0) / room.polygon.length,
              y: room.polygon.reduce((s, p) => s + p.y, 0) / room.polygon.length
            };
          } else if (layout.variant === 'bathLeft') {
            label = { x: (layout.hallX + INNER_W) / 2, y: (layout.hallY + INNER_D) / 2 };
          } else {
            label = { x: layout.bathX / 2, y: Math.min(layout.hallY, layout.bathY) / 2 + 0.3 };
          }
          return (
            <g key={room.id}>
              <polygon
                points={room.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
                fill={room.fill}
                fillOpacity={0.85}
              />
              <text x={label.x} y={label.y - 0.12} textAnchor="middle" fontSize={0.19} fill="#0f172a" fontWeight="600">
                {room.name}
              </text>
              <text x={label.x} y={label.y + 0.14} textAnchor="middle" fontSize={0.17} fill="#475569">
                {area.toFixed(2)} м²
              </text>
            </g>
          );
        })}

        {/* --- Стены --- */}
        {layers.architecture.visible && (
          <g>
            {walls.map((w) => {
              const r = wallRect(w);
              return (
                <rect
                  key={w.id}
                  x={r.x} y={r.y} width={r.w} height={r.h}
                  fill={w.kind === 'outer' ? '#cbd5e1' : '#e2e8f0'}
                  stroke="#334155"
                  strokeWidth={strokeM * 1.2}
                />
              );
            })}

            {openings.map((o) => {
              const wall = walls.find((w) => w.id === o.wallId);
              if (!wall) return null;
              const r = openingRect(wall, o);
              const horizontal = r.w > r.h;
              return (
                <g key={o.id}>
                  <rect x={r.x} y={r.y} width={r.w} height={r.h} fill="#ffffff" />
                  {o.kind === 'window' ? (
                    <>
                      {horizontal ? (
                        <line
                          x1={r.x} y1={r.y + r.h / 2} x2={r.x + r.w} y2={r.y + r.h / 2}
                          stroke={o.blind ? '#64748b' : '#0284c7'} strokeWidth={strokeM * 2.5}
                        />
                      ) : (
                        <line
                          x1={r.x + r.w / 2} y1={r.y} x2={r.x + r.w / 2} y2={r.y + r.h}
                          stroke={o.blind ? '#64748b' : '#0284c7'} strokeWidth={strokeM * 2.5}
                        />
                      )}
                      <rect
                        x={r.x} y={r.y} width={r.w} height={r.h}
                        fill="none" stroke={o.blind ? '#64748b' : '#0284c7'} strokeWidth={strokeM}
                      />
                      {o.blind && (
                        <text
                          x={r.x + r.w / 2} y={r.y - 0.06} textAnchor="middle"
                          fontSize={0.11} fill="#64748b" fontWeight="600"
                        >
                          глухое
                        </text>
                      )}
                    </>
                  ) : (
                    <>
                      <rect
                        x={r.x} y={r.y} width={r.w} height={r.h}
                        fill="none" stroke={o.entry ? '#b45309' : '#64748b'} strokeWidth={strokeM * 1.5}
                      />
                      {(() => {
                        const d = doorSwing(wall, o);
                        return (
                          <>
                            <line
                              x1={d.hinge.x} y1={d.hinge.y} x2={d.open.x} y2={d.open.y}
                              stroke={o.entry ? '#d97706' : '#64748b'} strokeWidth={strokeM * 1.6}
                            />
                            <path
                              d={`M ${d.closed.x} ${d.closed.y} A ${o.len} ${o.len} 0 0 ${d.sweep} ${d.open.x} ${d.open.y}`}
                              fill="none" stroke={o.entry ? '#d97706' : '#94a3b8'}
                              strokeWidth={strokeM} strokeDasharray="0.06 0.05"
                            />
                          </>
                        );
                      })()}
                    </>
                  )}
                </g>
              );
            })}
          </g>
        )}

        {/* --- Столешница: пунктирный контур на отметке 900 --- */}
        {layers.equipment.visible && worktop && (
          <g className="worktop">
            <polygon
              points={worktop.polygon.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="#fbbf24" fillOpacity={0.1}
              stroke="#b45309" strokeWidth={strokeM * 1.6}
              strokeDasharray={`${strokeM * 7} ${strokeM * 5}`}
              strokeLinejoin="round"
            />
            {/* Вырезы под врезные приборы — мойку и панель */}
            {worktop.cutouts.map((c) => (
              <rect
                key={c.id}
                x={c.cx - c.w / 2} y={c.cy - c.d / 2} width={c.w} height={c.d}
                transform={`rotate(${c.rotation} ${c.cx} ${c.cy})`}
                fill="none"
                stroke="#b45309" strokeWidth={strokeM}
                strokeDasharray={`${strokeM * 3} ${strokeM * 3}`}
              />
            ))}
            <text
              x={worktop.polygon[0].x + 0.08}
              y={worktop.depth - 0.12}
              fontSize={0.13} fill="#b45309" fontWeight="600" opacity={0.85}
            >
              столешница {(worktop.top * 1000).toFixed(0)}
            </text>
          </g>
        )}

        {/* --- Лестница --- */}
        {layers.architecture.visible && stair && (
          <g>
            <rect
              x={stair.x} y={stair.y} width={stair.width} height={stair.length}
              fill="#f1f5f9" fillOpacity={0.75}
              stroke="#475569" strokeWidth={strokeM * 1.5}
            />
            {Array.from({ length: Math.max(1, Math.round(stair.length / stair.tread)) }).map((_, i) => {
              const y = stair.y + stair.length - (i + 1) * stair.tread;
              if (y < stair.y) return null;
              return (
                <line key={i} x1={stair.x} y1={y} x2={stair.x + stair.width} y2={y}
                  stroke="#94a3b8" strokeWidth={strokeM} />
              );
            })}
            <line
              x1={stair.x + stair.width / 2} y1={stair.y + stair.length - 0.15}
              x2={stair.x + stair.width / 2} y2={stair.y + 0.15}
              stroke="#334155" strokeWidth={strokeM * 1.5}
            />
            <polygon
              points={`${stair.x + stair.width / 2},${stair.y + 0.02} ${stair.x + stair.width / 2 - 0.07},${stair.y + 0.18} ${stair.x + stair.width / 2 + 0.07},${stair.y + 0.18}`}
              fill="#334155"
            />

            {/* Кромка СУЩЕСТВУЮЩЕГО проёма — всё выше неё требует его сдвига */}
            <line
              x1={stair.x - 0.25} y1={stair.existingOpeningTopY}
              x2={stair.x + stair.width + 0.1} y2={stair.existingOpeningTopY}
              stroke="#dc2626" strokeWidth={strokeM * 2} strokeDasharray="0.14 0.07"
            />
            <text
              x={stair.x + stair.width / 2} y={stair.existingOpeningTopY - 0.06}
              textAnchor="middle" fontSize={0.12} fill="#dc2626" fontWeight="700"
            >
              проём сейчас
            </text>

            {/* Заход снизу и площадка наверху — по метру, требование заказчика */}
            <g fill="#0f766e" stroke="#0f766e">
              <rect
                x={stair.x} y={stair.y + stair.length}
                width={stair.width} height={Math.max(0, INNER_D - stair.y - stair.length)}
                fill="#0f766e" fillOpacity={0.09} stroke="none"
              />
              <text
                x={stair.x + stair.width / 2} y={stair.y + stair.length + 0.22}
                textAnchor="middle" fontSize={0.13} stroke="none" fontWeight="600"
              >
                заход {((INNER_D - stair.y - stair.length) * 1000).toFixed(0)}
              </text>
              <rect
                x={stair.x} y={0} width={stair.width} height={Math.max(0, stair.y)}
                fill="#0f766e" fillOpacity={0.09} stroke="none"
              />
              <text
                x={stair.x + stair.width / 2} y={stair.y - 0.1}
                textAnchor="middle" fontSize={0.13} stroke="none" fontWeight="600"
              >
                площадка {(stair.y * 1000).toFixed(0)}
              </text>
            </g>

            {/* Изолинии высоты прохода под маршем */}
            {headroomLines.map((l) => (
              <g key={l.h}>
                <line
                  x1={stair.x - 0.15} y1={l.y} x2={stair.x + stair.width + 0.05} y2={l.y}
                  stroke="#b45309" strokeWidth={strokeM * 1.2} strokeDasharray="0.08 0.06"
                />
                <text x={stair.x - 0.18} y={l.y + 0.05} textAnchor="end" fontSize={0.12} fill="#b45309" fontWeight="600">
                  {l.h.toFixed(1)} м
                </text>
              </g>
            ))}
          </g>
        )}

        {/* --- Трассы электрики: только под прямым углом, пучком --- */}
        {layers.electrical.visible && electrical?.routes?.length > 0 && (
          <g>
            {electrical.routes.map((r) => (
              <polyline
                key={`cab-${r.id}`}
                points={r.points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={r.circuit === 'light' ? '#eab308' : '#ca8a04'}
                strokeWidth={strokeM}
                strokeLinejoin="round"
                strokeDasharray={r.circuit === 'light' ? '0.08 0.06' : undefined}
                opacity={0.65}
              />
            ))}
          </g>
        )}

        {/* --- Петли тёплого пола --- */}
        {layers.heating.visible && loops && (
          <g>
            {/* Краевая зона: полоса вдоль наружных стен, где трасса идёт чаще.
                Там от окон и стен падает холод, и там же допустима более
                высокая температура поверхности. */}
            <g>
              <rect x={0} y={0} width={INNER_W} height={EDGE_ZONE.width}
                fill="#f97316" fillOpacity={0.07} />
              <rect x={0} y={INNER_D - EDGE_ZONE.width} width={INNER_W} height={EDGE_ZONE.width}
                fill="#f97316" fillOpacity={0.07} />
              <rect x={0} y={EDGE_ZONE.width} width={EDGE_ZONE.width}
                height={INNER_D - 2 * EDGE_ZONE.width} fill="#f97316" fillOpacity={0.07} />
              <rect x={INNER_W - EDGE_ZONE.width} y={EDGE_ZONE.width} width={EDGE_ZONE.width}
                height={INNER_D - 2 * EDGE_ZONE.width} fill="#f97316" fillOpacity={0.07} />
              <line
                x1={EDGE_ZONE.width} y1={EDGE_ZONE.width}
                x2={INNER_W - EDGE_ZONE.width} y2={EDGE_ZONE.width}
                stroke="#f97316" strokeWidth={strokeM} strokeDasharray="0.1 0.08" opacity={0.6}
              />
              <line
                x1={EDGE_ZONE.width} y1={INNER_D - EDGE_ZONE.width}
                x2={INNER_W - EDGE_ZONE.width} y2={INNER_D - EDGE_ZONE.width}
                stroke="#f97316" strokeWidth={strokeM} strokeDasharray="0.1 0.08" opacity={0.6}
              />
              <line
                x1={EDGE_ZONE.width} y1={EDGE_ZONE.width}
                x2={EDGE_ZONE.width} y2={INNER_D - EDGE_ZONE.width}
                stroke="#f97316" strokeWidth={strokeM} strokeDasharray="0.1 0.08" opacity={0.6}
              />
              <line
                x1={INNER_W - EDGE_ZONE.width} y1={EDGE_ZONE.width}
                x2={INNER_W - EDGE_ZONE.width} y2={INNER_D - EDGE_ZONE.width}
                stroke="#f97316" strokeWidth={strokeM} strokeDasharray="0.1 0.08" opacity={0.6}
              />
              <text
                x={INNER_W / 2} y={EDGE_ZONE.width - 0.12}
                textAnchor="middle" fontSize={0.13} fill="#c2410c" fontWeight="700"
              >
                краевая зона {(EDGE_ZONE.width * 1000).toFixed(0)} · шаг {(EDGE_ZONE.spacing * 1000).toFixed(0)}
              </text>
            </g>
            {/* Пятна, под которые труба не заходит */}
            {loops.byRoom.flatMap((r) =>
              r.exclusions.map((e, i) => (
                <rect
                  key={`excl-${r.id}-${i}`}
                  x={e.x} y={e.y} width={e.w} height={e.d}
                  fill="#dc2626" fillOpacity={0.07}
                  stroke="#dc2626" strokeWidth={strokeM} strokeDasharray="0.08 0.06"
                />
              ))
            )}

            {/* Труба раскрашена по ходу петли: подача горячая, обратка холодная.
                При встречной укладке рядом всегда оказываются красный и синий —
                это и есть то самое чередование. */}
            {loops.byRoom.flatMap((r) =>
              r.loopPaths.flatMap((pts, i) =>
                pathSegments(pts).map((s, j) => (
                  <line
                    key={`seg-${r.id}-${i}-${j}`}
                    x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
                    stroke={pipeColor(s.t)}
                    strokeWidth={strokeM * 2.4}
                    strokeLinecap="round"
                  />
                ))
              )
            )}

            {/* Подводки от коллектора — только под прямым углом, пучком.
                Каждая труба идёт в своей полосе, диагоналей нет. */}
            {loops.byRoom.flatMap((r) =>
              r.loopPaths.map((pts, i) => {
                const route = loops.supplyByLoop?.[`${r.id}-${i}`];
                if (!route) return null;
                return (
                  <polyline
                    key={`feed-${r.id}-${i}`}
                    points={route.points.map((p) => `${p.x},${p.y}`).join(' ')}
                    fill="none"
                    stroke={LOOP_COLORS[i % LOOP_COLORS.length]}
                    strokeWidth={strokeM * 1.4}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    strokeDasharray="0.14 0.07"
                    opacity={0.75}
                  />
                );
              })
            )}

            {loops.byRoom.map((r) => r.loopPaths.map((pts, i) => pts.length ? (
              <text
                key={`lbl-${r.id}-${i}`}
                x={pts[0].x + 0.08} y={pts[0].y - 0.06}
                fontSize={0.13} fontWeight="700"
                fill={LOOP_COLORS[i % LOOP_COLORS.length]}
              >
                {r.loops > 1 ? `${r.name.slice(0, 3)}-${i + 1}` : r.name.slice(0, 3)} · {r.perLoop.toFixed(0)} м
              </text>
            ) : null))}
          </g>
        )}

        {/* --- Трассы слива --- */}
        {layers.plumbing.visible && showDrainRoutes && drainRoutes.map((r) => (
          <g key={`route-${r.id}`}>
            <polyline
              points={r.points.map((p) => `${p.x},${p.y}`).join(' ')}
              fill="none" stroke="#0f766e"
              strokeWidth={strokeM * (r.dia >= 110 ? 3.5 : 2.2)}
              strokeLinejoin="round" strokeLinecap="round" opacity={0.75}
            />
            <text
              x={(r.points[0].x + r.points[1].x) / 2 + 0.06}
              y={(r.points[0].y + r.points[1].y) / 2}
              fontSize={0.12} fill="#0f766e" fontWeight="600"
            >
              Ø{r.dia} · {r.length.toFixed(2)} м
            </text>
          </g>
        ))}

        {/* --- Точки подключения --- */}
        {layers.equipment.visible && showConnections && allConnections.map((c) => (
          <g key={c.id}>
            <circle cx={c.x} cy={c.y} r={0.055} fill="#fff"
              stroke={CONNECTION_META[c.kind].color} strokeWidth={strokeM * 1.6} />
            <circle cx={c.x} cy={c.y} r={0.022} fill={CONNECTION_META[c.kind].color} />
          </g>
        ))}

        {/* --- Маркеры предупреждений --- */}
        {warnPoints.map((w) => (
          <g key={`warn-${w.id}`}>
            <circle
              cx={w.at.x} cy={w.at.y} r={0.13}
              fill={w.severity === 'error' ? '#fee2e2' : '#fef9c3'}
              stroke={w.severity === 'error' ? '#dc2626' : '#ca8a04'}
              strokeWidth={strokeM * 1.6}
            />
            <text
              x={w.at.x} y={w.at.y + 0.06} textAnchor="middle" fontSize={0.16}
              fill={w.severity === 'error' ? '#dc2626' : '#a16207'} fontWeight="700"
            >
              !
            </text>
          </g>
        ))}

        {focusPoint && (
          <circle cx={focusPoint.x} cy={focusPoint.y} r={0.3} fill="none"
            stroke="#2563eb" strokeWidth={strokeM * 2.5} strokeDasharray="0.1 0.08" />
        )}

        {/* --- Размерные линии --- */}
        {layers.dimensions.visible && (
          <g stroke="#64748b" fill="#334155">
            {/* Габарит 5500 × 5500 снят: он известен и съедал место,
                из-за чего боковые цепочки не помещались в поле. */}

            {/* Цепочка проёмов: от угла до окна, само окно, до следующего.
                Это то, чем реально пользуются на площадке. */}
            {openingChains.map((ch) => (
              <g key={ch.wallId} stroke="#0f766e" fill="#0f766e">
                {ch.horizontal ? (
                  <>
                    <line x1={0} y1={ch.off} x2={INNER_W} y2={ch.off} strokeWidth={strokeM} />
                    {ch.segments.map((s, i) => (
                      <g key={i}>
                        <line x1={s.a} y1={ch.off - 0.07} x2={s.a} y2={ch.off + 0.07} strokeWidth={strokeM} />
                        <line x1={s.b} y1={ch.off - 0.07} x2={s.b} y2={ch.off + 0.07} strokeWidth={strokeM} />
                        <text
                          x={(s.a + s.b) / 2} y={ch.off + (ch.below ? 0.19 : -0.1)}
                          textAnchor="middle" fontSize={0.13} stroke="none"
                          fontWeight={s.opening ? '700' : '400'}
                        >
                          {((s.b - s.a) * 1000).toFixed(0)}
                        </text>
                      </g>
                    ))}
                  </>
                ) : (
                  <>
                    <line x1={ch.off} y1={0} x2={ch.off} y2={INNER_D} strokeWidth={strokeM} />
                    {ch.segments.map((s, i) => (
                      <g key={i}>
                        <line x1={ch.off - 0.07} y1={s.a} x2={ch.off + 0.07} y2={s.a} strokeWidth={strokeM} />
                        <line x1={ch.off - 0.07} y1={s.b} x2={ch.off + 0.07} y2={s.b} strokeWidth={strokeM} />
                        <text
                          x={ch.off + (ch.below ? 0.17 : -0.1)} y={(s.a + s.b) / 2}
                          textAnchor="middle" fontSize={0.13} stroke="none"
                          fontWeight={s.opening ? '700' : '400'}
                          transform={`rotate(-90, ${ch.off + (ch.below ? 0.17 : -0.1)}, ${(s.a + s.b) / 2})`}
                        >
                          {((s.b - s.a) * 1000).toFixed(0)}
                        </text>
                      </g>
                    ))}
                  </>
                )}
              </g>
            ))}

            {/* Цепочка сверху — членится только когда санузел справа */}
            <line x1={0} y1={-0.55} x2={INNER_W} y2={-0.55} strokeWidth={strokeM} />
            {layout.variant === 'bathRight' && (
              <>
                <line x1={layout.bathX} y1={-0.62} x2={layout.bathX} y2={-0.48} strokeWidth={strokeM} />
                <text x={layout.bathX / 2} y={-0.62} textAnchor="middle" fontSize={0.15} stroke="none">
                  {(layout.bathX * 1000).toFixed(0)}
                </text>
                <text x={(layout.bathX + INNER_W) / 2} y={-0.62} textAnchor="middle" fontSize={0.15} stroke="none">
                  {((INNER_W - layout.bathX) * 1000).toFixed(0)}
                </text>
              </>
            )}

            {/* Цепочка справа: глубина санузла в варианте «справа» */}
            {layout.variant === 'bathRight' && (
              <>
                <line x1={INNER_W + 0.55} y1={0} x2={INNER_W + 0.55} y2={INNER_D} strokeWidth={strokeM} />
                <line x1={INNER_W + 0.48} y1={layout.bathY} x2={INNER_W + 0.62} y2={layout.bathY} strokeWidth={strokeM} />
                <text
                  x={INNER_W + 0.62} y={layout.bathY / 2} textAnchor="middle" fontSize={0.15} stroke="none"
                  transform={`rotate(-90, ${INNER_W + 0.62}, ${layout.bathY / 2})`}
                >
                  {(layout.bathY * 1000).toFixed(0)}
                </text>
              </>
            )}

            {/* Цепочка снизу: прихожая | зал */}
            <line x1={0} y1={INNER_D + 0.55} x2={INNER_W} y2={INNER_D + 0.55} strokeWidth={strokeM} />
            <line x1={layout.hallX} y1={INNER_D + 0.48} x2={layout.hallX} y2={INNER_D + 0.62} strokeWidth={strokeM} />
            <text x={layout.hallX / 2} y={INNER_D + 0.75} textAnchor="middle" fontSize={0.15} stroke="none">
              {(layout.hallX * 1000).toFixed(0)}
            </text>

            {/* Цепочка слева: санузел (если он слева) и прихожая */}
            <line x1={-0.55} y1={0} x2={-0.55} y2={INNER_D} strokeWidth={strokeM} />
            <line x1={-0.62} y1={layout.hallY} x2={-0.48} y2={layout.hallY} strokeWidth={strokeM} />
            <text
              x={-0.68} y={(layout.hallY + INNER_D) / 2} textAnchor="middle" fontSize={0.15} stroke="none"
              transform={`rotate(-90, ${-0.68}, ${(layout.hallY + INNER_D) / 2})`}
            >
              {((INNER_D - layout.hallY) * 1000).toFixed(0)}
            </text>
            {layout.variant === 'bathLeft' && (
              <>
                <line x1={-0.62} y1={layout.bathTop} x2={-0.48} y2={layout.bathTop} strokeWidth={strokeM} />
                <text
                  x={-0.68} y={(layout.bathTop + layout.hallY) / 2} textAnchor="middle" fontSize={0.15} stroke="none"
                  transform={`rotate(-90, ${-0.68}, ${(layout.bathTop + layout.hallY) / 2})`}
                >
                  {((layout.hallY - layout.bathTop) * 1000).toFixed(0)}
                </text>
              </>
            )}
          </g>
        )}
      </svg>

      {/* --- Ручки перегородок: тянутся мышкой, за ними едут помещения --- */}
      {layers.architecture.visible && !layers.architecture.locked && partitionHandles.map((h) => {
        const p = toPx(h.x, h.y);
        const horizontal = h.axis === 'y';
        return (
          <Rnd
            key={h.key}
            className="partition-handle"
            enableResizing={false}
            bounds="parent"
            dragAxis={h.axis}
            position={{
              x: horizontal ? p.left : p.left - HANDLE / 2,
              y: horizontal ? p.top - HANDLE / 2 : p.top
            }}
            size={{
              width: horizontal ? h.len * pxPerMeter : HANDLE,
              height: horizontal ? HANDLE : h.len * pxPerMeter
            }}
            onDrag={(e, d) => {
              const w = pxToWorld(
                horizontal ? d.x : d.x + HANDLE / 2,
                horizontal ? d.y + HANDLE / 2 : d.y,
                pxPerMeter
              );
              const raw = h.axis === 'x' ? w.x : w.y;
              onUpdateLayout({ [h.key]: clamp(Math.round(raw * 100) / 100, LAYOUT_LIMITS[h.key]) });
            }}
            style={{ zIndex: 35 }}
          >
            <div className={`ph-grip ${horizontal ? 'h' : 'v'}`} title={`${h.label} — тяните мышкой`} />
          </Rnd>
        );
      })}

      {/* --- Лестница: перетаскивается и растягивается --- */}
      {layers.architecture.visible && stair && (() => {
        const p = toPx(stair.x, stair.y);
        return (
          <PlanObject
            kind="stair"
            id={stair.id}
            label={
              stair.locked
                ? `${stair.name} — позиция зафиксирована: заход и выход по 1 м`
                : `${stair.name} — тяните за края, чтобы сделать марш положе`
            }
            color="rgba(37, 99, 235, 0.05)"
            confirmed={stair.confirmed}
            left={p.left}
            top={p.top}
            widthPx={stair.width * pxPerMeter}
            heightPx={stair.length * pxPerMeter}
            rotation={0}
            // Положение марша определено заходом снизу и площадкой сверху
            // по 1 м. Двигать его — значит ломать это условие молча.
            locked={stair.locked || layers.architecture.locked}
            selected={selectedId === stair.id}
            pxPerMeter={pxPerMeter}
            resizable={!stair.locked}
            onSelect={() => onSelect(stair.id)}
            onMove={(x, y) => !stair.locked && onUpdateStair({ x, y })}
            onResize={({ x, y, w, d }) =>
              !stair.locked && onUpdateStair({ x, y, width: w, length: d })}
            setDraggingObj={setDraggingObj}
          />
        );
      })()}

      {/* --- Инженерные узлы --- */}
      {nodes.map((node) => {
        const layer = layers[node.layer];
        if (!layer || !layer.visible) return null;
        const p = toPx(node.x, node.y);
        return (
          <PlanObject
            key={node.id}
            kind="node"
            id={node.id}
            label={node.name}
            glyph={NODE_GLYPH[node.type] || '■'}
            color={NODE_COLOR[node.type] || '#475569'}
            existing={node.existing}
            confirmed={node.confirmed}
            left={p.left}
            top={p.top}
            widthPx={node.w * pxPerMeter}
            heightPx={node.d * pxPerMeter}
            rotation={0}
            locked={layer.locked}
            selected={selectedId === node.id}
            pxPerMeter={pxPerMeter}
            resizable
            onSelect={() => onSelect(node.id)}
            onMove={(x, y) => onUpdateNode(node.id, { x, y })}
            onResize={({ x, y, w, d }) => onUpdateNode(node.id, { x, y, w, d })}
            setDraggingObj={setDraggingObj}
          />
        );
      })}

      {/* --- Оборудование и электроточки ---
           Каждый предмет живёт на слое своей категории: розетки, выключатели
           и светильники — на «Электрике», остальное — на «Оборудовании». */}
      {equipment.map((item) => {
        const spec = getFixture(item.catalogId);
        if (!spec) return null;
        const layerId = spec.category === 'electrical' ? 'electrical' : 'equipment';
        const layer = layers[layerId];
        if (!layer.visible) return null;
        const size = dims(item);
        const p = toPx(item.x, item.y);
        return (
          <PlanObject
            key={item.id}
            kind={layerId === 'electrical' ? 'electrical' : 'equipment'}
            id={item.id}
            label={spec.name}
            // Выключатель и его лампы одного цвета: иначе на плане не видно,
            // что чем включается
            color={lightGroupColor.map[item.id] ?? spec.color}
            color2={lightGroupColor.second[item.id]}
            left={p.left}
            top={p.top}
            widthPx={size.w * pxPerMeter}
            heightPx={size.d * pxPerMeter}
            rotation={item.rotation || 0}
            locked={layer.locked}
            selected={selectedId === item.id}
            pxPerMeter={pxPerMeter}
            // Электроточка — значок, а не предмет: тянуть её за угол незачем
            resizable={layerId !== 'electrical'}
            onSelect={() => onSelect(item.id)}
            onMove={(x, y) => onUpdateEquipment(item.id, { x, y })}
            onResize={({ x, y, w, d }) => onUpdateEquipment(item.id, { x, y, w, d })}
            setDraggingObj={setDraggingObj}
          />
        );
      })}
    </div>
  );
});

export default Plan;
