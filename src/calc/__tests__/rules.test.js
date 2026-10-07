import { describe, expect, it } from 'vitest';

import { runRules } from '../rules.js';
import {
  CLEAR_HEIGHT,
  VARIANT_IDS,
  contentRevision,
  makeInitialProject
} from '../../data/project.js';
import { connectionPoints } from '../../data/fixtures.js';
import { floorEstimate } from '../estimate.js';
import { drainFit, drainRoute, floorLevels, insulationOptions, riserPoint } from '../geometry.js';

function ids(warnings) {
  return warnings.map((w) => w.id);
}

// Slope margin for a specific fixture — a helper for the tests
function drainMargin(project, catalogId) {
  const riser = project.nodes.find((n) => n.type === 'sewer_riser');
  const item = project.equipment.find((e) => e.catalogId === catalogId);
  const c = connectionPoints(item).find((p) => p.kind === 'drain');
  const route = drainRoute(c, riserPoint(riser));
  return {
    routeLength: route.length,
    ...drainFit({
      routeLength: route.length,
      dia: c.dia,
      riserInvertM: riser.invert,
      screed: project.screed
    })
  };
}

describe('runRules — starting layout', () => {
  const project = makeInitialProject();
  const warnings = runRules(project, CLEAR_HEIGHT);

  it('always reports unconfirmed references', () => {
    expect(ids(warnings)).toContain('unconfirmed');
  });

  it('on the original geometry the drains fit in the floor build-up', () => {
    const drainErrors = warnings.filter((w) => w.id.startsWith('drain-') && w.severity === 'error');
    expect(drainErrors).toHaveLength(0);
  });

  it('fixtures do not overlap each other', () => {
    expect(warnings.filter((w) => w.id.startsWith('overlap-'))).toHaveLength(0);
  });

  it('the hob reaches the gas inlet', () => {
    // The inlet is measured right in the corner and cannot be moved — it is built
    // into the gas supply design of the house. The hob stands at the right end of the front:
    // 0.56 m against a limit of 1.5. It did not have to be driven INTO the corner.
    expect(warnings.find((w) => w.id === 'gas-eq-hob')).toBeUndefined();
  });

  it('a hob moved to the refrigerator no longer reaches again', () => {
    const project = makeInitialProject();
    project.equipment = project.equipment.map((e) =>
      e.catalogId === 'hob_gas' ? { ...e, x: 1.0 } : e
    );
    const gas = runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'gas-eq-hob');
    expect(gas).toBeDefined();
    expect(gas.severity).toBe('warn');
  });
});

describe('runRules — drain slope', () => {
  it('a toilet dragged away from the stack breaks the slope', () => {
    const project = makeInitialProject();
    project.equipment = project.equipment.map((e) =>
      e.catalogId === 'wc' ? { ...e, x: 0.3, y: 5.0 } : e
    );
    const warnings = runRules(project, CLEAR_HEIGHT);
    const err = warnings.find((w) => w.id.startsWith('drain-') && w.severity === 'error');
    expect(err).toBeDefined();
    expect(err.title).toContain('does not fit');
  });

  it('thicker XPS by itself does not break a drain — the limit comes from the screed', () => {
    const project = makeInitialProject();
    project.screed = { ...project.screed, insulation: 200 };
    const warnings = runRules(project, CLEAR_HEIGHT);
    expect(warnings.filter((w) => w.id.startsWith('drain-') && w.severity === 'error')).toHaveLength(0);
  });
});

describe('runRules — headroom under the flight', () => {
  it('a shower under the lower part of the flight gets a warning', () => {
    const project = makeInitialProject();
    project.equipment = project.equipment.map((e) =>
      e.catalogId === 'shower' ? { ...e, x: 4.6, y: 3.4 } : e
    );
    const warnings = runRules(project, CLEAR_HEIGHT);
    const head = warnings.find((w) => w.id.startsWith('head-'));
    expect(head).toBeDefined();
    expect(head.title).toContain('Not enough headroom');
  });

  it('in the original placement the shower stands in the high part', () => {
    const project = makeInitialProject();
    const warnings = runRules(project, CLEAR_HEIGHT);
    expect(warnings.find((w) => w.id === 'head-eq-shower')).toBeUndefined();
  });
});

describe('runRules — moving the opening over the bathroom', () => {
  it('the proposed shallow flight requires moving the opening', () => {
    const project = makeInitialProject();
    const warnings = runRules(project, CLEAR_HEIGHT);
    const w = warnings.find((x) => x.id === 'stair-opening');
    expect(w).toBeDefined();
    // An opening from 1.80 m to 1.00 m = 800 mm
    expect(w.title).toContain('800');
  });

  it('if the flight stays within the existing opening, no move is needed', () => {
    const project = makeInitialProject();
    project.stair = { ...project.stair, y: 1.8, length: 2.6 };
    const warnings = runRules(project, CLEAR_HEIGHT);
    expect(warnings.find((x) => x.id === 'stair-opening')).toBeUndefined();
    // ...but then the flight stops fitting — that is the present steepness
    expect(warnings.find((x) => x.id === 'stair-run')).toBeDefined();
  });

  it('in the original position both the approach and the landing are at least a metre', () => {
    const warnings = runRules(makeInitialProject(), CLEAR_HEIGHT);
    expect(warnings.find((x) => x.id === 'stair-approach')).toBeUndefined();
    expect(warnings.find((x) => x.id === 'stair-landing')).toBeUndefined();
  });

  it('lengthening the flight upwards eats the landing on the second floor', () => {
    const project = makeInitialProject();
    project.stair = { ...project.stair, y: 0.6, length: 3.8 };
    const w = runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'stair-landing');
    expect(w).toBeDefined();
    expect(w.severity).toBe('error');
    expect(w.title).toContain('600');
  });

  it('moving the flight down eats the approach in front of the bottom step', () => {
    const project = makeInitialProject();
    project.stair = { ...project.stair, y: 1.4 }; // the bottom moves to 4.80
    const w = runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'stair-approach');
    expect(w).toBeDefined();
    expect(w.severity).toBe('error');
    expect(w.title).toContain('700');
  });

  it('the selector stays silent: the accepted flight already passes all criteria', () => {
    // 15 risers of 200 × 243 were accepted by the owner, nothing to suggest
    const p = makeInitialProject();
    expect(p.stair.risers).toBe(15);
    expect(runRules(p, CLEAR_HEIGHT).find((x) => x.id === 'stair-best')).toBeUndefined();
  });

  it('but with the former 17 risers the selector suggests 15 again', () => {
    const p = makeInitialProject();
    p.stair = { ...p.stair, risers: 17, tread: 3.4 / 16 };
    const w = runRules(p, CLEAR_HEIGHT).find((x) => x.id === 'stair-best');
    expect(w).toBeDefined();
    expect(w.title).toContain('15');
  });

  it('after applying the selection the hint disappears', () => {
    const project = makeInitialProject();
    project.stair = { ...project.stair, risers: 15, tread: 3.5 / 14, length: 3.5, y: 1.0 };
    expect(runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'stair-best')).toBeUndefined();
    // ...and the approach stays exactly a metre — the minimum is met
    expect(runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'stair-approach')).toBeUndefined();
  });
});

describe('runRules — measured openings against movable partitions', () => {
  it('in the original layout every opening is in its own room', () => {
    const warnings = runRules(makeInitialProject(), CLEAR_HEIGHT);
    expect(warnings.filter((w) => w.id.startsWith('opening-room-'))).toHaveLength(0);
  });

  it('moving a partition past the fixed window is caught', () => {
    // The window 1400…2300 from the bottom left corner is fixed by measurement,
    // and the hall partition must run right after it (3200).
    const project = makeInitialProject();
    project.layout = { ...project.layout, hallY: 4.4 };
    const w = runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'opening-room-win-w-blind');
    expect(w).toBeDefined();
    expect(w.detail).toContain('Hall / boiler room');
  });
});

describe('Layout variants', () => {
  it.each(VARIANT_IDS)('variant %s assembles without slope errors', (variantId) => {
    const project = makeInitialProject(variantId);
    const warnings = runRules(project, CLEAR_HEIGHT);
    expect(warnings.filter((w) => w.id.startsWith('drain-') && w.severity === 'error')).toHaveLength(0);
  });

  it.each(VARIANT_IDS)('in variant %s fixtures do not overlap', (variantId) => {
    const warnings = runRules(makeInitialProject(variantId), CLEAR_HEIGHT);
    expect(warnings.filter((w) => w.id.startsWith('overlap-'))).toHaveLength(0);
  });

  it.each(VARIANT_IDS)('in variant %s fixtures do not stick out of the room', (variantId) => {
    const warnings = runRules(makeInitialProject(variantId), CLEAR_HEIGHT);
    expect(warnings.filter((w) => w.id.startsWith('bounds-'))).toHaveLength(0);
  });

  it('moving the bathroom to the left noticeably lengthens the toilet drain run', () => {
    const right = drainMargin(makeInitialProject('bathRight'), 'wc');
    const left = drainMargin(makeInitialProject('bathLeft'), 'wc');
    // The stack is measured at the top right corner: from the left the run goes across the whole house
    expect(left.routeLength).toBeGreaterThan(right.routeLength + 3);
    expect(left.marginMm).toBeLessThan(right.marginMm);
    expect(left.ok).toBe(true);
  });

  it('in the “bathroom on the left” variant a thicker screed breaks the toilet slope', () => {
    const project = makeInitialProject('bathLeft');
    project.screed = { ...project.screed, screedTotal: 130 };
    expect(drainMargin(project, 'wc').ok).toBe(false);

    const warnings = runRules(project, CLEAR_HEIGHT);
    expect(warnings.find((w) => w.id.startsWith('drain-') && w.severity === 'error')).toBeDefined();
  });

  it('in the “bathroom on the right” variant the same screed margin is safe', () => {
    const project = makeInitialProject('bathRight');
    project.screed = { ...project.screed, screedTotal: 130 };
    expect(drainMargin(project, 'wc').ok).toBe(true);
  });

  it('a sink in the corner by the stack gives a very short drain', () => {
    const left = drainMargin(makeInitialProject('bathLeft'), 'sink');
    expect(left.routeLength).toBeLessThan(1.0);
  });
});

describe('Kitchen under the stair (variant bathLeft)', () => {
  const project = makeInitialProject('bathLeft');
  const warnings = runRules(project, CLEAR_HEIGHT);

  it('base cabinets under the flight pass on height', () => {
    expect(warnings.filter((w) => w.id.startsWith('head-eq-wt'))).toHaveLength(0);
    expect(warnings.find((w) => w.id === 'head-eq-oven')).toBeUndefined();
  });

  it('a tall refrigerator would not fit under the flight', () => {
    const moved = makeInitialProject('bathLeft');
    moved.equipment = moved.equipment.map((e) =>
      e.catalogId === 'fridge' ? { ...e, x: 4.85, y: 2.0 } : e
    );
    const w = runRules(moved, CLEAR_HEIGHT).find((x) => x.id === 'head-eq-fridge');
    expect(w).toBeDefined();
  });

  it('a sink under the low flight gives an ergonomics hint, not a ban', () => {
    const moved = makeInitialProject('bathLeft');
    moved.equipment = moved.equipment.map((e) =>
      e.catalogId === 'sink' ? { ...e, x: 4.85, y: 2.4 } : e
    );
    const list = runRules(moved, CLEAR_HEIGHT);
    expect(list.find((x) => x.id === 'work-eq-sink')?.severity).toBe('info');
    expect(list.find((x) => x.id === 'head-eq-sink')).toBeUndefined();
  });
});

describe('runRules — sand fill of the sub-floor', () => {
  it('the default fill selection leaves the floor in place', () => {
    const project = makeInitialProject();
    const lv = floorLevels(project.levels, project.screed);
    expect(Math.abs(lv.floorDelta)).toBeLessThanOrEqual(5);
    expect(lv.floorToFloor).toBeCloseTo(3000, 0);
  });

  it('there is almost no fill — the EXISTING sand has to be compacted', () => {
    const project = makeInitialProject();
    const all = runRules(project, CLEAR_HEIGHT);
    const w = all.find((x) => x.id === 'fill-compaction');
    expect(w).toBeDefined();
    // The sub-floor turned out to be 390, not 900: an extra fill of 46 mm is one pass
    expect(w.title).toContain('1');

    // But a rule about the loose base appeared — it is now the main one
    const loose = all.find((x) => x.id === 'crawl-compaction');
    expect(loose).toBeDefined();
    expect(loose.severity).toBe('error');
  });

  it('a thicker build-up raises the floor and cuts the room height', () => {
    const project = makeInitialProject();
    project.screed = { ...project.screed, insulation: 300, gravel: 300 };
    const lv = floorLevels(project.levels, project.screed);
    expect(lv.floorDelta).toBeGreaterThan(300);
    expect(lv.clearHeight).toBeLessThan(project.levels.clearHeightNow);
    expect(lv.floorToFloor).toBeLessThan(3000);
  });

  it('the revision is computed from the content, not set by hand', () => {
    const a = makeInitialProject();
    const b = makeInitialProject();
    // The same project — the same revision
    expect(a.meta.revision).toBe(b.meta.revision);
    expect(a.meta.revision).toBeGreaterThan(0);
  });

  it('any change to the starting data gives a new revision', () => {
    const base = makeInitialProject();
    const { meta, ...content } = base;

    // Insulation thickness
    expect(contentRevision({ ...content, screed: { ...content.screed, insulation: 200 } }))
      .not.toBe(meta.revision);
    // Fill level
    expect(contentRevision({ ...content, levels: { ...content.levels, sandFill: 999 } }))
      .not.toBe(meta.revision);
    // A moved socket
    expect(contentRevision({
      ...content,
      equipment: content.equipment.map((e) => (e.id === 'el-tv' ? { ...e, x: 1 } : e))
    })).not.toBe(meta.revision);
    // Stair width
    expect(contentRevision({ ...content, stair: { ...content.stair, width: 1.1 } }))
      .not.toBe(meta.revision);
  });

  // The sink is linear now, but rotated fixtures remained in the kitchen:
  // the footprint check must count them by the actual outline, not
  // by the axis frame — otherwise an oven on the side branch gives a false overlap.
  it('a rotated oven gives no false overlaps', () => {
    const p = makeInitialProject();
    const oven = p.equipment.find((e) => e.id === 'eq-oven');
    expect(oven.rotation).toBe(90);
    const bad = runRules(p, CLEAR_HEIGHT).filter((w) => w.id.includes('eq-oven'));
    expect(bad).toHaveLength(0);
  });

  it('but a real overlap is still caught', () => {
    const p = makeInitialProject();
    p.equipment = p.equipment.map((e) =>
      e.id === 'eq-store1' ? { ...e, x: 2.9, y: 0.06 } : e
    );
    const bad = runRules(p, CLEAR_HEIGHT).filter((w) => w.id.startsWith('overlap-'));
    expect(bad.length).toBeGreaterThan(0);
  });

  it('wall cabinets do not take part in the floor checks', () => {
    const p = makeInitialProject();
    const walls = p.equipment.filter((e) => e.id.startsWith('eq-wall'));
    expect(walls.length).toBeGreaterThan(3);
    const bad = runRules(p, CLEAR_HEIGHT).filter((w) => w.id.includes('eq-wall'));
    expect(bad).toHaveLength(0);
  });

  it('edge insulation is provided — no error', () => {
    const p = makeInitialProject();
    // 100 mm: the same board as in the field. 80 mm is almost never found in retail
    expect(p.levels.edgeInsulation).toBe(100);
    expect(p.levels.edgeInsulationDepth).toBe(500);
    const w = runRules(p, CLEAR_HEIGHT).find((x) => x.id === 'edge-insulation');
    expect(w).toBeUndefined();
  });

  it('without edge insulation — an error, not a wish', () => {
    const p = makeInitialProject();
    p.levels = { ...p.levels, edgeInsulation: 0, edgeInsulationDepth: 0 };
    const w = runRules(p, CLEAR_HEIGHT).find((x) => x.id === 'edge-insulation');
    expect(w).toBeDefined();
    expect(w.severity).toBe('error');
    expect(w.fix).toContain('BEFORE the fill');
  });

  it('with edge insulation provided the error goes away', () => {
    const project = makeInitialProject();
    project.levels = { ...project.levels, edgeInsulation: 100, edgeInsulationDepth: 500, edgeTop: 0 };
    const w = runRules(project, CLEAR_HEIGHT);
    expect(w.find((x) => x.id === 'edge-insulation')).toBeUndefined();
    expect(w.find((x) => x.id === 'edge-top')).toBeUndefined();
    expect(w.find((x) => x.id === 'edge-depth')).toBeUndefined();
  });

  it('insulation “to the screed bottom” is caught as an error', () => {
    const project = makeInitialProject();
    // The top of the insulation at the screed bottom level: 12 finish + 70 screed
    project.levels = {
      ...project.levels,
      edgeInsulation: 80,
      edgeInsulationDepth: 500,
      edgeTop: project.screed.finishThickness + project.screed.screedTotal
    };
    const w = runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'edge-top');
    expect(w).toBeDefined();
    expect(w.severity).toBe('error');
    // Exactly 70 mm of screed with the pipe stay uncovered
    expect(w.detail).toContain('70');
  });

  it('too shallow an edge depth — a warning', () => {
    const project = makeInitialProject();
    project.levels = { ...project.levels, edgeInsulation: 80, edgeInsulationDepth: 150, edgeTop: 0 };
    const w = runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'edge-depth');
    expect(w).toBeDefined();
    expect(w.fix).toContain('400–600');
  });

  // The edge profile is STEPPED: 100 mm of board cannot be brought up to the finished floor,
  // it would take 100 mm of the room on each side, and the porcelain tile
  // would have to stop 100 mm from the wall. At the top the strip works.
  it('at screed height the gap is thin, not a 100 mm board', () => {
    const p = makeInitialProject();
    expect(p.levels.edgeStrip).toBe(10);
    expect(p.levels.edgeStrip).toBeLessThan(p.levels.edgeInsulation);
    expect(runRules(p, CLEAR_HEIGHT).find((x) => x.id === 'edge-strip')).toBeUndefined();
  });

  it('a screed edge without a strip is an error: both a bridge and expansion', () => {
    const p = makeInitialProject();
    p.levels = { ...p.levels, edgeStrip: 0 };
    const w = runRules(p, CLEAR_HEIGHT).find((x) => x.id === 'edge-strip');
    expect(w).toBeDefined();
    expect(w.severity).toBe('error');
  });

  it('the edge board is counted only below the screed', () => {
    const p = makeInitialProject();
    const band = p.screed.screedTotal + p.screed.finishThickness;
    const est = floorEstimate({
      layout: p.layout, screed: p.screed, levels: p.levels,
      loops: { totalPipe: 218, totalLoops: 4 }, coolant: p.coolant
    });
    const row = est.items.find((i) => i.name.includes('on the slab edge'));
    // 500 of depth minus 82 mm of screed with finish, not all 500
    expect(row.note).toContain(String(p.levels.edgeInsulationDepth - band));
  });
});

describe('runRules — reuse of the old XPS', () => {
  it('requires confirming the grade of the old boards', () => {
    const w = runRules(makeInitialProject(), CLEAR_HEIGHT).find((x) => x.id === 'reused-strength');
    expect(w).toBeDefined();
    expect(w.detail).toContain('250 kPa');
  });

  it('confirming the grade removes the warning', () => {
    const project = makeInitialProject();
    project.screed = { ...project.screed, reusedStrengthConfirmed: true };
    expect(runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'reused-strength')).toBeUndefined();
  });

  it('suggests the layer order: new at the bottom, old second', () => {
    const w = runRules(makeInitialProject(), CLEAR_HEIGHT).find((x) => x.id === 'reused-position');
    expect(w).toBeDefined();
    // 120 total − 25 old = 95 new
    expect(w.detail).toContain('100');
  });

  it('insulation made only of old boards is an error', () => {
    const project = makeInitialProject();
    project.screed = { ...project.screed, insulation: 25 };
    const w = runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'reused-only');
    expect(w).toBeDefined();
    expect(w.severity).toBe('error');
  });
});

describe('Choosing the insulation thickness', () => {
  it('thicker insulation — less downward flux and less sand', () => {
    const project = makeInitialProject();
    const opts = insulationOptions(project.screed, project.levels, 30.25, [75, 125]);
    const [thin, thick] = opts;
    expect(thick.watts).toBeLessThan(thin.watts);
    expect(thick.sandNeeded).toBeLessThan(thin.sandNeeded);
    // Every 50 mm of insulation is exactly 50 mm of sand that does not have to be compacted
    expect(thin.sandNeeded - thick.sandNeeded).toBeCloseTo(50, 6);
  });

  it('the difference between 75 and 125 mm is a few watts for the whole floor', () => {
    const project = makeInitialProject();
    const [thin, thick] = insulationOptions(project.screed, project.levels, 30.25, [75, 125]);
    expect(thin.watts - thick.watts).toBeLessThan(60);
    expect(thin.watts - thick.watts).toBeGreaterThan(10);
  });
});

describe('runRules — partitions', () => {
  it('moving the hall partition does not break the checks', () => {
    const project = makeInitialProject();
    project.layout = { ...project.layout, hallX: 2.4, hallY: 3.2 };
    expect(() => runRules(project, CLEAR_HEIGHT)).not.toThrow();
  });
});

describe('runRules — screed over the pipe', () => {
  it('a thin screed gives an error about the cover', () => {
    const project = makeInitialProject();
    project.screed = { ...project.screed, screedTotal: 55 };
    const warnings = runRules(project, CLEAR_HEIGHT);
    expect(ids(warnings)).toContain('screed-cover');
  });

  it('70 mm over a Ø16 pipe passes', () => {
    const project = makeInitialProject();
    const warnings = runRules(project, CLEAR_HEIGHT);
    expect(ids(warnings)).not.toContain('screed-cover');
  });
});

describe('runRules — ergonomics of the placement', () => {
  const w = runRules(makeInitialProject(), CLEAR_HEIGHT);

  // The dining group is moved away: work aisle 1000, the oven door is free
  it('in the accepted placement the aisle at the kitchen is fine', () => {
    expect(w.find((x) => x.id === 'kitchen-aisle')).toBeUndefined();
    const ok = w.find((x) => x.id === 'kitchen-aisle-ok');
    expect(ok.severity).toBe('info');
    expect(ok.title).toContain('1000');
  });

  it('the doors of built-in appliances hit nothing', () => {
    expect(w.filter((x) => x.id.startsWith('door-swing-'))).toHaveLength(0);
  });

  // There is NO overlap of objects — they are spaced apart, and the footprint check is silent.
  // But a person at the hob needs a metre, and that is a separate check.
  it('a bench pushed back is caught although there are no intersections', () => {
    const p = makeInitialProject();
    p.equipment = p.equipment.map((e) => (e.id === 'eq-bench-n' ? { ...e, y: 0.9 } : e));
    const r = runRules(p, CLEAR_HEIGHT).find((x) => x.id === 'kitchen-aisle');
    expect(r).toBeDefined();
    expect(r.severity).toBe('error');
    expect(r.title).toContain('300');
    expect(r.detail).toContain('There is NO overlap of objects');
    expect(r.fix).toContain('mouse');
  });

  it('and then the oven door stops opening', () => {
    const p = makeInitialProject();
    p.equipment = p.equipment.map((e) => {
      if (e.id === 'eq-bench-n') return { ...e, y: 0.9 };
      if (e.id === 'eq-oven') return { ...e, x: 0.94, y: 0.06, rotation: 0 };
      return e;
    });
    const r = runRules(p, CLEAR_HEIGHT).find((x) => x.id === 'door-swing-eq-oven');
    expect(r).toBeDefined();
    expect(r.detail).toContain('tray');
  });
});

describe('runRules — sink under the window', () => {
  const withSink = () => {
    const p = makeInitialProject();
    p.equipment = p.equipment.map((e) =>
      e.id === 'eq-sink'
        ? { ...e, catalogId: 'sink', rotation: 0, x: 1.26, y: 0.06, w: undefined, d: undefined }
        : e
    );
    return p;
  };

  it('the measured sill of 960 made it into the model', () => {
    const win = makeInitialProject().openings.find((o) => o.id === 'win-n1');
    expect(win.sill).toBe(0.96);
  });

  it('a sink at 1260 stands at the centre of the FIXED sash, not of the window', () => {
    const p = withSink();
    const win = p.openings.find((o) => o.id === 'win-n1');
    const sink = p.equipment.find((e) => e.id === 'eq-sink');
    const blindCentre = win.start + win.len / 4;
    expect(Math.abs(sink.x + 0.3 - blindCentre)).toBeLessThan(0.25);
    expect(sink.x + 0.3).toBeLessThan(win.start + win.len / 2);
  });

  it('the sashes are described: the left one fixed, the right one tilt-and-turn', () => {
    const win = makeInitialProject().openings.find((o) => o.id === 'win-n1');
    expect(win.sashes).toBe(2);
    expect(win.openingSash).toBe('right');
  });

  // What decides is not the sill height itself but which sash is above the tap.
  // Under the fixed half there is nothing to knock the mixer off — a folding one is not needed.
  it('a tap under the fixed half is a note, not a problem', () => {
    const r = runRules(withSink(), CLEAR_HEIGHT).find((x) => x.id === 'sink-under-window');
    expect(r).toBeDefined();
    expect(r.severity).toBe('info');
    expect(r.detail).toContain('A folding one is not needed');
    expect(r.title).toContain('60');
  });

  it('a sink that moved under the opening sash — a warning', () => {
    const p = makeInitialProject();
    p.equipment = p.equipment.map((e) =>
      e.id === 'eq-sink'
        ? { ...e, catalogId: 'sink', rotation: 0, x: 1.7, y: 0.06, w: undefined, d: undefined }
        : e
    );
    const r = runRules(p, CLEAR_HEIGHT).find((x) => x.id === 'sink-under-window');
    expect(r.severity).toBe('warn');
    expect(r.title).toContain('knock it off');
    expect(r.fix).toContain('fixed');
  });

  it('in the accepted placement the sink is already under the window and under the fixed sash', () => {
    const r = runRules(makeInitialProject(), CLEAR_HEIGHT)
      .find((x) => x.id === 'sink-under-window');
    expect(r).toBeDefined();
    expect(r.severity).toBe('info');
  });
});
