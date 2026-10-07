import { describe, expect, it } from 'vitest';

import {
  CONNECTION,
  boilerRoomParts,
  boilerRoomPlan,
  connectionVelocity,
  expansionCheck,
  expansionRatio,
  pipeVolumeLPerM,
  systemVolume
} from '../boilerRoom.js';
import { CLEAR_HEIGHT, makeInitialProject } from '../../data/project.js';
import { runRules } from '../rules.js';
import { heatLoss } from '../heatloss.js';
import { layoutLoops } from '../loops.js';
import { systemHydraulics } from '../hydraulics.js';
import { floorEstimate } from '../estimate.js';

function build() {
  const p = makeInitialProject();
  const hl = heatLoss({
    layout: p.layout, openings: p.openings, climate: p.climate,
    envelope: p.envelope, screed: p.screed, clearHeight: CLEAR_HEIGHT
  });
  const loops = layoutLoops({
    layout: p.layout,
    heatLossByRoom: hl.byRoom,
    manifold: p.nodes.find((n) => n.type === 'manifold'),
    coolant: p.coolant,
    spacings: p.loopSpacings,
    equipment: p.equipment,
    exclusionZones: p.floorExclusionZones,
    mode: p.loopMode,
    kitchenOnFrame: p.kitchenOnFrame
  });
  const hyd = systemHydraulics({
    loops: loops.byRoom.flatMap((r) =>
      Array.from({ length: r.loops }, () => ({
        powerW: r.roomLoadW / r.loops, lengthM: r.perLoop
      }))
    ),
    coolant: p.coolant
  });
  const plan = boilerRoomPlan({
    boiler: p.boiler, coolant: p.coolant, loops, flowLh: hyd.totalFlowLh, screedArea: hl.area
  });
  return { p, hl, loops, hyd, plan };
}

describe('объём системы', () => {
  it('литр на метр трубы 16 × 2,0 — около 0,113', () => {
    expect(pipeVolumeLPerM()).toBeCloseTo(0.113, 3);
  });

  it('петли дают основную часть объёма', () => {
    const v = systemVolume({ pipeM: 218 });
    expect(v.loopsL).toBeCloseTo(24.7, 1);
    expect(v.loopsL / v.totalL).toBeGreaterThan(0.8);
  });
});

describe('расширительный бак против гликоля', () => {
  it('гликоль расширяется сильнее воды — это против нас', () => {
    expect(expansionRatio({ base: 'ethylene' })).toBeGreaterThan(expansionRatio({ base: 'water' }));
  });

  it('встроенных 8 л хватает с большим запасом', () => {
    const { plan } = build();
    expect(plan.expansion.ok).toBe(true);
    expect(plan.expansion.margin).toBeGreaterThan(3);
  });

  // Проверка самой формулы, а не проекта: бак работает только если
  // предварительное давление ниже давления срабатывания клапана
  it('нулевой перепад давлений делает требуемый бак бесконечным', () => {
    const e = expansionCheck({
      volumeL: 30, coolant: { base: 'water' }, vesselL: 8,
      prechargeBar: 2.7, reliefBar: 3.0
    });
    expect(e.requiredL).toBeGreaterThan(100);
    expect(e.ok).toBe(false);
  });

  it('мансардный контур сверху объём бака не ломает', () => {
    const { p, plan } = build();
    // грубо: два радиатора и 20 м подводок — ещё около 20 л
    const e = expansionCheck({
      volumeL: plan.volume.totalL + 20,
      coolant: p.coolant,
      vesselL: p.boiler.expansionVesselL
    });
    expect(e.ok).toBe(true);
  });
});

describe('подводка котёл — коллектор', () => {
  it('на 3/4" скорость тихая', () => {
    const { plan } = build();
    expect(plan.connection.thread).toBe('3/4"');
    expect(plan.connection.velocity).toBeLessThan(0.7);
    expect(plan.connection.quiet).toBe(true);
  });

  it('на 1/2" тот же расход стал бы слышен', () => {
    const { hyd } = build();
    expect(connectionVelocity(hyd.totalFlowLh, 15)).toBeGreaterThan(
      connectionVelocity(hyd.totalFlowLh, CONNECTION.innerMm)
    );
  });
});

describe('состав обвязки', () => {
  it('насос, бак и группа безопасности числятся встроенными, а не покупными', () => {
    const { plan } = build();
    const builtInIds = plan.builtIn.map((b) => b.id);
    expect(builtInIds).toContain('pump');
    expect(builtInIds).toContain('vessel');
    expect(builtInIds).toContain('relief');
    // и ни одного из них нет в списке на покупку
    const buyNames = plan.required.map((r) => r.name.toLowerCase()).join(' ');
    expect(buyNames).not.toContain('насос');
    expect(buyNames).not.toContain('расширительный');
  });

  it('евроконусов вдвое больше числа контуров', () => {
    const { plan, loops } = build();
    const ec = plan.required.find((r) => r.id === 'eurocone');
    expect(ec.qty).toBe(loops.totalLoops * 2);
  });

  it('при ядовитом теплоносителе подпитка только разрывная', () => {
    const { plan } = build();
    expect(plan.toxic).toBe(true);
    expect(plan.makeup.id).toBe('makeup-manual');
    expect(plan.makeup.why).toContain('ЗАГЛУШИТЬ');
  });

  it('на воде автоподпитка допустима', () => {
    const { p, loops } = build();
    const parts = boilerRoomParts({
      loops: loops.totalLoops,
      coolant: { base: 'water', toxic: false },
      boiler: p.boiler
    });
    expect(parts.makeup.id).toBe('makeup-auto');
  });
});

describe('правила котельной', () => {
  const w = runRules(makeInitialProject(), CLEAR_HEIGHT);
  const byId = (id) => w.find((x) => x.id === id);

  it('ловит, что стяжку защищает только настройка котла', () => {
    const r = byId('screed-single-protection');
    expect(r).toBeDefined();
    expect(r.fix).toContain('55');
  });

  it('требует наружный датчик под кривую Kt', () => {
    expect(byId('outdoor-sensor')).toBeDefined();
  });

  it('подпитка от водопровода при гликоле — ошибка', () => {
    const r = byId('makeup-toxic');
    expect(r).toBeDefined();
    expect(r.severity).toBe('error');
  });

  it('бак признан достаточным', () => {
    const r = byId('expansion-vessel');
    expect(r.severity).toBe('info');
  });
});

describe('смета котельной', () => {
  const { p, loops, plan } = build();
  const est = floorEstimate({
    layout: p.layout, screed: p.screed, levels: p.levels, loops,
    coolant: p.coolant, stair: p.stair, boilerRoom: plan
  });
  const group = est.byGroup.find((g) => g.group === 'Котельная');

  it('группа появилась и не пустая', () => {
    expect(group).toBeDefined();
    expect(group.rows.length).toBeGreaterThan(5);
  });

  it('насоса в смете нет — он внутри котла', () => {
    const names = est.items.map((i) => i.name.toLowerCase()).join(' ');
    expect(names).not.toContain('циркуляционный насос');
  });

  it('аварийный термостат ровно один и он в котельной', () => {
    const stats = est.items.filter((i) => i.price === 'safety_stat');
    expect(stats).toHaveLength(1);
    expect(stats[0].group).toBe('Котельная');
  });

  it('заложена замена просроченного теплоносителя', () => {
    const row = group.rows.find((r) => r.price === 'coolant_conc');
    expect(row).toBeDefined();
    expect(row.qty).toBeGreaterThan(10);
  });
});
