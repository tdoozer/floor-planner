import { describe, expect, it } from 'vitest';
import { LV, LV_LINKS, lowVoltagePlan, lvRoute } from '../lowVoltage.js';
import { IN_FLOOR } from '../electrical.js';
import { makeInitialProject, CLEAR_HEIGHT } from '../../data/project.js';
import { boundingBox } from '../../data/fixtures.js';
import { runRules } from '../rules.js';

describe('lvRoute — трасса по перекрытию', () => {
  it('считается ортогонально: подъём, вдоль, поперёк, спуск', () => {
    const r = lvRoute({
      from: { x: 0, y: 0 },
      to: { x: 3, y: 4 },
      height: 2.7,
      dropTo: 0.3
    });
    expect(r.rise).toBeCloseTo(2.7 - LV.routerHeight, 6);
    expect(r.alongX).toBeCloseTo(3, 6);
    expect(r.alongY).toBeCloseTo(4, 6);
    expect(r.drop).toBeCloseTo(2.4, 6);
    // Диагоналей по балкам не бывает — сумма отрезков, а не гипотенуза
    expect(r.runM).toBeCloseTo(r.rise + 7 + r.drop, 6);
    expect(r.runM).toBeGreaterThan(Math.hypot(3, 4));
  });

  it('кабеля нужно больше трассы: подрезка и разделка с двух концов', () => {
    const r = lvRoute({ from: { x: 0, y: 0 }, to: { x: 1, y: 1 } });
    expect(r.cableM).toBeCloseTo(r.runM * LV.waste + LV.termination, 6);
    expect(r.cableM).toBeGreaterThan(r.runM);
  });
});

describe('lowVoltagePlan — состав', () => {
  const plan = lowVoltagePlan();

  it('четыре рабочие линии плюс резерв', () => {
    expect(plan.utpLinks).toBe(4);
    expect(plan.reserveLinks).toBe(1);
    expect(plan.routes).toHaveLength(LV_LINKS.length);
  });

  it('приставка тянется к телевизору, а не стоит у роутера', () => {
    const box = plan.routes.find((r) => r.id === 'tv-box');
    // Приставка соединяется с роутером витой парой, поэтому висеть
    // она должна там же, где телевизор — иначе HDMI не дотянется
    expect(box.to.x).toBeGreaterThan(4);
    expect(box.cableM).toBeGreaterThan(10);
  });

  it('гофра считается по уникальным трассам, а не по кабелям', () => {
    // Две пары к телевизору идут в ОДНОЙ гофре и второй раз не считаются
    const tv = plan.routes.filter((r) => r.to.x === 4.4 && r.to.y === 2.36);
    expect(tv).toHaveLength(2);
    expect(plan.conduitM).toBeLessThan(plan.utpM);
  });

  it('резервная гофра кабеля не расходует', () => {
    const reserve = plan.routes.find((r) => r.kind === 'reserve');
    expect(reserve.kind).toBe('reserve');
    const utpSum = plan.routes
      .filter((r) => r.kind === 'utp')
      .reduce((s, r) => s + r.cableM, 0);
    expect(plan.utpM).toBeCloseTo(utpSum, 9);
  });

  it('точка доступа мансарды заложена, пока перекрытие вскрыто', () => {
    // Между роутером в углу первого этажа и спальнями — перекрытие
    // и будущий утеплитель. Кабель туда тянется ТОЛЬКО СЕЙЧАС.
    const ap = plan.routes.find((r) => r.id === 'mansard-ap');
    expect(ap).toBeTruthy();
    expect(ap.dropTo).toBeGreaterThan(2);
  });

  it('трасса привязана к точке ввода оптики, а не к щиту', () => {
    // Оптика заходит вместе с газом, под потолком прихожей
    expect(plan.router).toBe(LV.entry);
    expect(plan.router.height).toBeGreaterThan(CLEAR_HEIGHT - 0.5);
  });
});

describe('слаботочка и стяжка', () => {
  it('в стяжку не идёт вовсе', () => {
    // Стандарты слаботочки меняются быстрее, чем живёт бетон
    expect(IN_FLOOR.has('data')).toBe(false);
  });

  it('роутер стоит дальше норматива от ввода газа', () => {
    const p = makeInitialProject();
    const router = p.equipment.find((e) => e.catalogId === 'ont_router');
    const gas = p.nodes.find((n) => n.id === 'gas-boiler');
    const rb = boundingBox(router);
    const gapMm = Math.hypot(rb.cx - gas.x, rb.cy - gas.y) * 1000;
    expect(gapMm).toBeGreaterThanOrEqual(LV.gasClearanceMm);
  });

  it('правило по газу не ругается на текущей расстановке', () => {
    const p = makeInitialProject();
    const hit = runRules(p, CLEAR_HEIGHT).find((r) => r.id === 'router-vs-gas');
    expect(hit).toBeTruthy();
    expect(hit.severity).toBe('info');
  });

  it('роутер сидит на линии котла — на том же ИБП', () => {
    const p = makeInitialProject();
    const router = p.equipment.find((e) => e.catalogId === 'ont_router');
    expect(router.circuit).toBe('boiler');
  });
});
