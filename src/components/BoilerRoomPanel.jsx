import React from 'react';

import BoilerScheme from './BoilerScheme.jsx';
import { CLEAR_HEIGHT } from '../data/project.js';
import { boilerRoomPlan } from '../calc/boilerRoom.js';
import { heatLoss } from '../calc/heatloss.js';
import { layoutLoops } from '../calc/loops.js';
import { systemHydraulics } from '../calc/hydraulics.js';
import { coolantAge } from '../data/coolant.js';

// Панель котельной: принципиальная схема плюс два списка —
// что уже внутри котла и что надо купить. Разделение важнее самой схемы:
// типовые решения из интернета дублируют встроенное.
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
          <span>Схема обвязки</span>
          <span className="pill">прямая, низкотемпературная</span>
        </div>

        <BoilerScheme plan={plan} boiler={boiler} loops={loops} />

        <p className="panel-note">
          Смесительного узла и гидроразделителя в схеме нет намеренно. Котёл сам
          держит {boiler.lowTempParam.cap} °C параметром{' '}
          <b>{boiler.lowTempParam.code} = {boiler.lowTempParam.value}</b>, своего насоса
          хватает с кратностью ×{hyd.marginRatio.toFixed(1)}, а разделитель отрезал бы
          котёл от массы стяжки — единственного, что растягивает цикл горелки.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Объём системы и расширение</span>
          <span className={`pill ${plan.expansion.ok ? '' : 'error'}`}>
            {plan.expansion.ok ? `запас ×${plan.expansion.margin.toFixed(1)}` : 'бака мало'}
          </span>
        </div>
        <table className="mini-table">
          <tbody>
            <tr><td>Петли, {loops.totalPipe.toFixed(0)} м трубы</td><td className="num">{plan.volume.loopsL.toFixed(1)} л</td></tr>
            <tr><td>Котёл</td><td className="num">{plan.volume.boilerL.toFixed(1)} л</td></tr>
            <tr><td>Коллектор</td><td className="num">{plan.volume.manifoldL.toFixed(1)} л</td></tr>
            <tr><td>Подводки</td><td className="num">{plan.volume.connectionsL.toFixed(1)} л</td></tr>
            <tr className="accent"><td>Итого первый этаж</td><td className="num">{plan.volume.totalL.toFixed(0)} л</td></tr>
            <tr><td>Расширение при нагреве</td><td className="num">{plan.expansion.deltaV.toFixed(2)} л</td></tr>
            <tr><td>Требуемый бак</td><td className="num">{plan.expansion.requiredL.toFixed(1)} л</td></tr>
            <tr className="accent"><td>Встроенный бак</td><td className="num">{plan.expansion.vesselL} л</td></tr>
          </tbody>
        </table>
        <p className="panel-note">
          Мансардный контур в объём <b>не входит</b> — он вне объёма работ.
          Предварительное давление бака выставить {plan.expansion.prechargeBar} бар
          <b> до заполнения</b>, иначе паспортная ёмкость не работает.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Встроено в котёл</span>
          <span className="pill">покупать не надо</span>
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
        <div className="panel-head"><span>Купить</span></div>
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
          <span>Подпитка</span>
          {plan.toxic && <span className="pill error">теплоноситель ядовит</span>}
        </div>
        <p><b>{plan.makeup.name}</b> — {plan.makeup.mode}</p>
        <p className="panel-note">{plan.makeup.why}</p>
        {age?.expired && (
          <p className="panel-note">
            Залитый состав изготовлен {coolant.manufactured}, срок службы{' '}
            {coolant.shelfLifeYears} лет — <b>просрочен на {age.overdueYears.toFixed(0)} лет</b>.
            Ингибиторы выработались. Менять при заливке тёплого пола:
            второго такого случая не будет.
          </p>
        )}
      </section>
    </>
  );
}
