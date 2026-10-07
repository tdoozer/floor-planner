import { describe, expect, it } from 'vitest';

import {
  DUCT_VELOCITY,
  EXTRACT_FLOW,
  WATER_PER_M3_GAS,
  airChanges,
  cookingMoisture,
  ductDiameter,
  pickDuct,
  ventilationPlan
} from '../ventilation.js';
import { runRules } from '../rules.js';
import { CLEAR_HEIGHT, makeInitialProject } from '../../data/project.js';

describe('ductDiameter', () => {
  it('больше расход — толще канал', () => {
    expect(ductDiameter(90)).toBeGreaterThan(ductDiameter(50));
  });

  it('тише скорость — толще канал при том же расходе', () => {
    expect(ductDiameter(50, DUCT_VELOCITY.quiet)).toBeGreaterThan(
      ductDiameter(50, DUCT_VELOCITY.max)
    );
  });
});

describe('pickDuct', () => {
  it('санузлу 50 м³/ч достаточно стандартного Ø100', () => {
    const d = pickDuct(EXTRACT_FLOW.bathCombined);
    expect(d.diameter).toBe(0.1);
    // Расчётный диаметр меньше стандартного — значит запас есть
    expect(d.required).toBeLessThan(0.1);
    expect(d.actualVelocity).toBeLessThan(DUCT_VELOCITY.normal);
  });

  it('кухне с газом 90 м³/ч Ø100 ещё хватает', () => {
    expect(pickDuct(EXTRACT_FLOW.kitchenGas).diameter).toBe(0.1);
  });

  it('зонтичной вытяжке на максимуме нужен канал крупнее', () => {
    expect(pickDuct(EXTRACT_FLOW.hoodBoost, DUCT_VELOCITY.max).diameter).toBeGreaterThanOrEqual(0.15);
  });

  it('выбирается ближайший больший стандартный диаметр', () => {
    const d = pickDuct(200);
    expect(d.diameter).toBeGreaterThanOrEqual(d.required);
  });
});

describe('airChanges', () => {
  it('50 м³/ч в санузле 3,24 м² дают около шести обменов', () => {
    const ach = airChanges(EXTRACT_FLOW.bathCombined, 3.24, 2.7);
    expect(ach).toBeGreaterThan(5);
    expect(ach).toBeLessThan(7);
  });
});

describe('ventilationPlan', () => {
  const plan = ventilationPlan({ bathArea: 3.24, kitchenArea: 22.41, height: 2.7, gasHob: true });

  it('газовая плита требует большего расхода, чем электрическая', () => {
    const electric = ventilationPlan({ bathArea: 3.24, kitchenArea: 22.41, height: 2.7, gasHob: false });
    expect(plan.kitchen.flow).toBeGreaterThan(electric.kitchen.flow);
  });

  it('санузел проветривается многократно за час', () => {
    expect(plan.bath.ach).toBeGreaterThan(5);
  });

  it('кухня при своём объёме обменивается медленнее санузла', () => {
    expect(plan.kitchen.ach).toBeLessThan(plan.bath.ach);
  });
});

describe('Канал кухни в углу — правила', () => {
  const project = makeInitialProject();
  const warnings = runRules(project, CLEAR_HEIGHT);

  it('канал кухни заложен, отсутствие больше не выдаётся ошибкой', () => {
    expect(warnings.find((w) => w.id === 'kitchen-extract')).toBeUndefined();
  });

  it('удалённость канала от плиты признана нормальной', () => {
    const w = warnings.find((x) => x.id === 'kitchen-vent-vs-hood');
    expect(w).toBeDefined();
    expect(w.severity).toBe('info');
    expect(w.detail).toContain('место');
  });

  it('но зонт над плитой каналом не заменяется', () => {
    const w = warnings.find((x) => x.id === 'kitchen-vent-vs-hood');
    expect(w.detail).toContain('НЕ заменяет');
  });

  it('канал требует притока и защиты от промерзания', () => {
    const w = warnings.find((x) => x.id === 'kitchen-vent-makeup');
    expect(w).toBeDefined();
    expect(w.fix).toContain('НЕ объединять');
  });

  it('канал вынесен под потолок, а не на уровень пола', () => {
    const v = project.nodes.find((n) => n.id === 'vent-kitchen');
    expect(v.mountHeight).toBeGreaterThan(2);
  });
});

describe('cookingMoisture', () => {
  it('два часа готовки на газе дают заметную влагу', () => {
    const kg = cookingMoisture({ hours: 2 });
    expect(kg).toBeGreaterThan(0.5);
    expect(kg).toBeLessThan(2);
  });

  it('влага пропорциональна расходу газа', () => {
    expect(cookingMoisture({ gasM3PerHour: 0.7, hours: 1 }))
      .toBeCloseTo(0.7 * WATER_PER_M3_GAS, 6);
  });
});
