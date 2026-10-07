import React from 'react';

import { CLEAR_HEIGHT } from '../data/project.js';
import { heatLoss } from '../calc/heatloss.js';
import { layoutLoops } from '../calc/loops.js';
import { systemHydraulics } from '../calc/hydraulics.js';

const mm = (m) => `${Math.round(m * 1000)}`;

export default function LoopsPanel({
  project,
  onUpdateSpacing,
  onUpdateEnvelope,
  onUpdateKitchenFrame
}) {
  const {
    climate, envelope, screed, layout, openings, coolant, nodes, equipment,
    loopSpacings = {}
  } = project;

  const hl = heatLoss({ layout, openings, climate, envelope, screed, clearHeight: CLEAR_HEIGHT });
  const manifold = nodes.find((n) => n.type === 'manifold');
  const L = layoutLoops({
    layout,
    heatLossByRoom: hl.byRoom,
    manifold,
    coolant,
    spacings: loopSpacings,
    equipment,
    exclusionZones: project.floorExclusionZones,
    mode: project.loopMode,
    kitchenOnFrame: project.kitchenOnFrame
  });

  const H = systemHydraulics({
    loops: L.byRoom.flatMap((r) =>
      Array.from({ length: r.loops }, () => ({ powerW: r.roomLoadW / r.loops, lengthM: r.perLoop }))
    ),
    coolant
  });

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <span>Underfloor heating loops</span>
          <span className="muted">{L.totalLoops} pcs · {L.totalPipe.toFixed(0)} m</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr className="head-row">
              <td>Room</td>
              <td className="num">pitch · pipe</td>
              <td className="calc-target">loops</td>
            </tr>
            {L.byRoom.map((r) => (
              <tr key={r.id} className={r.loops > 1 ? 'calc-off' : ''}>
                <td>{r.name}</td>
                <td className="num">{mm(r.spacing)} · {r.totalPipe.toFixed(0)} m</td>
                <td className="calc-target">
                  {r.loops} × {r.perLoop.toFixed(0)} m
                </td>
              </tr>
            ))}
            <tr className="total">
              <td>Loop limit</td>
              <td className="num">{L.limit.toFixed(0)} m</td>
              <td className="calc-target">antifreeze</td>
            </tr>
          </tbody>
        </table>
        <p className="panel-note">
          The bathroom and the hall have separate loops, as requested. The living room does not fit
          into one loop: even at a wide pitch it needs more pipe
          than the {L.limit.toFixed(0)} m limit allows.
          Length imbalance is {(L.imbalance * 100).toFixed(0)} % — balancing valves
          on the manifold are mandatory.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Usable floor area</span>
          <span className="muted">furniture subtracted</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr className="head-row">
              <td>Room</td>
              <td className="num">occupied</td>
              <td className="calc-target">W/m² now</td>
            </tr>
            {L.byRoom.map((r) => (
              <tr key={r.id} className={r.deficit ? 'calc-off' : ''}>
                <td>{r.name}</td>
                <td className="num">{r.excludedArea.toFixed(2)} m²</td>
                <td className="calc-target">
                  {r.requiredBare.toFixed(0)} → {r.requiredWm2.toFixed(0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <label className="check">
          <input
            type="checkbox"
            checked={!!project.kitchenOnFrame}
            onChange={(e) => onUpdateKitchenFrame(e.target.checked)}
          />
          Kitchen on an open frame
        </label>
        <label className="full-field">
          Air change rate, 1/h
          <input
            type="number" step="0.1" value={envelope.ventilationAch}
            onChange={(e) => onUpdateEnvelope({ ventilationAch: Number(e.target.value) })}
          />
        </label>
        <p className="panel-note">
          No pipe is laid under kitchen cabinets, the fridge, the shower tray or the washing
          machine: the heat gets trapped there and does not reach the room.
          The area is lost but the load remains — so the requirement on the remaining
          square metres goes up. Furniture on legs with a gap of 50 mm or more is not excluded:
          untick the sofa or benches and the area comes back.
          The air change rate is the most sensitive parameter of the whole calculation.
        </p>
        <p className="panel-note">
          <b>Kitchen on a frame</b> — a concrete worktop on posts with a ventilated
          gap under the front. Then the solid zones disappear and only appliances
          standing on the floor are excluded: the fridge, dishwasher, oven,
          washing machine, plus the sink (trap and filter) and the hob (gas and access
          to it). Worktops and blind cabinets move onto the frame — pipe runs under them.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Hydraulics and pump</span>
          <span className="muted">{H.totalFlowLh.toFixed(0)} l/h</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr>
              <td>Worst loop</td>
              <td className="num">{H.worst.dropM.toFixed(2)} m</td>
              <td className="calc-target">{H.worst.velocity.toFixed(2)} m/s</td>
            </tr>
            <tr>
              <td>With local losses</td>
              <td className="num">{H.requiredHeadM.toFixed(2)} m</td>
              <td className="calc-target">required</td>
            </tr>
            <tr className={H.boilerPumpEnough ? '' : 'calc-off'}>
              <td>Boiler pump</td>
              <td className="num">≈ {H.boilerHeadM} m</td>
              <td className="calc-target">
                {H.boilerPumpEnough ? '✓' : '✕'} margin {H.margin.toFixed(2)} m
              </td>
            </tr>
            <tr className="calc-off">
              <td>Flow regime</td>
              <td className="num">Re {H.worst.reynolds.toFixed(0)}</td>
              <td className="calc-target">{H.anyLaminar ? 'laminar' : 'turbulent'}</td>
            </tr>
          </tbody>
        </table>
        <p className="panel-note">
          The boiler pump head is enough with a margin. But {H.boilerHeadM} m is an
          <b> assumption</b>, check it against the pump curve in the data sheet.
          The flow is <b>laminar</b> because of the antifreeze viscosity: heat transfer from the pipe
          to the concrete is worse than in a turbulent regime, and this is already covered by the margin
          on the pitch. A separate pump on the manifold is still justified —
          it gives continuous circulation independent of the boiler logic.
        </p>
      </section>

      {L.byRoom.map((r) => (
        <section className="panel" key={r.id}>
          <div className="panel-head">
            <span>{r.name}</span>
            <span className="muted">need {r.requiredWm2.toFixed(0)} W/m²</span>
          </div>
          <table className="mini-table calc-table">
            <tbody>
              <tr className="head-row">
                <td>Pitch</td>
                <td className="num">output</td>
                <td className="calc-target">pipe · loops</td>
              </tr>
              {r.candidates.map((c) => {
                const margin = c.capacity / r.requiredWm2 - 1;
                const chosen = c.spacing === r.spacing;
                return (
                  <tr
                    key={c.spacing}
                    className={`${chosen ? 'calc-current' : ''} ${c.enough ? '' : 'calc-off'}`}
                  >
                    <td>
                      <button className="link-btn" onClick={() => onUpdateSpacing(r.id, c.spacing)}>
                        {mm(c.spacing)} mm
                      </button>
                    </td>
                    <td className="num">
                      {c.capacity.toFixed(0)}
                      {c.enough && <span className="muted"> +{(margin * 100).toFixed(0)}%</span>}
                    </td>
                    <td className="calc-target">
                      {c.enough ? '✓' : '✕'} {c.totalPipe.toFixed(0)} m · {c.loops}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="panel-note">
            Surface temperature is limited to {r.maxFloorTemp} °C at an air temperature of{' '}
            {r.airTemp} °C. The feed from the manifold is {r.supplyRunM.toFixed(1)} m
            one way, and counts twice in the loop length.
            {r.candidates.find((c) => c.spacing === r.spacing)?.capacity / r.requiredWm2 < 1.1 && (
              <> <b>Margin below 10 % — consider a finer pitch.</b></>
            )}
          </p>
        </section>
      ))}
    </>
  );
}
