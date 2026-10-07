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
  if (unit === 'шт' || unit === 'компл.' || unit === 'баллон') return Math.ceil(v).toString();
  if (v >= 100) return v.toFixed(0);
  if (v >= 10) return v.toFixed(1);
  return v.toFixed(2);
};

// Суммы всегда в тысячах ₽ — единица подписывается в заголовке таблицы,
// а не приклеивается к каждому числу. Раньше выходило «50 тыс тыс ₽».
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
          <span>Итого материалы</span>
          <span className="muted">{est.items.length} позиций</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr className="head-row">
              <td>Оценка, тыс ₽</td>
              <td className="num">от</td>
              <td className="num">средняя</td>
              <td className="calc-target">до</td>
            </tr>
            <tr>
              <td><b>Всё вместе</b></td>
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
          Только <b>материалы</b> — работы не входят.
          Расчёт ведётся по средней цене. {est.meta.source}.{' '}
          <b>Это не котировки:</b> {est.meta.disclaimer}
        </p>
      </section>

      {est.byGroup.map((g) => (
        <section className="panel" key={g.group}>
          <div className="panel-head">
            <span>{g.group}</span>
            <span className="muted">{rub(g.avg)} тыс ₽</span>
            {/* rub() отдаёт тысячи, поэтому «тыс ₽» подписывается один раз */}
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
                      {i.cost.priced ? `${Math.round(i.cost.avg)} ₽` : 'нет цены'}
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
          <span>Нарезка трубы из бухт</span>
          <span className="muted">{cut.totalOrdered} м</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr className="head-row">
              <td>Бухта</td>
              <td className="num">режем на</td>
              <td className="calc-target">остаток</td>
            </tr>
            {cut.coils.map((c, i) => (
              <tr key={i}>
                <td>{c.size} м</td>
                <td className="num">{c.cuts.join(' + ')} м</td>
                <td className="calc-target">{c.left.toFixed(0)} м</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="panel-note">
          <b>Каждая петля — цельный кусок.</b> Соединений в стяжке быть не должно:
          их не осмотреть и не подтянуть. Раскрой подобран так, чтобы обрезков
          осталось {cut.waste.toFixed(0)} м.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head"><span>Что в смету НЕ входит</span></div>
        <p className="panel-note" style={{ marginTop: 0 }}>
          Отделка (штукатурка, керамогранит, плитка санузла, потолки),
          сантехразводка, вентканалы, ИБП и работы.
          По ним ещё нет решений либо нет объёмов, а придуманные количества
          за спецификацию выдавать нельзя.
        </p>
      </section>
    </>
  );
}
