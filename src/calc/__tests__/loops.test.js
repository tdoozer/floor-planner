import { describe, expect, it } from 'vitest';

import {
  ALPHA,
  EDGE_ZONE,
  MIN_FURNITURE_GAP,
  overlapsEdgeZone,
  bifilarOrder,
  floorOutput,
  layoutLoops,
  pathSegments,
  pipeLength,
  roomLoops,
  supplyRun
} from '../loops.js';
import { heatLoss } from '../heatloss.js';
import { CLEAR_HEIGHT, buildRooms, makeInitialProject } from '../../data/project.js';
import { boundingBox, getFixture } from '../../data/fixtures.js';

function build(project = makeInitialProject()) {
  const hl = heatLoss({
    layout: project.layout,
    openings: project.openings,
    climate: project.climate,
    envelope: project.envelope,
    screed: project.screed,
    clearHeight: CLEAR_HEIGHT
  });
  return layoutLoops({
    layout: project.layout,
    heatLossByRoom: hl.byRoom,
    manifold: project.nodes.find((n) => n.type === 'manifold'),
    coolant: project.coolant,
    equipment: project.equipment,
    exclusionZones: project.floorExclusionZones,
    mode: project.loopMode,
    kitchenOnFrame: project.kitchenOnFrame
  });
}

describe('floorOutput', () => {
  it('output grows with the surface–air difference', () => {
    const warm = floorOutput({ maxFloorTemp: 31, airTemp: 24, spacing: 0.15 });
    const cool = floorOutput({ maxFloorTemp: 26, airTemp: 20, spacing: 0.15 });
    expect(warm).toBeGreaterThan(cool);
  });

  it('a wide pitch reduces output', () => {
    const tight = floorOutput({ maxFloorTemp: 26, airTemp: 20, spacing: 0.1 });
    const wide = floorOutput({ maxFloorTemp: 26, airTemp: 20, spacing: 0.25 });
    expect(wide).toBeLessThan(tight);
    expect(tight).toBeCloseTo(ALPHA * 6, 6);
  });
});

describe('pipeLength', () => {
  it('the feed counts twice in the length', () => {
    const a = pipeLength({ area: 20, spacing: 0.15, supplyRunM: 0 });
    const b = pipeLength({ area: 20, spacing: 0.15, supplyRunM: 5 });
    expect(b - a).toBeCloseTo(10, 6);
  });
});

describe('supplyRun', () => {
  it('Manhattan distance from the manifold to the room centre', () => {
    const square = [{ x: 4, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 }, { x: 4, y: 2 }];
    expect(supplyRun({ x: 0, y: 0 }, square)).toBeCloseTo(5 + 1, 6);
  });
});

describe('layoutLoops — the owner requirement', () => {
  const L = build();
  const byId = (id) => L.byRoom.find((r) => r.id === id);

  it('the bathroom and the hall each fit into one loop', () => {
    expect(byId('bath').loops).toBe(1);
    expect(byId('hall').loops).toBe(1);
  });

  it('the living room does NOT fit into one loop', () => {
    expect(byId('living').loops).toBeGreaterThan(1);
  });

  it('even the widest working pitch does not save the living room', () => {
    const living = byId('living');
    const oneLoop = living.candidates.filter((c) => c.loops === 1);
    expect(oneLoop).toHaveLength(0);
  });

  // With the floor under the stair restored, the living room got so much margin that it closes
  // at ANY pitch. The chosen 200 is not a limit but a deliberate middle:
  // wider makes no sense, narrower is extra pipe.
  it('after restoring the floor under the stair the living room closes at any pitch', () => {
    byId('living').candidates.forEach((c) => expect(c.enough).toBe(true));
    expect(byId('living').spacing).toBeCloseTo(0.2, 3);
  });

  it('no loop is longer than the antifreeze limit', () => {
    L.byRoom.forEach((r) => expect(r.perLoop).toBeLessThanOrEqual(L.limit + 1e-6));
    expect(L.limit).toBeLessThan(90);
  });

  it('the living room is covered by the floor, the bathroom is not', () => {
    // In the living room the heating is left between the refrigerator and the hob and under the washing machine,
    // so the area is enough. In the bathroom the shower tray gets in the way:
    // 0.81 of 3.24 m² — a quarter of the room, and that cannot be won back.
    expect(L.byRoom.find((r) => r.id === 'living').deficit).toBe(false);
    expect(L.byRoom.find((r) => r.id === 'bath').deficit).toBe(true);
    expect(L.byRoom.find((r) => r.id === 'hall').deficit).toBe(false);
  });

  it('a solid kitchen front would put the living room back into deficit', () => {
    // Check that the margin rests precisely on the open stretches of floor
    const p = makeInitialProject();
    p.floorExclusionZones = [
      { id: 'all-top', x: 0, y: 0, w: 3.7, d: 0.6 },
      { id: 'all-side', x: 3.1, y: 0.6, w: 0.6, d: 1.2 },
      ...p.floorExclusionZones
    ];
    p.equipment = p.equipment.map((e) =>
      ['eq-washer', 'eq-sofa', 'eq-table'].includes(e.id) ? { ...e, floorExclusion: true } : e
    );
    expect(build(p).byRoom.find((r) => r.id === 'living').deficit).toBe(true);
  });

  it('without furniture the floor copes — the point is exactly the lost area', () => {
    const p = makeInitialProject();
    p.equipment = p.equipment.map((e) => ({ ...e, floorExclusion: false }));
    p.floorExclusionZones = [];
    build(p).byRoom.forEach((r) => expect(r.deficit).toBe(false));
  });

  it('the bathroom deficit is calculated quantitatively', () => {
    const bath = L.byRoom.find((r) => r.id === 'bath');
    const best = Math.max(...bath.candidates.map((c) => c.capacity));
    const shortfallW = (bath.requiredWm2 - best) * bath.effectiveArea;
    // On the order of 30 W — covered by a towel radiator
    expect(shortfallW).toBeGreaterThan(10);
    expect(shortfallW).toBeLessThan(60);
  });

  it('the living room keeps a margin of output', () => {
    const living = L.byRoom.find((r) => r.id === 'living');
    const best = Math.max(...living.candidates.map((c) => c.capacity));
    expect(best).toBeGreaterThan(living.requiredWm2);
  });

  it('the length imbalance requires balancing valves', () => {
    expect(L.balanced).toBe(false);
    expect(L.imbalance).toBeGreaterThan(0.3);
  });

  it('the living room fits into two loops with a confirmed limit', () => {
    // The rule of thumb gave 71 m and required three loops.
    // A verification hydraulic calculation allowed raising the limit to 75.
    const living = L.byRoom.find((r) => r.id === 'living');
    expect(living.limit).toBe(75);
    expect(living.loops).toBe(2);
    expect(living.perLoop).toBeLessThanOrEqual(living.limit);
  });

  it('four loops in total', () => {
    expect(L.totalLoops).toBe(4);
  });

  it('on propylene glycol the living room would need three loops', () => {
    // That is how it was counted until the fluid was read from the label
    const p = makeInitialProject();
    p.coolant = { ...p.coolant, maxLoopOverrideM: null, pressureDropFactor: 1.6 };
    const living = build(p).byRoom.find((r) => r.id === 'living');
    // 90 m for water, divided by the root of the 1.6 correction
    expect(living.limit).toBeCloseTo(71.2, 0);
    // Every loop fits the limit — otherwise there would be more loops
    expect(living.perLoop).toBeLessThanOrEqual(living.limit);
  });

  it('on the actual ethylene glycol two are enough even by the rule of thumb', () => {
    // Ethylene glycol is thinner: the limit rises from 71 to 76 m by itself,
    // and the override of 75 confirmed by calculation turns out to be more conservative
    const p = makeInitialProject();
    p.coolant = { ...p.coolant, maxLoopOverrideM: null };
    const living = build(p).byRoom.find((r) => r.id === 'living');
    expect(living.limit).toBeGreaterThan(75);
    expect(living.loops).toBe(2);
  });

  it('the bathroom and the hall each fit into one loop', () => {
    expect(L.byRoom.find((r) => r.id === 'bath').loops).toBe(1);
    expect(L.byRoom.find((r) => r.id === 'hall').loops).toBe(1);
  });

  it('without the edge zone the living room needs three loops', () => {
    const p = makeInitialProject();
    const bare = layoutLoops({
      layout: p.layout,
      heatLossByRoom: heatLoss({
        layout: p.layout, openings: p.openings, climate: p.climate,
        envelope: p.envelope, screed: p.screed, clearHeight: CLEAR_HEIGHT
      }).byRoom,
      manifold: p.nodes.find((n) => n.type === 'manifold'),
      coolant: p.coolant, equipment: p.equipment,
      exclusionZones: p.floorExclusionZones, edgeZone: false
    });
    const living = bare.byRoom.find((r) => r.id === 'living');
    // Without the edge zone the living room no longer closes at 200 — it is driven
    // to 100 mm and three loops. That is exactly what the edge zone buys.
    expect(living.spacing).toBeCloseTo(0.15, 3);
    expect(living.candidates.find((c) => c.spacing === 0.2).enough).toBe(false);
  });
});

describe('Furniture is subtracted from the heating field', () => {
  const L = build();
  const living = L.byRoom.find((r) => r.id === 'living');

  it('the kitchen eats usable area', () => {
    // A lower threshold than before: there are no manual zones any more, only
    // the appliances themselves are subtracted, and the linear 600 sink is smaller than the 1061 corner module
    expect(living.excludedArea).toBeGreaterThan(1.5);
    expect(living.effectiveArea).toBeLessThan(living.area);
  });

  it('the load on the remaining square metres grows', () => {
    expect(living.requiredWm2).toBeGreaterThan(living.requiredBare);
  });

  it('the toilet and washbasin do not displace the pipe — it is laid under them', () => {
    const bath = L.byRoom.find((r) => r.id === 'bath');
    // Only the shower tray is excluded
    expect(bath.exclusions).toHaveLength(1);
  });

  it('the washing machine under the stair displaces the pipe', () => {
    const ids = living.exclusions.length;
    expect(ids).toBeGreaterThan(3);
  });

  it('lifting the exclusion returns the area', () => {
    const p = makeInitialProject();
    p.equipment = p.equipment.map((e) => ({ ...e, floorExclusion: false }));
    p.floorExclusionZones = [];
    const free = build(p).byRoom.find((r) => r.id === 'living');
    // Rasterisation gives an error of the order of a nanometre — compare approximately
    expect(free.excludedArea).toBeCloseTo(0, 6);
    expect(free.requiredWm2).toBeCloseTo(free.requiredBare, 4);
  });
});

describe('Kitchen on an open frame', () => {
  const flat = build();
  const frame = build({ ...makeInitialProject(), kitchenOnFrame: true });
  const living = (L) => L.byRoom.find((r) => r.id === 'living');

  // The flag became CHANGE NOTHING, and that is the right state: everything it
  // used to lift — the manual exclusion zones — has been removed for good.
  // Appliances are subtracted identically in both modes.
  it('the frame returns nothing any more — there is nothing to return', () => {
    expect(living(frame).effectiveArea).toBeCloseTo(living(flat).effectiveArea, 6);
  });

  it('and the margin in the living room is the same in both modes', () => {
    const margin = (L) => {
      const r = living(L);
      return Math.max(...r.candidates.map((c) => c.capacity)) - r.requiredWm2;
    };
    expect(margin(frame)).toBeCloseTo(margin(flat), 6);
    expect(living(frame).deficit).toBe(false);
  });

  it('the sink, hob and floor-standing appliances are excluded on the frame too', () => {
    // Worktops move onto the frame, the rest stays subtracted.
    // A lower threshold than before: the linear 600 sink takes less floor
    // than the 1061 × 1061 corner module at 45°.
    expect(living(frame).excludedArea).toBeGreaterThan(1.5);
  });

  it('in the bathroom the frame changes nothing — there is a shower tray', () => {
    const bath = (L) => L.byRoom.find((r) => r.id === 'bath');
    expect(bath(frame).effectiveArea).toBeCloseTo(bath(flat).effectiveArea, 2);
    expect(bath(frame).deficit).toBe(true);
  });

  it('excluding the washing machine would take the area back', () => {
    const p = makeInitialProject();
    p.kitchenOnFrame = true;
    p.equipment = p.equipment.map((e) =>
      e.catalogId === 'washer' ? { ...e, floorExclusion: true } : e
    );
    expect(living(build(p)).effectiveArea).toBeLessThan(living(frame).effectiveArea);
  });
});

describe('Feed from the manifold', () => {
  const L = build();
  const p = makeInitialProject();
  const manifold = p.nodes.find((n) => n.type === 'manifold');

  it('the manifold stands between the boiler and the window', () => {
    const boiler = p.nodes.find((n) => n.type === 'boiler');
    // Boiler 4.80…5.20, window 3.20…4.10 — 700 mm between them
    expect(boiler.y).toBeCloseTo(4.8, 2);
    expect(manifold.y).toBeGreaterThanOrEqual(4.1);
    expect(manifold.y + manifold.d).toBeLessThanOrEqual(4.8);
  });

  it('every loop got its own route', () => {
    expect(L.supply.length).toBe(L.totalLoops);
  });

  it('there are NO diagonals in the routes — right angles only', () => {
    L.supply.forEach((route) => {
      for (let i = 1; i < route.points.length; i++) {
        const dx = Math.abs(route.points[i].x - route.points[i - 1].x);
        const dy = Math.abs(route.points[i].y - route.points[i - 1].y);
        // A segment is either horizontal or vertical
        expect(Math.min(dx, dy)).toBeLessThan(1e-6);
      }
    });
  });

  it('the pipes run in parallel lanes, not along one line', () => {
    const lanes = L.supply.map((r) => r.corridorX);
    expect(new Set(lanes).size).toBe(lanes.length);
  });

  it('the nearest loop gets the inner lane', () => {
    const sorted = [...L.supply].sort((a, b) => a.lane - b.lane);
    expect(sorted[0].corridorX).toBeLessThan(sorted[sorted.length - 1].corridorX);
  });
});

describe('Edge zone and furniture', () => {
  it('the strip is narrow: a metre would take half the room', () => {
    expect(EDGE_ZONE.width).toBeLessThanOrEqual(0.6);
    expect(EDGE_ZONE.spacing).toBeLessThan(0.15);
  });

  it('the run in the edge strip is denser than in the field', () => {
    const living = build().byRoom.find((r) => r.id === 'living');
    const edgeRows = living.path.rows.filter((r) => r.edge);
    expect(edgeRows.length).toBeGreaterThan(5);
    expect(edgeRows.length).toBeLessThan(living.path.rows.length);
  });

  it('without the edge zone the run is uniform', () => {
    const p = makeInitialProject();
    const bare = layoutLoops({
      layout: p.layout,
      heatLossByRoom: heatLoss({
        layout: p.layout, openings: p.openings, climate: p.climate,
        envelope: p.envelope, screed: p.screed, clearHeight: CLEAR_HEIGHT
      }).byRoom,
      manifold: p.nodes.find((n) => n.type === 'manifold'),
      coolant: p.coolant, equipment: p.equipment,
      exclusionZones: p.floorExclusionZones, edgeZone: false
    });
    const living = bare.byRoom.find((r) => r.id === 'living');
    expect(living.path.rows.every((r) => !r.edge)).toBe(true);
  });

  it('a sofa by the south wall falls into the edge strip', () => {
    const sofa = makeInitialProject().equipment.find((e) => e.catalogId === 'sofa');
    expect(overlapsEdgeZone(boundingBox(sofa))).toBe(true);
  });

  it('a dining table in the centre does not', () => {
    const table = makeInitialProject().equipment.find((e) => e.catalogId === 'dining_table');
    expect(overlapsEdgeZone(boundingBox(table))).toBe(false);
  });

  it('the minimum gap is set explicitly', () => {
    expect(MIN_FURNITURE_GAP).toBeGreaterThanOrEqual(0.05);
  });
});

describe('The snake run goes around furniture', () => {
  const L = build();

  it('every room has a run geometry built', () => {
    L.byRoom.forEach((r) => {
      expect(r.path.points.length).toBeGreaterThan(4);
      expect(r.loopPaths.length).toBe(r.loops);
    });
  });

  it('run points do not fall inside the excluded patches', () => {
    const living = L.byRoom.find((r) => r.id === 'living');
    living.path.points.forEach((p) => {
      living.exclusions.forEach((e) => {
        const inside = p.x > e.x + 0.01 && p.x < e.x + e.w - 0.01
          && p.y > e.y + 0.01 && p.y < e.y + e.d - 0.01;
        expect(inside).toBe(false);
      });
    });
  });

  it('the run stays inside the house envelope', () => {
    L.byRoom.forEach((r) => {
      r.path.points.forEach((p) => {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(5.5);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(5.5);
      });
    });
  });

  it('splitting into loops keeps all the passes', () => {
    const living = L.byRoom.find((r) => r.id === 'living');
    const total = living.loopPaths.reduce((s, p) => s + p.length, 0);
    expect(total).toBe(living.path.points.length);
  });
});

describe('Counterflow laying', () => {
  it('row order alternates: forward every other one, return on the skipped ones', () => {
    const rows = [0, 1, 2, 3, 4, 5].map((i) => ({ y: i, x1: 0, x2: 1 }));
    const order = bifilarOrder(rows).map((r) => r.y);
    // Forward on the even ones, back on the odd ones
    expect(order).toEqual([0, 2, 4, 5, 3, 1]);
  });

  it('adjacent rows are spaced apart along the loop — except at the turning point', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ y: i, x1: 0, x2: 1 }));
    const order = bifilarOrder(rows).map((r) => r.y);

    const gaps = [];
    for (let y = 0; y < 7; y++) {
      gaps.push(Math.abs(order.indexOf(y) - order.indexOf(y + 1)));
    }
    // Exactly one pair goes in a row — where the pipe turns round
    // at the far edge. This is the physics of a snail, not a flaw of the layout.
    expect(gaps.filter((g) => g === 1)).toHaveLength(1);
    expect(gaps.filter((g) => g > 1)).toHaveLength(6);
  });

  it('all rows are used exactly once', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ y: i, x1: 0, x2: 1 }));
    const order = bifilarOrder(rows).map((r) => r.y).sort((a, b) => a - b);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('the pipe length does not depend on the laying order', () => {
    const p = makeInitialProject();
    const bif = build({ ...p, loopMode: 'bifilar' }).totalPipe;
    const ser = build({ ...p, loopMode: 'serpentine' }).totalPipe;
    expect(bif).toBeCloseTo(ser, 6);
  });

  it('route segments are marked from supply to return', () => {
    const segs = pathSegments([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
    expect(segs[0].t).toBeLessThan(segs[segs.length - 1].t);
    expect(segs[0].t).toBeGreaterThanOrEqual(0);
    expect(segs[segs.length - 1].t).toBeLessThanOrEqual(1);
  });
});

describe('roomLoops — effect of the coolant', () => {
  it('on water the loop limit is higher than on antifreeze', () => {
    const p = makeInitialProject();
    const room = buildRooms(p.layout).find((r) => r.id === 'living');
    const args = {
      room,
      area: 22.41,
      requiredWm2: 56,
      airTemp: 20,
      manifold: { x: 0.3, y: 3.26 },
      preferredSpacing: 0.2
    };
    const glycol = roomLoops({ ...args, coolant: p.coolant });
    const water = roomLoops({ ...args, coolant: { pressureDropFactor: 1 } });
    expect(water.limit).toBeGreaterThan(glycol.limit);
    // But the living room does not fit into one loop even on water
    expect(water.loops).toBeGreaterThan(1);
  });
});

describe('underfloor heating under the stair', () => {
  const p = makeInitialProject();

  // The 800 × 2600 strip under the flight used to be subtracted “as not a room”.
  // A mistake: the heat loss of the living room is counted for the full area, including it
  // and the section of the EAST OUTER WALL above it.
  it('no exclusion zones under the stair are left', () => {
    const stair = p.floorExclusionZones.filter((z) => z.x >= 4.5);
    expect(stair).toHaveLength(0);
  });

  it('no manual exclusion zones are left at all', () => {
    expect(p.floorExclusionZones).toHaveLength(0);
  });

  it('the usable area of the living room grew to 20 m²', () => {
    const L = build(p);
    const living = L.byRoom.find((r) => r.id === 'living');
    expect(living.effectiveArea).toBeGreaterThan(19.9);
    expect(living.deficit).toBe(false);
  });

  it('the living room margin became two-digit and the pitch widened to 200', () => {
    const living = build(p).byRoom.find((r) => r.id === 'living');
    const cap = Math.max(...living.candidates.map((c) => c.capacity));
    expect(cap - living.requiredWm2).toBeGreaterThan(10);
    expect(living.spacing).toBeCloseTo(0.2, 3);
  });

  it('restoring the exclusion squeezes the living room again', () => {
    const tight = makeInitialProject();
    tight.floorExclusionZones = [
      ...tight.floorExclusionZones,
      { id: 'under-stair', x: 4.7, y: 1.8, w: 0.8, d: 2.6 }
    ];
    const living = build(tight).byRoom.find((r) => r.id === 'living');
    const cap = Math.max(...living.candidates.map((c) => c.capacity));
    expect(cap - living.requiredWm2).toBeLessThan(7);
  });
});

describe('furniture on the floor against furniture at the wall', () => {
  const withWardrobe = (excl) => {
    const p = makeInitialProject();
    p.equipment = [
      ...p.equipment,
      { id: 'eq-wardrobe', catalogId: 'wardrobe', x: 0.45, y: 4.6, rotation: 0,
        ...(excl === undefined ? {} : { floorExclusion: excl }) }
    ];
    return build(p).byRoom.find((r) => r.id === 'hall');
  };

  // The cupboard was the only piece of furniture that subtracted floor — and that
  // differed from the sofa, the benches and the shelving unit.
  it('the wardrobe does not displace the pipe', () => {
    expect(getFixture('wardrobe').floorExclusion).toBe(false);
    expect(withWardrobe(undefined).effectiveArea).toBeCloseTo(4.6, 2);
  });

  it('all furniture behaves the same', () => {
    ['sofa', 'bench', 'dining_table', 'shelf_open', 'tv_unit', 'wardrobe']
      .forEach((id) => expect(getFixture(id).floorExclusion).toBeFalsy());
  });

  // The hall closes in both cases — the point is not the power,
  // but the cold pocket behind the back panel of a cupboard at the outer wall
  it('excluding the cupboard raises the required output, but there is no deficit', () => {
    const off = withWardrobe(true);
    const on = withWardrobe(false);
    expect(off.requiredWm2).toBeGreaterThan(on.requiredWm2);
    expect(off.deficit).toBe(false);
    expect(on.deficit).toBe(false);
  });
});

describe('kitchen exclusion zones after the sink moved', () => {
  const p = makeInitialProject();

  // The zones described the CORNER 1061 × 1061 sink at the bathroom partition.
  // The sink became linear and moved under the window — the zones stayed hanging
  // where the hob and oven are now, and doubled their own exclusion.
  it('no manual zones are left in the right variant', () => {
    expect(p.floorExclusionZones).toHaveLength(0);
  });

  it('appliances still subtract their own footprint', () => {
    ['fridge', 'sink', 'dishwasher60', 'hob_gas', 'oven']
      .forEach((id) => expect(getFixture(id).floorExclusion).toBe(true));
  });

  it('a base cabinet does not displace the pipe — it stands on a ventilated plinth', () => {
    const store = p.equipment.find((e) => e.id === 'eq-store1');
    expect(store.floorExclusion).toBe(false);
  });

  it('the living room gained more area and margin', () => {
    const living = build(p).byRoom.find((r) => r.id === 'living');
    const cap = Math.max(...living.candidates.map((c) => c.capacity));
    expect(living.effectiveArea).toBeGreaterThan(20.5);
    expect(cap - living.requiredWm2).toBeGreaterThan(14);
  });
});
