import React from 'react';

import { screedStackup } from '../calc/geometry.js';

// Floor-to-foundation junction, vertical section.
//
// The profile is STEPPED, and that is the main thing the drawing shows:
//   • below the screed bottom — XPS 100 mm on the inner face of the foundation,
//     where there is cold ground behind the wall;
//   • at screed height — only a 10 mm damper strip, where behind the wall there is
//     aerated concrete insulated outside, and the gap is needed mostly for expansion.
// The screed rests its edge on top of the edge XPS and reaches the wall,
// so the porcelain tile is laid up to the wall and the strip is trimmed under the skirting.
//
// Vertical scale in mm, left to right: foundation — insulation — build-up.
export default function EdgeDetail({ screed, levels }) {
  const stack = screedStackup(screed);
  const belowFloor = stack.total; // mm of build-up below the finished floor
  const depth = Math.max(levels.edgeInsulationDepth, belowFloor + 80);

  // Drawing area
  const W = 300;
  const H = 210;
  const padTop = 18;
  const scale = (H - padTop - 22) / depth; // px per mm
  const xFound = 12; // left face of the foundation
  const wFound = 40;
  const xEdge = xFound + wFound;

  const wEdge = Math.max(6, (levels.edgeInsulation || 0) * 0.5); // thick part
  const wStrip = Math.max(2.5, (levels.edgeStrip ?? 0) * 0.5); // strip at the screed

  const xPie = xEdge + wEdge; // bottom of the build-up — inside the thick insulation
  const xTop = xEdge + wStrip; // screed and tile — almost to the wall
  const right = W - 66;

  const y = (mmBelowFloor) => padTop + mmBelowFloor * scale;
  const edgeTop = levels.edgeInsulation ? (levels.edgeTop ?? 0) : null;

  const sc = stack.layers.find((l) => l.id === 'screed');
  const screedBottom = sc.bottom; // mm below the finished floor
  const wide = new Set(['finish', 'screed']); // layers that run right up to the wall

  return (
    <svg className="edge-detail" viewBox={`0 0 ${W} ${H}`} width="100%">
      {/* Foundation */}
      <rect x={xFound} y={padTop - 12} width={wFound} height={H - padTop}
        fill="#cbd5e1" stroke="#64748b" strokeWidth="1" />
      <text x={xFound + wFound / 2} y={H - 3} textAnchor="middle" fontSize="8" fill="#475569">
        foundation
      </text>

      {/* Sand fill under the build-up */}
      <rect x={xPie} y={y(stack.total)} width={right - xPie} height={H - y(stack.total) - 12}
        fill="#fef3c7" stroke="#d6d3d1" strokeWidth="0.5" />
      <text x={(xPie + right) / 2} y={y(stack.total) + 15} textAnchor="middle" fontSize="8" fill="#92400e">
        sand, compacted
      </text>

      {/* Build-up layers. Screed and tile are wider than the rest — they pass
              over the edge insulation and reach the wall */}
      {stack.layers.map((l) => {
        const x0 = wide.has(l.id) ? xTop : xPie;
        return (
          <rect key={l.id} x={x0} y={y(l.top)} width={right - x0}
            height={Math.max(1.5, l.thickness * scale)}
            fill={l.color} stroke="#94a3b8" strokeWidth="0.4" />
        );
      })}

      {/* Heating pipe inside the screed */}
      {[0.35, 0.6, 0.85].map((f) => (
        <circle key={f} cx={xTop + (right - xTop) * f}
          cy={y(sc.bottom) - (screed.pipeOd / 2) * scale}
          r={Math.max(2, (screed.pipeOd / 2) * scale)}
          fill="#fecaca" stroke="#dc2626" strokeWidth="0.8" />
      ))}

      {/* Edge insulation: thick part below the screed */}
      {levels.edgeInsulation > 0 && (
        <>
          <rect x={xEdge} y={y(screedBottom)} width={wEdge}
            height={Math.max(2, (levels.edgeInsulationDepth - screedBottom) * scale)}
            fill="#38bdf8" stroke="#0369a1" strokeWidth="1" />
          <text x={xEdge + wEdge + 4} y={y(levels.edgeInsulationDepth) - 4}
            fontSize="8" fill="#0369a1" fontWeight="600">
            XPS {levels.edgeInsulation} by {levels.edgeInsulationDepth} down
          </text>
        </>
      )}

      {/* Damper strip at screed height — the same gap, but thin */}
      {(levels.edgeStrip ?? 0) > 0 && (
        <>
          <rect x={xEdge} y={y(edgeTop ?? 0)} width={wStrip}
            height={Math.max(2, (screedBottom - (edgeTop ?? 0)) * scale)}
            fill="#f472b6" stroke="#be185d" strokeWidth="0.8" />
          <text x={right + 3} y={y(screedBottom / 2) + 3} fontSize="8" fill="#be185d" fontWeight="600">
            strip {levels.edgeStrip}
          </text>
        </>
      )}

      {/* Finished floor level */}
      <line x1={xFound} y1={y(0)} x2={W - 6} y2={y(0)} stroke="#0f172a" strokeWidth="1.2" strokeDasharray="4 3" />
      <text x={W - 6} y={y(0) - 5} textAnchor="end" fontSize="8.5" fill="#0f172a" fontWeight="700">
        finished floor 0.000
      </text>

      {/* Screed bottom — this is where the profile changes thickness */}
      <line x1={xEdge} y1={y(screedBottom)} x2={right} y2={y(screedBottom)}
        stroke="#b45309" strokeWidth="0.8" strokeDasharray="2 2" />
      <text x={right} y={y(screedBottom) + 9} textAnchor="end" fontSize="7.5" fill="#b45309">
        screed bottom — the profile steps here
      </text>
    </svg>
  );
}
