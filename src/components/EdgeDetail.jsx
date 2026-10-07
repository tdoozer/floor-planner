import React from 'react';

import { screedStackup } from '../calc/geometry.js';

// Узел примыкания пола к фундаменту, вертикальный разрез.
//
// Профиль СТУПЕНЧАТЫЙ, и это главное, что показывает чертёж:
//   • ниже низа стяжки — ЭППС 100 мм по внутренней грани фундамента,
//     там за стеной холодный грунт;
//   • на высоте самой стяжки — только демпферная лента 10 мм, там за стеной
//     газобетон, утеплённый снаружи, и разрыв нужен скорее на расширение.
// Стяжка опирается краем на верх торцевого ЭППС и доходит до стены,
// поэтому керамогранит кладётся до стены, а лента подрезается под плинтус.
//
// Масштаб по вертикали в мм, слева направо: фундамент — утеплитель — пирог.
export default function EdgeDetail({ screed, levels }) {
  const stack = screedStackup(screed);
  const belowFloor = stack.total; // мм пирога ниже чистого пола
  const depth = Math.max(levels.edgeInsulationDepth, belowFloor + 80);

  // Поле рисунка
  const W = 300;
  const H = 210;
  const padTop = 18;
  const scale = (H - padTop - 22) / depth; // px на мм
  const xFound = 12; // левая грань фундамента
  const wFound = 40;
  const xEdge = xFound + wFound;

  const wEdge = Math.max(6, (levels.edgeInsulation || 0) * 0.5); // толстая часть
  const wStrip = Math.max(2.5, (levels.edgeStrip ?? 0) * 0.5); // лента у стяжки

  const xPie = xEdge + wEdge; // низ пирога — внутри толстого утеплителя
  const xTop = xEdge + wStrip; // стяжка и плитка — почти до стены
  const right = W - 66;

  const y = (mmBelowFloor) => padTop + mmBelowFloor * scale;
  const edgeTop = levels.edgeInsulation ? (levels.edgeTop ?? 0) : null;

  const sc = stack.layers.find((l) => l.id === 'screed');
  const screedBottom = sc.bottom; // мм ниже чистого пола
  const wide = new Set(['finish', 'screed']); // слои, идущие до самой стены

  return (
    <svg className="edge-detail" viewBox={`0 0 ${W} ${H}`} width="100%">
      {/* Фундамент */}
      <rect x={xFound} y={padTop - 12} width={wFound} height={H - padTop}
        fill="#cbd5e1" stroke="#64748b" strokeWidth="1" />
      <text x={xFound + wFound / 2} y={H - 3} textAnchor="middle" fontSize="8" fill="#475569">
        фундамент
      </text>

      {/* Песчаная засыпка под пирогом */}
      <rect x={xPie} y={y(stack.total)} width={right - xPie} height={H - y(stack.total) - 12}
        fill="#fef3c7" stroke="#d6d3d1" strokeWidth="0.5" />
      <text x={(xPie + right) / 2} y={y(stack.total) + 15} textAnchor="middle" fontSize="8" fill="#92400e">
        песок, уплотнён
      </text>

      {/* Слои пирога. Стяжка и плитка шире остальных — они проходят
          над торцевым утеплителем и доходят до стены */}
      {stack.layers.map((l) => {
        const x0 = wide.has(l.id) ? xTop : xPie;
        return (
          <rect key={l.id} x={x0} y={y(l.top)} width={right - x0}
            height={Math.max(1.5, l.thickness * scale)}
            fill={l.color} stroke="#94a3b8" strokeWidth="0.4" />
        );
      })}

      {/* Труба ТП внутри стяжки */}
      {[0.35, 0.6, 0.85].map((f) => (
        <circle key={f} cx={xTop + (right - xTop) * f}
          cy={y(sc.bottom) - (screed.pipeOd / 2) * scale}
          r={Math.max(2, (screed.pipeOd / 2) * scale)}
          fill="#fecaca" stroke="#dc2626" strokeWidth="0.8" />
      ))}

      {/* Торцевой утеплитель: толстая часть ниже стяжки */}
      {levels.edgeInsulation > 0 && (
        <>
          <rect x={xEdge} y={y(screedBottom)} width={wEdge}
            height={Math.max(2, (levels.edgeInsulationDepth - screedBottom) * scale)}
            fill="#38bdf8" stroke="#0369a1" strokeWidth="1" />
          <text x={xEdge + wEdge + 4} y={y(levels.edgeInsulationDepth) - 4}
            fontSize="8" fill="#0369a1" fontWeight="600">
            ЭППС {levels.edgeInsulation} на {levels.edgeInsulationDepth} вниз
          </text>
        </>
      )}

      {/* Демпферная лента на высоте стяжки — тот же разрыв, но тонкий */}
      {(levels.edgeStrip ?? 0) > 0 && (
        <>
          <rect x={xEdge} y={y(edgeTop ?? 0)} width={wStrip}
            height={Math.max(2, (screedBottom - (edgeTop ?? 0)) * scale)}
            fill="#f472b6" stroke="#be185d" strokeWidth="0.8" />
          <text x={right + 3} y={y(screedBottom / 2) + 3} fontSize="8" fill="#be185d" fontWeight="600">
            лента {levels.edgeStrip}
          </text>
        </>
      )}

      {/* Уровень чистого пола */}
      <line x1={xFound} y1={y(0)} x2={W - 6} y2={y(0)} stroke="#0f172a" strokeWidth="1.2" strokeDasharray="4 3" />
      <text x={W - 6} y={y(0) - 5} textAnchor="end" fontSize="8.5" fill="#0f172a" fontWeight="700">
        чистый пол 0.000
      </text>

      {/* Низ стяжки — здесь профиль и меняет толщину */}
      <line x1={xEdge} y1={y(screedBottom)} x2={right} y2={y(screedBottom)}
        stroke="#b45309" strokeWidth="0.8" strokeDasharray="2 2" />
      <text x={right} y={y(screedBottom) + 9} textAnchor="end" fontSize="7.5" fill="#b45309">
        низ стяжки — здесь ступень профиля
      </text>
    </svg>
  );
}
