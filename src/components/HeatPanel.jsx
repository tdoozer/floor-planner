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

const w = (v) => `${Math.round(v)} Вт`;

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
        <div className="panel-head"><span>Объект и климат</span></div>
        <p className="panel-note" style={{ marginTop: 0 }}>{climate.place}</p>
        <div className="field-grid">
          <label>
            Расчётная наружная, °C
            <input
              type="number" value={climate.tOutDesign}
              onChange={(e) => onUpdateClimate({ tOutDesign: Number(e.target.value) })}
            />
          </label>
          <label>
            В жилой зоне, °C
            <input
              type="number" value={climate.tInLiving}
              onChange={(e) => onUpdateClimate({ tInLiving: Number(e.target.value) })}
            />
          </label>
        </div>
        {!climate.confirmed && (
          <p className="panel-note">
            Климатические параметры по метеостанции «{climate.station}» приведены как
            ориентир и должны быть сверены с актуальным СП 131.13330.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head"><span>Ограждающие конструкции</span></div>
        <div className="field-grid">
          <label>
            Газобетон, мм
            <input
              type="number" step="25" value={envelope.wall.thickness}
              onChange={(e) => onUpdateEnvelope({ wall: { ...envelope.wall, thickness: Number(e.target.value) } })}
            />
          </label>
          <label>
            λ блока, Вт/(м·К)
            <input
              type="number" step="0.01" value={envelope.wall.lambda}
              onChange={(e) => onUpdateEnvelope({ wall: { ...envelope.wall, lambda: Number(e.target.value) } })}
            />
          </label>
          <label>
            ЭППС снаружи, мм
            <input
              type="number" step="10" value={envelope.wallInsulation.thickness}
              onChange={(e) => onUpdateEnvelope({
                wallInsulation: { ...envelope.wallInsulation, thickness: Number(e.target.value) }
              })}
            />
          </label>
          <label>
            U окон, Вт/(м²·К)
            <input
              type="number" step="0.1" value={envelope.window.u}
              onChange={(e) => onUpdateEnvelope({ window: { ...envelope.window, u: Number(e.target.value) } })}
            />
          </label>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr>
              <td>R стены</td>
              <td className="num">{hl.rWall.toFixed(2)}</td>
              <td className="calc-target">{hl.rWall >= rReq ? '✓' : '✕'} норма {rReq.toFixed(2)}</td>
            </tr>
            <tr>
              <td>U стены</td>
              <td className="num">{hl.uWall.toFixed(3)}</td>
              <td className="calc-target">Вт/(м²·К)</td>
            </tr>
            <tr>
              <td>ГСОП</td>
              <td className="num">{gsop(climate).toFixed(0)}</td>
              <td className="calc-target">°C·сут</td>
            </tr>
          </tbody>
        </table>
        <p className="panel-note">
          Нормируемое R = 0,00035·ГСОП + 1,4 по СП 50.13330 — коэффициенты приведены
          по памяти и требуют сверки. Стена уже{' '}
          {hl.rWall >= rReq ? 'перекрывает норму' : 'не дотягивает до нормы'}
          {hl.rWall >= rReq ? `, запас ${((hl.rWall / rReq - 1) * 100).toFixed(0)} %` : ''}.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Теплопотери первого этажа</span>
          <span className="muted">{hl.totalKw.toFixed(2)} кВт</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr className="head-row">
              <td>Помещение</td>
              <td className="num">Вт</td>
              <td className="calc-target">Вт/м²</td>
            </tr>
            {hl.byRoom.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td className="num">{w(r.total)}</td>
                <td className="calc-target">{r.perM2.toFixed(0)}</td>
              </tr>
            ))}
            <tr className="total">
              <td>Итого</td>
              <td className="num">{w(hl.total)}</td>
              <td className="calc-target">{hl.perM2.toFixed(0)}</td>
            </tr>
          </tbody>
        </table>
        <p className="panel-note">
          Мансарда в расчёт не входит: кровля пока не утеплена, утепление
          планируется отдельно. После него нагрузка дома станет ещё меньше —
          систему надо считать на будущее состояние, а не на сегодняшнее.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Котёл {boiler.model}</span>
        </div>
        <table className="mini-table">
          <tbody>
            <tr><td>Номинальная мощность</td><td className="num">{boiler.powerNominal} кВт</td></tr>
            <tr className="calc-off">
              <td>Минимальная мощность</td>
              <td className="num">{boiler.powerMin} кВт</td>
            </tr>
            <tr><td>ГВС</td><td className="num">{boiler.dhwFlow} л/мин</td></tr>
            <tr className="total">
              <td>Превышение над нагрузкой</td>
              <td className="num">×{bc.ratio.toFixed(1)}</td>
            </tr>
          </tbody>
        </table>

        <div className="panel-head" style={{ marginTop: 10 }}>
          <span>Цикл горелки по схемам</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr className="head-row">
              <td>Схема</td>
              <td className="num">объём</td>
              <td className="calc-target">цикл</td>
            </tr>
            {bc.schemes.map((s) => (
              <tr key={s.id} className={s.ok ? '' : 'calc-off'}>
                <td title={s.note}>{s.name}</td>
                <td className="num">{s.volumeL.toFixed(0)} л</td>
                <td className="calc-target">
                  {s.ok ? '✓' : '✕'} {s.cycleMinutes.toFixed(0)} мин
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="panel-note">
          Котёл подобран по горячей воде: чтобы дать {boiler.dhwFlow} л/мин, нужны
          {' '}{boiler.powerNominal} кВт. Отоплению столько не требуется никогда.
          Стяжка {bc.screedMass.massKg.toFixed(0)} кг по теплоёмкости равна
          {' '}{bc.screedMass.waterEquivalentL.toFixed(0)} л воды — если подключить
          тёплый пол к котлу напрямую и низкотемпературно, эта масса работает
          буфером бесплатно и место в прихожей не тратится.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Окна: запотевание и иней</span>
          <span className="muted">при {climate.tOutDesign} °C</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr className="head-row">
              <td>Окно</td>
              <td className="num">стекло</td>
              <td className="calc-target">критич. влажность</td>
            </tr>
            {windows.map((w) => (
              <tr key={w.id} className={w.frost ? 'calc-off' : ''}>
                <td>{w.id}{w.blind ? ' (глухое)' : ''}</td>
                <td className="num">{w.tGlass.toFixed(1)} °C</td>
                <td className="calc-target">
                  {w.frost ? '✕ иней' : '✓'} {w.criticalRh.toFixed(0)} %
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="panel-note">
          Иней — это стекло ниже нуля; при вашем U = {envelope.window.u} оно держится
          около {windows[0]?.tGlass.toFixed(0)} °C даже в расчётный мороз, так что
          обмерзания не будет. Реальный риск — <b>запотевание</b>: оно начинается,
          когда влажность в комнате превышает указанную. Тёплый пол под окном
          на это влияет слабо: решает качество стеклопакета и влажность,
          а не подогрев снизу.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Вентиляция</span>
          <span className="muted">каналы</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr className="head-row">
              <td>Помещение</td>
              <td className="num">расход</td>
              <td className="calc-target">канал</td>
            </tr>
            <tr>
              <td>Санузел</td>
              <td className="num">{vent.bath.flow} м³/ч</td>
              <td className="calc-target">
                Ø{(vent.bath.diameter * 1000).toFixed(0)} · {vent.bath.ach.toFixed(1)} крат
              </td>
            </tr>
            <tr>
              <td>Кухня, общеобменная</td>
              <td className="num">{vent.kitchen.flow} м³/ч</td>
              <td className="calc-target">
                Ø{(vent.kitchen.diameter * 1000).toFixed(0)} · место свободно
              </td>
            </tr>
            <tr>
              <td>Вытяжка на максимуме</td>
              <td className="num">{vent.hood.flow} м³/ч</td>
              <td className="calc-target">Ø{(vent.hood.diameter * 1000).toFixed(0)}</td>
            </tr>
          </tbody>
        </table>
        <p className="panel-note">
          Ø{(vent.bath.diameter * 1000).toFixed(0)} в санузле даёт{' '}
          {vent.bath.ach.toFixed(1)} обмена в час при скорости{' '}
          {vent.bath.actualVelocity.toFixed(1)} м/с — тихо и с запасом.
          Вытяжка работает только при <b>притоке</b>: нужен зазор под дверью
          санузла около 20 мм или переточная решётка, иначе вентилятор
          упрётся в закрытый объём.
        </p>
        <p className="panel-note">
          <b>Общеобменный канал кухни и зонт над плитой — разные вещи.</b>{' '}
          Канал убирает воздух из объёма помещения, поэтому его место в плане
          свободно: угол за холодильником подходит, важна только высота — под
          потолком. Зонт ловит плюм у источника, и его в угол переносить
          бессмысленно. Каналы кухни и санузла объединять нельзя.
          Расходы — ориентиры, сверьте с СП 402.1325800 и СП 54.13330.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Теплоноситель</span>
          <span className="muted">{coolant.label}</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr>
              <td>Теплоёмкость</td>
              <td className="num">{coolant.c}</td>
              <td className="calc-target">вода 4,18</td>
            </tr>
            <tr className="calc-off">
              <td>Расход при том же ΔT</td>
              <td className="num">+{((coolant.flowFactor - 1) * 100).toFixed(0)} %</td>
              <td className="calc-target">насос мощнее</td>
            </tr>
            <tr className="calc-off">
              <td>Потери давления</td>
              <td className="num">×{coolant.pressureDropFactor}</td>
              <td className="calc-target">петля ≤ {maxLoopLength(coolant).toFixed(0)} м</td>
            </tr>
            <tr>
              <td>Защита до</td>
              <td className="num">{coolant.freezePoint} °C</td>
              <td className="calc-target">по этикетке</td>
            </tr>
            <tr className="total">
              <td>Остывание дома до 0 °C</td>
              <td className="num">{cool.hours.toFixed(0)} ч</td>
              <td className="calc-target">τ = {cool.tauHours.toFixed(0)} ч</td>
            </tr>
          </tbody>
        </table>
        <p className="panel-note">
          Антифриз оправдан для отключений <b>длиннее {cool.hours.toFixed(0)} часов</b> при
          наружных {climate.tOutDesign} °C. Но он закрывает только контур отопления:
          водопровод, сифоны, унитаз и вторичный теплообменник ГВС остаются с водой
          и замёрзнут раньше. Котёл потребляет {boiler.electric} Вт — ИБП с аккумулятором
          устраняет саму причину остановки.
        </p>
        {coolant.originalReasonResolved && (
          <p className="panel-note" style={{ color: '#b45309' }}>
            <b>Причина заливки антифриза устранена:</b> {coolant.originalReason.toLowerCase()}.
            Сейчас подведена центральная вода, давление держится, котёл стартует сам.
          </p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>ИБП для котла</span>
          <span className="muted">{ups.avgW.toFixed(0)} Вт средних</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr className="head-row">
              <td>Аккумуляторы</td>
              <td className="num">запас</td>
              <td className="calc-target">часов</td>
            </tr>
            {ups.options.map((o) => (
              <tr key={o.id} className={o.hours >= 12 ? '' : 'calc-off'}>
                <td>{o.label}</td>
                <td className="num">{o.usableWh.toFixed(0)} Вт·ч</td>
                <td className="calc-target">{o.hours.toFixed(0)} ч</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="panel-note">
          Мощность инвертора роли не играет: {boiler.electric} Вт потянет любой,
          хватит {ups.inverterVaMin} В·А с запасом на пусковой ток насоса. Часы даёт
          только ёмкость батарей, поэтому нужен ИБП <b>с клеммами под внешние
          аккумуляторы</b> — встроенных 7 А·ч хватает на 20 минут.
          Обязательны <b>чистая синусоида</b> и корректный ноль: котёл контролирует
          пламя по ионизации, и на ступенчатой синусоиде или при плавающем нуле
          он уходит в ошибку. Дом остывает до нуля за {cool.hours.toFixed(0)} ч —
          дольше этого держать нет смысла.
        </p>
      </section>
    </>
  );
}
