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

describe('system volume', () => {
  it('a litre per metre of 16 × 2.0 pipe — about 0.113', () => {
    expect(pipeVolumeLPerM()).toBeCloseTo(0.113, 3);
  });

  it('the loops give the main part of the volume', () => {
    const v = systemVolume({ pipeM: 218 });
    expect(v.loopsL).toBeCloseTo(24.7, 1);
    expect(v.loopsL / v.totalL).toBeGreaterThan(0.8);
  });
});

describe('expansion vessel against glycol', () => {
  it('glycol expands more than water — this works against us', () => {
    expect(expansionRatio({ base: 'ethylene' })).toBeGreaterThan(expansionRatio({ base: 'water' }));
  });

  it('the built-in 8 l is enough with a large margin', () => {
    const { plan } = build();
    expect(plan.expansion.ok).toBe(true);
    expect(plan.expansion.margin).toBeGreaterThan(3);
  });

  // A check of the formula itself, not of the project: the vessel works only if
  // the precharge is below the relief valve pressure
  it('a zero pressure difference makes the required vessel infinite', () => {
    const e = expansionCheck({
      volumeL: 30, coolant: { base: 'water' }, vesselL: 8,
      prechargeBar: 2.7, reliefBar: 3.0
    });
    expect(e.requiredL).toBeGreaterThan(100);
    expect(e.ok).toBe(false);
  });

  it('the attic circuit on top does not break the vessel', () => {
    const { p, plan } = build();
    // roughly: two radiators and 20 m of feeds — about 20 l more
    const e = expansionCheck({
      volumeL: plan.volume.totalL + 20,
      coolant: p.coolant,
      vesselL: p.boiler.expansionVesselL
    });
    expect(e.ok).toBe(true);
  });
});

describe('boiler — manifold connection', () => {
  it('at 3/4" the velocity is quiet', () => {
    const { plan } = build();
    expect(plan.connection.thread).toBe('3/4"');
    expect(plan.connection.velocity).toBeLessThan(0.7);
    expect(plan.connection.quiet).toBe(true);
  });

  it('at 1/2" the same flow would be audible', () => {
    const { hyd } = build();
    expect(connectionVelocity(hyd.totalFlowLh, 15)).toBeGreaterThan(
      connectionVelocity(hyd.totalFlowLh, CONNECTION.innerMm)
    );
  });
});

describe('piping composition', () => {
  it('the pump, vessel and safety group are listed as built in, not bought', () => {
    const { plan } = build();
    const builtInIds = plan.builtIn.map((b) => b.id);
    expect(builtInIds).toContain('pump');
    expect(builtInIds).toContain('vessel');
    expect(builtInIds).toContain('relief');
    // and none of them is in the shopping list
    const buyNames = plan.required.map((r) => r.name.toLowerCase()).join(' ');
    expect(buyNames).not.toContain('pump');
    expect(buyNames).not.toContain('expansion');
  });

  it('there are twice as many euroconus fittings as loops', () => {
    const { plan, loops } = build();
    const ec = plan.required.find((r) => r.id === 'eurocone');
    expect(ec.qty).toBe(loops.totalLoops * 2);
  });

  it('with a toxic coolant make-up is broken-line only', () => {
    const { plan } = build();
    expect(plan.toxic).toBe(true);
    expect(plan.makeup.id).toBe('makeup-manual');
    expect(plan.makeup.why).toContain('PLUG');
  });

  it('on water automatic make-up is acceptable', () => {
    const { p, loops } = build();
    const parts = boilerRoomParts({
      loops: loops.totalLoops,
      coolant: { base: 'water', toxic: false },
      boiler: p.boiler
    });
    expect(parts.makeup.id).toBe('makeup-auto');
  });
});

describe('boiler-room rules', () => {
  const w = runRules(makeInitialProject(), CLEAR_HEIGHT);
  const byId = (id) => w.find((x) => x.id === id);

  it('catches that the screed is protected only by the boiler setting', () => {
    const r = byId('screed-single-protection');
    expect(r).toBeDefined();
    expect(r.fix).toContain('55');
  });

  it('requires an outdoor sensor for the Kt curve', () => {
    expect(byId('outdoor-sensor')).toBeDefined();
  });

  it('make-up from the mains with glycol is an error', () => {
    const r = byId('makeup-toxic');
    expect(r).toBeDefined();
    expect(r.severity).toBe('error');
  });

  it('the vessel is judged sufficient', () => {
    const r = byId('expansion-vessel');
    expect(r.severity).toBe('info');
  });
});

describe('boiler-room estimate', () => {
  const { p, loops, plan } = build();
  const est = floorEstimate({
    layout: p.layout, screed: p.screed, levels: p.levels, loops,
    coolant: p.coolant, stair: p.stair, boilerRoom: plan
  });
  const group = est.byGroup.find((g) => g.group === 'Boiler room');

  it('the group appeared and is not empty', () => {
    expect(group).toBeDefined();
    expect(group.rows.length).toBeGreaterThan(5);
  });

  it('there is no pump in the estimate — it is inside the boiler', () => {
    const names = est.items.map((i) => i.name.toLowerCase()).join(' ');
    expect(names).not.toContain('circulation pump');
  });

  it('there is exactly one emergency thermostat and it is in the boiler room', () => {
    const stats = est.items.filter((i) => i.price === 'safety_stat');
    expect(stats).toHaveLength(1);
    expect(stats[0].group).toBe('Boiler room');
  });

  it('replacement of the expired coolant is included', () => {
    const row = group.rows.find((r) => r.price === 'coolant_conc');
    expect(row).toBeDefined();
    expect(row.qty).toBeGreaterThan(10);
  });
});
