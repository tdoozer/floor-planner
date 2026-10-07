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
  it('more flow — a thicker duct', () => {
    expect(ductDiameter(90)).toBeGreaterThan(ductDiameter(50));
  });

  it('lower velocity — a thicker duct at the same flow', () => {
    expect(ductDiameter(50, DUCT_VELOCITY.quiet)).toBeGreaterThan(
      ductDiameter(50, DUCT_VELOCITY.max)
    );
  });
});

describe('pickDuct', () => {
  it('50 m³/h is enough for the bathroom with a standard Ø100', () => {
    const d = pickDuct(EXTRACT_FLOW.bathCombined);
    expect(d.diameter).toBe(0.1);
    // The calculated diameter is smaller than the standard — so there is a margin
    expect(d.required).toBeLessThan(0.1);
    expect(d.actualVelocity).toBeLessThan(DUCT_VELOCITY.normal);
  });

  it('for a kitchen with gas 90 m³/h Ø100 is still enough', () => {
    expect(pickDuct(EXTRACT_FLOW.kitchenGas).diameter).toBe(0.1);
  });

  it('a hood at maximum needs a larger duct', () => {
    expect(pickDuct(EXTRACT_FLOW.hoodBoost, DUCT_VELOCITY.max).diameter).toBeGreaterThanOrEqual(0.15);
  });

  it('the nearest larger standard diameter is chosen', () => {
    const d = pickDuct(200);
    expect(d.diameter).toBeGreaterThanOrEqual(d.required);
  });
});

describe('airChanges', () => {
  it('50 m³/h in a 3.24 m² bathroom gives about six air changes', () => {
    const ach = airChanges(EXTRACT_FLOW.bathCombined, 3.24, 2.7);
    expect(ach).toBeGreaterThan(5);
    expect(ach).toBeLessThan(7);
  });
});

describe('ventilationPlan', () => {
  const plan = ventilationPlan({ bathArea: 3.24, kitchenArea: 22.41, height: 2.7, gasHob: true });

  it('a gas hob requires a larger flow than an electric one', () => {
    const electric = ventilationPlan({ bathArea: 3.24, kitchenArea: 22.41, height: 2.7, gasHob: false });
    expect(plan.kitchen.flow).toBeGreaterThan(electric.kitchen.flow);
  });

  it('the bathroom is aired many times an hour', () => {
    expect(plan.bath.ach).toBeGreaterThan(5);
  });

  it('the kitchen, with its volume, changes air more slowly than the bathroom', () => {
    expect(plan.kitchen.ach).toBeLessThan(plan.bath.ach);
  });
});

describe('Kitchen duct in the corner — rules', () => {
  const project = makeInitialProject();
  const warnings = runRules(project, CLEAR_HEIGHT);

  it('the kitchen duct is provided, its absence is no longer reported as an error', () => {
    expect(warnings.find((w) => w.id === 'kitchen-extract')).toBeUndefined();
  });

  it('the distance of the duct from the hob is judged normal', () => {
    const w = warnings.find((x) => x.id === 'kitchen-vent-vs-hood');
    expect(w).toBeDefined();
    expect(w.severity).toBe('info');
    expect(w.detail).toContain('position');
  });

  it('but the hood over the hob is not replaced by the duct', () => {
    const w = warnings.find((x) => x.id === 'kitchen-vent-vs-hood');
    expect(w.detail).toContain('does NOT replace');
  });

  it('the duct needs make-up air and frost protection', () => {
    const w = warnings.find((x) => x.id === 'kitchen-vent-makeup');
    expect(w).toBeDefined();
    expect(w.fix).toContain('Do NOT combine');
  });

  it('the duct is placed under the ceiling, not at floor level', () => {
    const v = project.nodes.find((n) => n.id === 'vent-kitchen');
    expect(v.mountHeight).toBeGreaterThan(2);
  });
});

describe('cookingMoisture', () => {
  it('two hours of cooking on gas give noticeable moisture', () => {
    const kg = cookingMoisture({ hours: 2 });
    expect(kg).toBeGreaterThan(0.5);
    expect(kg).toBeLessThan(2);
  });

  it('moisture is proportional to the gas flow', () => {
    expect(cookingMoisture({ gasM3PerHour: 0.7, hours: 1 }))
      .toBeCloseTo(0.7 * WATER_PER_M3_GAS, 6);
  });
});
