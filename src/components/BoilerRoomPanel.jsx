import React from 'react';

import BoilerScheme from './BoilerScheme.jsx';
import { CLEAR_HEIGHT } from '../data/project.js';
import { boilerRoomPlan } from '../calc/boilerRoom.js';
import { heatLoss } from '../calc/heatloss.js';
import { layoutLoops } from '../calc/loops.js';
import { systemHydraulics } from '../calc/hydraulics.js';
import { coolantAge } from '../data/coolant.js';

// Boiler-room panel: the piping diagram plus two lists —
// what is already inside the boiler and what has to be bought. The split matters more than the diagram:
// typical solutions from the internet duplicate what is built in.
export default function BoilerRoomPanel({ project }) {
  const { layout, openings, climate, envelope, screed, coolant, boiler, nodes, equipment } = project;

  const hl = heatLoss({ layout, openings, climate, envelope, screed, clearHeight: CLEAR_HEIGHT });
  const loops = layoutLoops({
    layout,
    heatLossByRoom: hl.byRoom,
    manifold: nodes.find((n) => n.type === 'manifold'),
    coolant,
    spacings: project.loopSpacings,
    equipment,
    exclusionZones: project.floorExclusionZones,
    mode: project.loopMode,
    kitchenOnFrame: project.kitchenOnFrame
  });
  const hyd = systemHydraulics({
    loops: loops.byRoom.flatMap((r) =>
      Array.from({ length: r.loops }, () => ({
        powerW: r.roomLoadW / r.loops,
        lengthM: r.perLoop
      }))
    ),
    coolant
  });
  const plan = boilerRoomPlan({
    boiler,
    coolant,
    loops,
    flowLh: hyd.totalFlowLh,
    screedArea: hl.area
  });
  const age = coolantAge(coolant);

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <span>Piping diagram</span>
          <span className="pill">direct, low-temperature</span>
        </div>

        <BoilerScheme plan={plan} boiler={boiler} loops={loops} />

        <p className="panel-note">
          There is deliberately no mixing unit or hydraulic separator in the scheme. The boiler itself
          holds {boiler.lowTempParam.cap} °C with parameter{' '}
          <b>{boiler.lowTempParam.code} = {boiler.lowTempParam.value}</b>, its own pump is
          enough with a ×{hyd.marginRatio.toFixed(1)} margin, and a separator would cut the
          boiler off from the screed mass — the only thing that stretches the burner cycle.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>System volume and expansion</span>
          <span className={`pill ${plan.expansion.ok ? '' : 'error'}`}>
            {plan.expansion.ok ? `margin ×${plan.expansion.margin.toFixed(1)}` : 'vessel too small'}
          </span>
        </div>
        <table className="mini-table">
          <tbody>
            <tr><td>Loops, {loops.totalPipe.toFixed(0)} m of pipe</td><td className="num">{plan.volume.loopsL.toFixed(1)} l</td></tr>
            <tr><td>Boiler</td><td className="num">{plan.volume.boilerL.toFixed(1)} l</td></tr>
            <tr><td>Manifold</td><td className="num">{plan.volume.manifoldL.toFixed(1)} l</td></tr>
            <tr><td>Connections</td><td className="num">{plan.volume.connectionsL.toFixed(1)} l</td></tr>
            <tr className="accent"><td>Ground floor total</td><td className="num">{plan.volume.totalL.toFixed(0)} l</td></tr>
            <tr><td>Expansion on heating</td><td className="num">{plan.expansion.deltaV.toFixed(2)} l</td></tr>
            <tr><td>Required vessel</td><td className="num">{plan.expansion.requiredL.toFixed(1)} l</td></tr>
            <tr className="accent"><td>Built-in vessel</td><td className="num">{plan.expansion.vesselL} l</td></tr>
          </tbody>
        </table>
        <p className="panel-note">
          The attic circuit is <b>not included</b> in the volume — it is outside the scope of work.
          Set the vessel precharge to {plan.expansion.prechargeBar} bar
          <b> before filling</b>, otherwise the rated capacity does not work.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Built into the boiler</span>
          <span className="pill">no need to buy</span>
        </div>
        <table className="mini-table">
          <tbody>
            {plan.builtIn.map((p) => (
              <tr key={p.id}><td>{p.name}</td><td className="muted">{p.why}</td></tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panel-head"><span>To buy</span></div>
        <table className="mini-table">
          <tbody>
            {plan.required.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td className="num">{p.qty} {p.unit}</td>
                <td className="muted">{p.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Make-up</span>
          {plan.toxic && <span className="pill error">coolant is toxic</span>}
        </div>
        <p><b>{plan.makeup.name}</b> — {plan.makeup.mode}</p>
        <p className="panel-note">{plan.makeup.why}</p>
        {age?.expired && (
          <p className="panel-note">
            The filled fluid was manufactured {coolant.manufactured}, service life{' '}
            {coolant.shelfLifeYears} years — <b>expired by {age.overdueYears.toFixed(0)} years</b>.
            The inhibitors are used up. Replace it when filling the underfloor heating:
            there will not be a second such opportunity.
          </p>
        )}
      </section>
    </>
  );
}
