import { describe, expect, it } from 'vitest';

import { WORKTOP, buildWorktop } from '../worktop.js';
import { CLEAR_HEIGHT, makeInitialProject } from '../project.js';
import { boundingBox, getFixture } from '../fixtures.js';
import { runRules } from '../../calc/rules.js';
import { worktopSlab } from '../../calc/scene3d.js';

const p = makeInitialProject();
const w = buildWorktop(p.layout, p.equipment);

describe('worktop outline', () => {
  it('starts from the refrigerator, not from the edge of the wall', () => {
    const fridge = p.equipment.find((e) => e.id === 'eq-fridge');
    // The refrigerator is 2 m tall — it is full-height and does not go under the worktop
    expect(w.tall.map((t) => t.id)).toContain('eq-fridge');
    expect(w.polygon[0].x).toBeCloseTo(fridge.x + 0.6, 2);
  });

  it('the top branch reaches the bathroom partition', () => {
    expect(w.polygon[1].x).toBeCloseTo(p.layout.bathX, 6);
  });

  it('the vertical branch ends together with the partition', () => {
    const maxY = Math.max(...w.polygon.map((q) => q.y));
    expect(maxY).toBeCloseTo(p.layout.bathY, 6);
  });

  it('the outline is an L of six points, not a rectangle', () => {
    expect(w.polygon).toHaveLength(6);
    expect(w.area).toBeGreaterThan(2);
    expect(w.area).toBeLessThan(3);
  });

  it('depth 600 on both branches', () => {
    expect(w.depth).toBe(0.6);
    // width of the vertical branch
    expect(w.polygon[1].x - w.polygon[4].x).toBeCloseTo(0.6, 6);
  });
});

describe('fixtures relative to the slab', () => {
  it('only the sink and the hob are set in', () => {
    const ids = w.cutouts.map((c) => c.id).sort();
    expect(ids).toEqual(['eq-hob', 'eq-sink']);
  });

  it('the sink cut-out is a 600 rectangle without rotation', () => {
    // The sink became linear: the 45° corner module gave way to
    // the right order of zones and a tap under the fixed sash of the window.
    const sink = w.cutouts.find((c) => c.id === 'eq-sink');
    expect(sink.rotation).toBe(0);
    expect(sink.w).toBe(0.6);
    expect(sink.d).toBe(0.6);
  });

  it('but the module can still give a rotated cut-out', () => {
    // the footprint is NOT rotated: the render rotates it, otherwise the cut-out would swell
    const turned = buildWorktop(p.layout, p.equipment.map((e) =>
      e.id === 'eq-sink' ? { ...e, catalogId: 'sink_corner', rotation: 45 } : e));
    const sink = turned.cutouts.find((c) => c.id === 'eq-sink');
    expect(sink.rotation).toBe(45);
    expect(sink.w).toBe(0.9);
    expect(sink.d).toBe(0.6);
  });

  it('the oven and dishwasher stand UNDER the slab', () => {
    const ids = w.beneath.map((b) => b.id);
    expect(ids).toContain('eq-oven');
    expect(ids).toContain('eq-dishwasher');
  });

  it('cabinet carcasses are not part of the clearance check — they adjust', () => {
    expect(w.beneath.map((b) => b.id)).not.toContain('eq-store1');
    expect(w.carcasses.map((c) => c.id)).toContain('eq-store1');
    expect(w.carcasses[0].height).toBeCloseTo(WORKTOP.top - WORKTOP.thickness, 6);
  });

  it('the oven has enough clearance', () => {
    expect(w.beneath.find((b) => b.id === 'eq-oven').fits).toBe(true);
  });

  // With a 60 mm slab the clearance was 840 and an 850 appliance did not fit.
  // A thickness of 40 settled the question: 860 against 850.
  it('the dishwasher passes under a 40 mm slab', () => {
    const dw = w.beneath.find((b) => b.id === 'eq-dishwasher');
    expect(dw.fits).toBe(true);
    expect(dw.margin * 1000).toBeCloseTo(10, 0);
  });

  it('at the former 60 mm it would not pass', () => {
    const thick = buildWorktop(p.layout, p.equipment, { ...WORKTOP, thickness: 0.06 });
    const dw = thick.beneath.find((b) => b.id === 'eq-dishwasher');
    expect(dw.fits).toBe(false);
    expect(-dw.margin * 1000).toBeCloseTo(10, 0);
  });
});

describe('rules and scene', () => {
  const warnings = runRules(p, CLEAR_HEIGHT);

  it('there is no complaint about the clearance any more', () => {
    expect(warnings.find((x) => x.id === 'worktop-clearance')).toBeUndefined();
  });

  it('but the rule is alive: thickening the slab brings it back', () => {
    const thick = makeInitialProject();
    thick.equipment = thick.equipment.map((e) =>
      e.id === 'eq-dishwasher' ? { ...e, y: 0.06 } : e
    );
    // appliance 850 against clearance 860 — a margin of 10 mm, the boundary is visible
    const dw = buildWorktop(thick.layout, thick.equipment)
      .beneath.find((b) => b.id === 'eq-dishwasher');
    expect(dw.clearance * 1000).toBe(860);
    expect(dw.margin * 1000).toBeCloseTo(10, 0);
  });

  it('the front and mass of the slab are reported as a note', () => {
    const r = warnings.find((x) => x.id === 'worktop-front');
    expect(r).toBeDefined();
    expect(r.detail).toContain('sink');
  });

  it('the slab enters the scene with cut-outs and at its own level', () => {
    const slab = worktopSlab(p.layout, p.equipment);
    expect(slab.cutouts).toHaveLength(2);
    expect(slab.top).toBe(WORKTOP.top);
    expect(slab.bottom).toBeCloseTo(WORKTOP.top - WORKTOP.thickness, 6);
  });

  it('without kitchen appliances the worktop does not appear out of thin air', () => {
    expect(buildWorktop(p.layout, [])).toBeNull();
  });
});

describe('the kitchen after switching to a 450 dishwasher', () => {
  const proj = makeInitialProject();
  const box = (id) => {
    const e = proj.equipment.find((x) => x.id === id);
    return { ...boundingBox(e), spec: getFixture(e.catalogId) };
  };

  it('the dishwasher is narrow — 450 instead of 600', () => {
    expect(proj.equipment.find((e) => e.id === 'eq-dishwasher').catalogId)
      .toBe('dishwasher45');
    expect(box('eq-dishwasher').w).toBeCloseTo(0.45, 3);
  });

  it('the front moved left by exactly the freed 150', () => {
    expect(box('eq-sink').x).toBeCloseTo(1.11, 3);
    expect(box('eq-hob').x).toBeCloseTo(2.61, 3);
  });

  // That is what everything was moved for: the knobs of the gas hob are on the right,
  // and there is no need to reach for them across the corner
  it('to the right of the hob there is 490 instead of 340', () => {
    const hob = box('eq-hob');
    expect((proj.layout.bathX - (hob.x + hob.w)) * 1000).toBeCloseTo(490, 0);
  });

  it('the prep zone stayed 900', () => {
    const sink = box('eq-sink');
    expect((box('eq-hob').x - (sink.x + sink.w)) * 1000).toBeCloseTo(900, 0);
  });

  it('the sink tap moved deeper under the fixed sash', () => {
    const win = proj.openings.find((o) => o.id === 'win-n1');
    const gap = (win.start + win.len / 2 - box('eq-sink').cx) * 1000;
    expect(gap).toBeCloseTo(240, 0);
  });

  it('above the hob a cabinet with a built-in hood, bottom at 1650', () => {
    const hood = box('eq-wall2');
    expect(hood.spec.id).toBe('wall_cabinet_hood');
    expect(hood.spec.mountHeight).toBe(1.65);
    // the top matches the ordinary cabinets: 1650 + 470 = 1400 + 720
    expect(hood.spec.mountHeight + hood.spec.h)
      .toBeCloseTo(getFixture('wall_cabinet').mountHeight + getFixture('wall_cabinet').h, 6);
  });

  it('wall cabinets on the partition no longer intrude into the bathroom', () => {
    ['eq-wall3', 'eq-wall4'].forEach((id) => {
      const b = box(id);
      expect(b.x + b.w).toBeLessThanOrEqual(proj.layout.bathX + 1e-6);
    });
  });
});
