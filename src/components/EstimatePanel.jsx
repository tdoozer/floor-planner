import React from 'react';

import { CLEAR_HEIGHT } from '../data/project.js';
import { heatLoss } from '../calc/heatloss.js';
import { layoutLoops } from '../calc/loops.js';
import { electricalPlan } from '../calc/electrical.js';
import { floorEstimate, pipeCutting } from '../calc/estimate.js';
import { boilerRoomPlan } from '../calc/boilerRoom.js';
import { lowVoltagePlan } from '../calc/lowVoltage.js';
import { emergencyPanel } from '../calc/emergencyPanel.js';
import { panelPlan } from '../calc/panel.js';
import { systemHydraulics } from '../calc/hydraulics.js';

const fmt = (v, unit) => {
  if (unit === 'pcs' || unit === 'set' || unit === 'cyl.') return Math.ceil(v).toString();
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
};

// Sums are always in thousands of ₽ — the unit is labelled in the table header,
// not glued to every number. It used to come out as “50 k k ₽”.
const rub = (v) => (v >= 100000 ? Math.round(v / 1000) : (v / 1000).toFixed(1));

export default function EstimatePanel({ project }) {
  const hl = heatLoss({
    layout: project.layout,
    openings: project.openings,
    climate: project.climate,
    envelope: project.envelope,
    screed: project.screed,
    clearHeight: CLEAR_HEIGHT
  });
  const loops = layoutLoops({
    layout: project.layout,
    heatLossByRoom: hl.byRoom,
    manifold: project.nodes.find((n) => n.type === 'manifold'),
    coolant: project.coolant,
    spacings: project.loopSpacings,
    equipment: project.equipment,
    exclusionZones: project.floorExclusionZones,
    mode: project.loopMode,
    kitchenOnFrame: project.kitchenOnFrame
  });
  const electrical = electricalPlan({
    equipment: project.equipment,
    entry: project.nodes.find((n) => n.type === 'electrical_panel')
  });

  const hyd = systemHydraulics({
    loops: loops.byRoom.flatMap((r) =>
      Array.from({ length: r.loops }, () => ({
        powerW: r.roomLoadW / r.loops,
        lengthM: r.perLoop
      }))
    ),
    coolant: project.coolant
  });
  const boilerRoom = boilerRoomPlan({
    boiler: project.boiler,
    coolant: project.coolant,
    loops,
    flowLh: hyd.totalFlowLh,
    screedArea: hl.area
  });

  const est = floorEstimate({
    layout: project.layout,
    screed: project.screed,
    levels: project.levels,
    loops,
    coolant: project.coolant,
    electrical,
    stair: project.stair,
    boilerRoom,
    equipment: project.equipment,
    lowVoltage: lowVoltagePlan(),
    emergency: emergencyPanel({ inverterW: project.ups?.inverterW ?? 400 }),
    panel: panelPlan()
  });

  const loopLengths = loops.byRoom.flatMap((r) =>
    Array.from({ length: r.loops }, () => Math.ceil(r.perLoop))
  );
  const cut = pipeCutting(loopLengths);

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <span>Materials total</span>
          <span className="muted">{est.items.length} items</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr className="head-row">
              <td>Estimate, k ₽</td>
              <td className="num">from</td>
              <td className="num">average</td>
              <td className="calc-target">to</td>
            </tr>
            <tr>
              <td><b>Everything</b></td>
              <td className="num">{rub(est.totals.min)}</td>
              <td className="num"><b>{rub(est.totals.avg)}</b></td>
              <td className="calc-target">{rub(est.totals.max)}</td>
            </tr>
            {est.byGroup.map((g) => (
              <tr key={g.group}>
                <td>{g.group}</td>
                <td className="num">{rub(g.min)}</td>
                <td className="num">{rub(g.avg)}</td>
                <td className="calc-target">{rub(g.max)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="panel-note">
          <b>Materials</b> only — labour is not included.
          Calculated at the average price. {est.meta.source}.{' '}
          <b>These are not quotes:</b> {est.meta.disclaimer}
        </p>
      </section>

      {est.byGroup.map((g) => (
        <section className="panel" key={g.group}>
          <div className="panel-head">
            <span>{g.group}</span>
            <span className="muted">{rub(g.avg)} k ₽</span>
            {/* rub() returns thousands, so “k ₽” is labelled only once */}
          </div>
          <table className="mini-table">
            <tbody>
              {g.rows.map((i) => (
                <tr key={i.name}>
                  <td>
                    {i.name}
                    <div style={{ fontSize: 10, color: '#94a3b8', lineHeight: 1.35 }}>
                      {i.note}
                      {i.pack && <> · {i.pack.label}</>}
                      {i.cost.priced && (
                        <> · {Math.round(i.cost.unitMin)}…{Math.round(i.cost.unitMax)} ₽/{i.unit}</>
                      )}
                    </div>
                  </td>
                  <td className="num" style={{ whiteSpace: 'nowrap', verticalAlign: 'top' }}>
                    {fmt(i.qty, i.unit)} {i.unit}
                    {i.pack && (
                      <div style={{ fontSize: 11, color: '#0f172a', fontWeight: 600 }}>
                        {i.pack.count} {i.pack.unit}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: '#64748b' }}>
                      {i.cost.priced ? `${Math.round(i.cost.avg)} ₽` : 'no price'}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <section className="panel">
        <div className="panel-head">
          <span>Cutting pipe from coils</span>
          <span className="muted">{cut.totalOrdered} m</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr className="head-row">
              <td>Coil</td>
              <td className="num">cut into</td>
              <td className="calc-target">left over</td>
            </tr>
            {cut.coils.map((c, i) => (
              <tr key={i}>
                <td>{c.size} m</td>
                <td className="num">{c.cuts.join(' + ')} m</td>
                <td className="calc-target">{c.left.toFixed(0)} m</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="panel-note">
          <b>Every loop is a single piece.</b> There must be no joints in the screed:
          they can be neither inspected nor tightened. The cutting plan is chosen so that
          {cut.waste.toFixed(0)} m of offcuts remain.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head"><span>What the estimate does NOT include</span></div>
        <p className="panel-note" style={{ marginTop: 0 }}>
          Finishing (plaster, porcelain tile, bathroom tiling, ceilings),
          plumbing distribution, ventilation ducts, the UPS and labour.
          There are no decisions or quantities for these yet, and invented quantities
          must not be passed off as a specification.
        </p>
      </section>
    </>
  );
}
