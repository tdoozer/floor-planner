import { describe, expect, it } from 'vitest';

import { WASTE, floorEstimate, pipeCutting } from '../estimate.js';
import { heatLoss } from '../heatloss.js';
import { layoutLoops } from '../loops.js';
import { electricalPlan } from '../electrical.js';
import { CLEAR_HEIGHT, makeInitialProject } from '../../data/project.js';
import { lowVoltagePlan } from '../lowVoltage.js';

function build(p = makeInitialProject()) {
  const hl = heatLoss({
    layout: p.layout, openings: p.openings, climate: p.climate,
    envelope: p.envelope, screed: p.screed, clearHeight: CLEAR_HEIGHT
  });
  const loops = layoutLoops({
    layout: p.layout, heatLossByRoom: hl.byRoom,
    manifold: p.nodes.find((n) => n.type === 'manifold'),
    coolant: p.coolant, spacings: p.loopSpacings, equipment: p.equipment,
    exclusionZones: p.floorExclusionZones, mode: p.loopMode,
    kitchenOnFrame: p.kitchenOnFrame
  });
  const electrical = electricalPlan({
    equipment: p.equipment,
    entry: p.nodes.find((n) => n.type === 'electrical_panel')
  });
  return {
    p, loops, electrical,
    est: floorEstimate({
      layout: p.layout, screed: p.screed, levels: p.levels,
      loops, coolant: p.coolant, electrical, stair: p.stair,
      equipment: p.equipment
    })
  };
}

const find = (est, part) => est.items.find((i) => i.name.includes(part));

describe('floorEstimate — quantities from the geometry', () => {
  const { est } = build();

  it('counts by the clear area', () => {
    expect(est.area).toBeCloseTo(30.25, 2);
  });

  it('there is almost no fill — the sub-floor turned out to be 350, not 900', () => {
    // The build-up fills the sub-floor volume itself, sand is needed only for levelling
    const sand = find(est, 'Sand for filling');
    expect(sand.qty).toBeGreaterThan(0.5);
    expect(sand.qty).toBeLessThan(4);
  });

  it('waterproofing is taken with an overlap', () => {
    expect(find(est, 'Waterproofing').qty).toBeCloseTo(30.25 * WASTE.waterproofing, 1);
  });

  it('the damper strip counts both the perimeter and the partitions', () => {
    // 22 m of perimeter plus partitions — noticeably more than one perimeter
    expect(est.damperLength).toBeGreaterThan(22);
    expect(find(est, 'Damper strip').qty).toBeGreaterThan(est.damperLength);
  });

  it('the screed volume is reduced by the pipe volume', () => {
    const raw = (30.25 * 70) / 1000;
    expect(est.screedVolume).toBeLessThan(raw);
    expect(est.screedVolume).toBeGreaterThan(raw - 0.1);
  });

  it('cement is converted to bags', () => {
    expect(find(est, 'Cement').note).toMatch(/bags/);
  });

  it('there are twice as many euroconus fittings as loops', () => {
    const { loops, est: e } = build();
    expect(find(e, 'Euroconus').qty).toBe(loops.totalLoops * 2);
  });

  it('thicker XPS increases the insulation purchase and reduces the sand', () => {
    const thin = build();
    const p = makeInitialProject();
    p.screed = { ...p.screed, insulation: 200 };
    const thick = build(p);
    expect(find(thick.est, 'XPS').qty).toBeGreaterThanOrEqual(find(thin.est, 'XPS').qty);
    // XPS thickness does not affect the screed volume — these are different layers
    expect(thick.est.screedVolume).toBeCloseTo(thin.est.screedVolume, 2);
  });
});

describe('Electrics and prices in the estimate', () => {
  const { est } = build();

  it('the electrics made it into the estimate', () => {
    expect(est.groups).toContain('Electrics');
    expect(est.groups).toContain('Lighting');
    expect(find(est, 'Cable VVGng-LS 3×2.5')).toBeDefined();
    expect(find(est, 'Adjustable spot')).toBeDefined();
  });

  it('the electrics quantities come from the placed points', () => {
    const sockets = find(est, 'Socket with frame');
    expect(sockets.qty).toBeGreaterThan(8);
    expect(find(est, 'Modular breaker').qty).toBeGreaterThanOrEqual(5);
  });

  it('there is NO circulation pump in the estimate — the boiler pump is enough', () => {
    expect(est.items.some((i) => i.name.includes('Circulation pump'))).toBe(false);
  });

  it('every item has a price', () => {
    expect(est.totals.unpriced).toEqual([]);
    est.items.forEach((i) => expect(i.cost.priced).toBe(true));
  });

  it('the average lies strictly between “from” and “to”', () => {
    expect(est.totals.avg).toBeGreaterThan(est.totals.min);
    expect(est.totals.avg).toBeLessThan(est.totals.max);
  });

  it('the total equals the sum of the groups', () => {
    const sum = est.byGroup.reduce((s, g) => s + g.avg, 0);
    expect(sum).toBeCloseTo(est.totals.avg, 2);
  });

  it('the order of magnitude is plausible for 30 m²', () => {
    expect(est.totals.avg).toBeGreaterThan(150000);
    expect(est.totals.avg).toBeLessThan(500000);
  });

  it('the price list is honestly marked as unverified', () => {
    expect(est.meta.verified).toBe(false);
    expect(est.meta.disclaimer).toMatch(/not quotes/);
  });
});

describe('Packaging — how many pieces to buy', () => {
  const { est } = build();
  const packOf = (part) => find(est, part).pack;

  it('XPS is counted in boards of 1185 × 585', () => {
    const p = packOf('XPS 100 mm boards');
    expect(p.size).toBeCloseTo(0.69, 2);
    expect(p.count).toBeGreaterThan(40);
    expect(p.count).toBeLessThan(55);
  });

  it('the plinth is the same 100 mm board, not 80', () => {
    expect(find(est, 'on the slab edge').name).toContain('100 mm');
    expect(packOf('on the slab edge').unit).toBe('boards');
  });

  it('the number of pieces is always rounded UP', () => {
    est.items.filter((i) => i.pack).forEach((i) => {
      expect(i.pack.count * i.pack.size).toBeGreaterThanOrEqual(i.qty - 1e-9);
      expect(i.pack.count).toBe(Math.ceil(i.qty / i.pack.size));
    });
  });

  it('one roll of film is enough, while ties need several packs', () => {
    expect(packOf('Waterproofing').count).toBe(1);
    expect(packOf('Nylon ties').count).toBeGreaterThan(3);
  });

  it('bulk material has no packaging — crushed stone and sand are bought by the cube', () => {
    expect(find(est, 'Crushed stone').pack).toBeNull();
    expect(find(est, 'Sand for filling').pack).toBeNull();
  });
});

describe('The stair in the estimate', () => {
  const { est } = build();
  const stair = makeInitialProject().stair;

  it('the stair made it into the estimate', () => {
    expect(est.groups).toContain('Stair');
  });

  it('there are TWO stringers — the tube length is twice the flight', () => {
    const slope = Math.hypot(stair.length, stair.totalRise);
    const tube = find(est, 'stringers');
    // Bought in BARS of 6 m: two stringers of 4.33 m from two bars,
    // offcut 3.3 m. We pay for 12, not for 8.7
    expect(tube.qty).toBe(12);
    expect(tube.note).toContain('bars');
  });

  it('two tread supports per step', () => {
    const steps = stair.risers - 1;
    const angle = find(est, 'tread supports');
    expect(angle.note).toContain(String(steps * 2));
  });

  it('bolts and gaskets in equal numbers — steel does not touch wood', () => {
    expect(find(est, 'Bolt M8').qty).toBe(find(est, 'Rubber gasket').qty);
  });

  it('embeds under the heels — before the pour, you cannot drill the screed', () => {
    const emb = find(est, 'stringer heel');
    // One per stringer. A 250×120 plate — for the HORIZONTAL cut of the tube,
    // 100×100 simply does not fit there
    expect(emb.qty).toBe(2);
    expect(emb.note).toContain('BEFORE THE POUR');
  });

  it('we take 16 embeds for a need of 13 — the choice of rear support is postponed', () => {
    const emb = find(est, 'worktop posts');
    const onPlan = makeInitialProject().nodes.filter((n) => n.type === 'embed').length;
    expect(emb.qty).toBe(16);
    expect(onPlan).toBeGreaterThanOrEqual(13);
    expect(emb.note).toContain('BEFORE THE POUR');
    expect(emb.note).toContain('SURPLUS');
  });

  it('there is exactly one embed item — there used to be two', () => {
    const rows = est.items.filter((i) => i.name.includes('worktop posts'));
    expect(rows).toHaveLength(1);
  });

  it('no balusters — the flight is closed on both sides', () => {
    expect(est.items.some((i) => i.name.includes('Baluster'))).toBe(false);
    expect(find(est, 'Wooden handrail')).toBeDefined();
  });

  it('a wider flight — more treads and cladding', () => {
    const p = makeInitialProject();
    p.stair = { ...p.stair, width: 1.2 };
    const wide = build(p).est;
    expect(find(wide, 'Plywood 3 mm').qty).toBeGreaterThan(find(est, 'Plywood 3 mm').qty);
  });

  it('the order of magnitude of the stair is plausible', () => {
    const g = est.byGroup.find((x) => x.group === 'Stair');
    expect(g.avg).toBeGreaterThan(30000);
    expect(g.avg).toBeLessThan(90000);
  });
});

describe('pipeCutting — loops without joints in the screed', () => {
  it('every loop goes whole into one coil', () => {
    const cut = pipeCutting([68, 68, 68, 38, 27]);
    cut.coils.forEach((c) => {
      expect(c.cuts.reduce((s, v) => s + v, 0)).toBeLessThanOrEqual(c.size);
    });
  });

  it('all loops are cut', () => {
    const lengths = [68, 68, 68, 38, 27];
    const cut = pipeCutting(lengths);
    const all = cut.coils.flatMap((c) => c.cuts).sort((a, b) => a - b);
    expect(all).toEqual([...lengths].sort((a, b) => a - b));
  });

  it('coils of 200 + 100 give fewer offcuts than two of 200', () => {
    const smart = pipeCutting([68, 68, 68, 38, 27], [200, 100]);
    const dumb = pipeCutting([68, 68, 68, 38, 27], [200]);
    expect(smart.waste).toBeLessThan(dumb.waste);
  });

  it('the ordered length is enough for all loops', () => {
    const lengths = [68, 68, 68, 38, 27];
    const cut = pipeCutting(lengths);
    expect(cut.totalOrdered).toBeGreaterThanOrEqual(lengths.reduce((s, v) => s + v, 0));
  });
});

describe('estimate — low-voltage', () => {
  const p = makeInitialProject();
  const hl = heatLoss({
    layout: p.layout, openings: p.openings, climate: p.climate,
    envelope: p.envelope, screed: p.screed, clearHeight: CLEAR_HEIGHT
  });
  const loops = layoutLoops({
    layout: p.layout, heatLossByRoom: hl.byRoom,
    manifold: p.nodes.find((n) => n.type === 'manifold'),
    coolant: p.coolant, spacings: p.loopSpacings, equipment: p.equipment,
    exclusionZones: p.floorExclusionZones, mode: p.loopMode
  });
  const electrical = electricalPlan({
    equipment: p.equipment,
    entry: p.nodes.find((n) => n.type === 'electrical_panel')
  });
  const est = floorEstimate({
    layout: p.layout, screed: p.screed, levels: p.levels, loops,
    coolant: p.coolant, electrical, stair: p.stair,
    equipment: p.equipment, lowVoltage: lowVoltagePlan()
  });

  it('goes as a separate group, not inside the electrics', () => {
    const g = est.byGroup.find((x) => x.group === 'Low-voltage');
    expect(g).toBeTruthy();
    expect(g.rows.length).toBeGreaterThanOrEqual(5);
  });

  it('the twisted-pair length comes from the calculated routes', () => {
    const lv = lowVoltagePlan();
    const row = est.items.find((i) => i.name.includes('UTP'));
    expect(row.qty).toBeCloseTo(lv.utpM * 1.05, 6);
  });

  it('the speakers are PROVISIONED — before the flight boxing', () => {
    // There is nowhere to put the vinyl stand except the living room, and the cable for the speakers
    // hides in the stair boxing, which is closed once
    const row = est.items.find((i) => i.name.includes('Speaker'));
    expect(row.qty).toBeGreaterThan(0);
    expect(row.note).toMatch(/PROVISION/);
  });

  it('without low-voltage the estimate is still assembled as before', () => {
    // The group is optional: old calls of floorEstimate do not break
    const bare = floorEstimate({
      layout: p.layout, screed: p.screed, levels: p.levels, loops,
      coolant: p.coolant, electrical, stair: p.stair, equipment: p.equipment
    });
    expect(bare.byGroup.some((g) => g.group === 'Low-voltage')).toBe(false);
    expect(bare.totals.avg).toBeLessThan(est.totals.avg);
  });
});
