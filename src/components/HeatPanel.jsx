import React from 'react';

import { CLEAR_HEIGHT } from '../data/project.js';
import { gsop, requiredWallR } from '../data/climate.js';
import { maxLoopLength, volumetricRatio } from '../data/coolant.js';
import { heatLoss } from '../calc/heatloss.js';
import { boilerCheck, houseCooldown } from '../calc/boiler.js';
import { upsSizing } from '../calc/ups.js';
import { windowsCheck } from '../calc/condensation.js';
import { ventilationPlan } from '../calc/ventilation.js';
import { buildRooms } from '../data/project.js';
import { polygonArea } from '../calc/geometry.js';

const w = (v) => `${Math.round(v)} W`;

export default function HeatPanel({ project, onUpdateClimate, onUpdateEnvelope }) {
  const { climate, envelope, boiler, screed, layout, openings, coolant } = project;

  const hl = heatLoss({ layout, openings, climate, envelope, screed, clearHeight: CLEAR_HEIGHT });
  const bc = boilerCheck({
    boiler,
    loadKw: hl.totalKw,
    areaM2: hl.area,
    screed,
    pipeVolumeL: 40,
    coolantRatio: volumetricRatio(coolant)
  });
  const rReq = requiredWallR(climate);
  const cool = houseCooldown({
    screedMassKg: bc.screedMass.massKg,
    uaWPerK: hl.total / (climate.tInLiving - climate.tOutDesign),
    tStart: climate.tInLiving + 2,
    tOut: climate.tOutDesign
  });
  const ups = upsSizing({ boilerW: boiler.electric, targetHours: cool.hours });
  const rooms = buildRooms(layout);
  const vent = ventilationPlan({
    bathArea: polygonArea(rooms.find((r) => r.id === 'bath').polygon),
    kitchenArea: polygonArea(rooms.find((r) => r.id === 'living').polygon),
    height: CLEAR_HEIGHT,
    gasHob: true
  });
  const windows = windowsCheck({
    openings,
    envelope,
    climate,
    rh: 50,
    roomTemp: { living: climate.tInLiving, bath: climate.tInBath, hall: climate.tInHall }
  });

  return (
    <>
      <section className="panel">
        <div className="panel-head"><span>Site and climate</span></div>
        <p className="panel-note" style={{ marginTop: 0 }}>{climate.place}</p>
        <div className="field-grid">
          <label>
            Design outdoor temperature, °C
            <input
              type="number" value={climate.tOutDesign}
              onChange={(e) => onUpdateClimate({ tOutDesign: Number(e.target.value) })}
            />
          </label>
          <label>
            In the living zone, °C
            <input
              type="number" value={climate.tInLiving}
              onChange={(e) => onUpdateClimate({ tInLiving: Number(e.target.value) })}
            />
          </label>
        </div>
        {!climate.confirmed && (
          <p className="panel-note">
            Climate parameters for the weather station “{climate.station}” are given as
            a guideline and must be checked against the current SP 131.13330.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head"><span>Building envelope</span></div>
        <div className="field-grid">
          <label>
            Aerated concrete, mm
            <input
              type="number" step="25" value={envelope.wall.thickness}
              onChange={(e) => onUpdateEnvelope({ wall: { ...envelope.wall, thickness: Number(e.target.value) } })}
            />
          </label>
          <label>
            Block λ, W/(m·K)
            <input
              type="number" step="0.01" value={envelope.wall.lambda}
              onChange={(e) => onUpdateEnvelope({ wall: { ...envelope.wall, lambda: Number(e.target.value) } })}
            />
          </label>
          <label>
            Exterior XPS, mm
            <input
              type="number" step="10" value={envelope.wallInsulation.thickness}
              onChange={(e) => onUpdateEnvelope({
                wallInsulation: { ...envelope.wallInsulation, thickness: Number(e.target.value) }
              })}
            />
          </label>
          <label>
            Window U, W/(m²·K)
            <input
              type="number" step="0.1" value={envelope.window.u}
              onChange={(e) => onUpdateEnvelope({ window: { ...envelope.window, u: Number(e.target.value) } })}
            />
          </label>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr>
              <td>Wall R</td>
              <td className="num">{hl.rWall.toFixed(2)}</td>
              <td className="calc-target">{hl.rWall >= rReq ? '✓' : '✕'} norm {rReq.toFixed(2)}</td>
            </tr>
            <tr>
              <td>Wall U</td>
              <td className="num">{hl.uWall.toFixed(3)}</td>
              <td className="calc-target">W/(m²·K)</td>
            </tr>
            <tr>
              <td>HDD</td>
              <td className="num">{gsop(climate).toFixed(0)}</td>
              <td className="calc-target">°C·day</td>
            </tr>
          </tbody>
        </table>
        <p className="panel-note">
          Required R = 0.00035·HDD + 1.4 per SP 50.13330 — the coefficients are given
          from memory and need checking. The wall already{' '}
          {hl.rWall >= rReq ? 'exceeds the norm' : 'falls short of the norm'}
          {hl.rWall >= rReq ? `, margin ${((hl.rWall / rReq - 1) * 100).toFixed(0)} %` : ''}.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Ground-floor heat loss</span>
          <span className="muted">{hl.totalKw.toFixed(2)} kW</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr className="head-row">
              <td>Room</td>
              <td className="num">W</td>
              <td className="calc-target">W/m²</td>
            </tr>
            {hl.byRoom.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="num">{w(r.total)}</td>
                <td className="calc-target">{r.perM2.toFixed(0)}</td>
              </tr>
            ))}
            <tr className="total">
              <td>Total</td>
              <td className="num">{w(hl.total)}</td>
              <td className="calc-target">{hl.perM2.toFixed(0)}</td>
            </tr>
          </tbody>
        </table>
        <p className="panel-note">
          The attic is not part of the calculation: the roof is not insulated yet, and insulation
          is planned separately. After it the house load will drop even further —
          the system has to be sized for the future state, not the current one.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Boiler {boiler.model}</span>
        </div>
        <table className="mini-table">
          <tbody>
            <tr><td>Nominal output</td><td className="num">{boiler.powerNominal} kW</td></tr>
            <tr className="calc-off">
              <td>Minimum output</td>
              <td className="num">{boiler.powerMin} kW</td>
            </tr>
            <tr><td>DHW</td><td className="num">{boiler.dhwFlow} l/min</td></tr>
            <tr className="total">
              <td>Excess over the load</td>
              <td className="num">×{bc.ratio.toFixed(1)}</td>
            </tr>
          </tbody>
        </table>

        <div className="panel-head" style={{ marginTop: 10 }}>
          <span>Burner cycle by scheme</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr className="head-row">
              <td>Scheme</td>
              <td className="num">volume</td>
              <td className="calc-target">cycle</td>
            </tr>
            {bc.schemes.map((s) => (
              <tr key={s.id} className={s.ok ? '' : 'calc-off'}>
                <td title={s.note}>{s.name}</td>
                <td className="num">{s.volumeL.toFixed(0)} l</td>
                <td className="calc-target">
                  {s.ok ? '✓' : '✕'} {s.cycleMinutes.toFixed(0)} min
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="panel-note">
          The boiler is sized by hot water: to deliver {boiler.dhwFlow} l/min it needs
          {' '}{boiler.powerNominal} kW. Heating never needs that much.
          The {bc.screedMass.massKg.toFixed(0)} kg of screed has the heat capacity of
          {' '}{bc.screedMass.waterEquivalentL.toFixed(0)} l of water — if the underfloor heating is
          connected directly to the boiler at low temperature, this mass acts as
          a free buffer and no space is spent in the hall.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Windows: fogging and frost</span>
          <span className="muted">at {climate.tOutDesign} °C</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr className="head-row">
              <td>Window</td>
              <td className="num">glass</td>
              <td className="calc-target">critical humidity</td>
            </tr>
            {windows.map((w) => (
              <tr key={w.id} className={w.frost ? 'calc-off' : ''}>
                <td>{w.id}{w.blind ? ' (fixed)' : ''}</td>
                <td className="num">{w.tGlass.toFixed(1)} °C</td>
                <td className="calc-target">
                  {w.frost ? '✕ frost' : '✓'} {w.criticalRh.toFixed(0)} %
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="panel-note">
          Frost means glass below zero; with U = {envelope.window.u} it stays
          around {windows[0]?.tGlass.toFixed(0)} °C even at the design frost, so
          there will be no icing. The real risk is <b>fogging</b>: it starts
          when the room humidity exceeds the value shown. Underfloor heating under the window
          has little effect on this: what matters is the quality of the double glazing and the humidity,
          not heating from below.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Ventilation</span>
          <span className="muted">ducts</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr className="head-row">
              <td>Room</td>
              <td className="num">flow</td>
              <td className="calc-target">duct</td>
            </tr>
            <tr>
              <td>Bathroom</td>
              <td className="num">{vent.bath.flow} m³/h</td>
              <td className="calc-target">
                Ø{(vent.bath.diameter * 1000).toFixed(0)} · {vent.bath.ach.toFixed(1)} ACH
              </td>
            </tr>
            <tr>
              <td>Kitchen, general extract</td>
              <td className="num">{vent.kitchen.flow} m³/h</td>
              <td className="calc-target">
                Ø{(vent.kitchen.diameter * 1000).toFixed(0)} · location is free
              </td>
            </tr>
            <tr>
              <td>Hood at maximum</td>
              <td className="num">{vent.hood.flow} m³/h</td>
              <td className="calc-target">Ø{(vent.hood.diameter * 1000).toFixed(0)}</td>
            </tr>
          </tbody>
        </table>
        <p className="panel-note">
          Ø{(vent.bath.diameter * 1000).toFixed(0)} in the bathroom gives{' '}
          {vent.bath.ach.toFixed(1)} air changes per hour at a velocity of{' '}
          {vent.bath.actualVelocity.toFixed(1)} m/s — quiet and with margin.
          Extraction only works with <b>make-up air</b>: you need a gap of about 20 mm under the
          bathroom door or a transfer grille, otherwise the fan
          will work against a sealed volume.
        </p>
        <p className="panel-note">
          <b>The general-extract duct of the kitchen and the hood over the hob are different things.</b>{' '}
          The duct removes air from the room volume, so its position on the plan
          is free: the corner behind the fridge works, only the height matters — under
          the ceiling. The hood catches the plume at its source, and moving it into a corner
          makes no sense. The kitchen and bathroom ducts must not be combined.
          The flows are guidelines, check them against SP 402.1325800 and SP 54.13330.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Coolant</span>
          <span className="muted">{coolant.label}</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr>
              <td>Heat capacity</td>
              <td className="num">{coolant.c}</td>
              <td className="calc-target">water 4.18</td>
            </tr>
            <tr className="calc-off">
              <td>Flow at the same ΔT</td>
              <td className="num">+{((coolant.flowFactor - 1) * 100).toFixed(0)} %</td>
              <td className="calc-target">bigger pump</td>
            </tr>
            <tr className="calc-off">
              <td>Pressure drop</td>
              <td className="num">×{coolant.pressureDropFactor}</td>
              <td className="calc-target">loop ≤ {maxLoopLength(coolant).toFixed(0)} m</td>
            </tr>
            <tr>
              <td>Protected down to</td>
              <td className="num">{coolant.freezePoint} °C</td>
              <td className="calc-target">per the label</td>
            </tr>
            <tr className="total">
              <td>House cooling to 0 °C</td>
              <td className="num">{cool.hours.toFixed(0)} h</td>
              <td className="calc-target">τ = {cool.tauHours.toFixed(0)} h</td>
            </tr>
          </tbody>
        </table>
        <p className="panel-note">
          Antifreeze is justified for outages <b>longer than {cool.hours.toFixed(0)} hours</b> at
          an outdoor {climate.tOutDesign} °C. But it only covers the heating circuit:
          the water supply, traps, toilet and the secondary DHW heat exchanger stay on water
          and will freeze sooner. The boiler draws {boiler.electric} W — a UPS with a battery
          removes the very cause of the shutdown.
        </p>
        {coolant.originalReasonResolved && (
          <p className="panel-note" style={{ color: '#b45309' }}>
            <b>The reason for filling antifreeze is gone:</b> {coolant.originalReason.toLowerCase()}.
            Mains water is now connected, the pressure holds, and the boiler starts on its own.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>UPS for the boiler</span>
          <span className="muted">{ups.avgW.toFixed(0)} W average</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr className="head-row">
              <td>Batteries</td>
              <td className="num">reserve</td>
              <td className="calc-target">hours</td>
            </tr>
            {ups.options.map((o) => (
              <tr key={o.id} className={o.hours >= 12 ? '' : 'calc-off'}>
                <td>{o.label}</td>
                <td className="num">{o.usableWh.toFixed(0)} Wh</td>
                <td className="calc-target">{o.hours.toFixed(0)} h</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="panel-note">
          Inverter power does not matter: any unit will carry {boiler.electric} W,
          {ups.inverterVaMin} VA is enough with a margin for the pump starting current. Run time comes
          only from battery capacity, so you need a UPS <b>with terminals for external
          batteries</b> — the built-in 7 Ah lasts 20 minutes.
          A <b>pure sine wave</b> and a correct neutral are mandatory: the boiler monitors
          the flame by ionisation, and on a stepped sine wave or with a floating neutral
          it goes into a fault. The house cools to zero in {cool.hours.toFixed(0)} h —
          there is no point in holding it longer than that.
        </p>
      </section>
    </>
  );
}
