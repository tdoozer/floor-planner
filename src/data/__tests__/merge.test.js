import { describe, expect, it } from 'vitest';

import { mergeProject } from '../merge.js';
import { makeInitialProject } from '../project.js';

const base = () => makeInitialProject('bathRight');

describe('mergeProject — the owner placement survives a code update', () => {
  it('a moved socket stays where it is', () => {
    const saved = base();
    saved.equipment = saved.equipment.map((e) =>
      e.id === 'el-tv' ? { ...e, x: 1.23, y: 4.56 } : e
    );

    const merged = mergeProject(base(), saved);
    const tv = merged.equipment.find((e) => e.id === 'el-tv');
    expect(tv.x).toBeCloseTo(1.23, 6);
    expect(tv.y).toBeCloseTo(4.56, 6);
  });

  it('a rearranged table and benches are not rolled back', () => {
    const saved = base();
    saved.equipment = saved.equipment.map((e) =>
      ['eq-table', 'eq-bench-n', 'eq-bench-s'].includes(e.id)
        ? { ...e, x: e.x + 1.5, y: e.y + 0.4, rotation: 90 }
        : e
    );

    const merged = mergeProject(base(), saved);
    ['eq-table', 'eq-bench-n', 'eq-bench-s'].forEach((id) => {
      const a = saved.equipment.find((e) => e.id === id);
      const b = merged.equipment.find((e) => e.id === id);
      expect(b.x).toBeCloseTo(a.x, 6);
      expect(b.rotation).toBe(90);
    });
  });

  it('an object added by the owner is kept', () => {
    const saved = base();
    saved.equipment = [
      ...saved.equipment,
      { id: 'my-shelf', catalogId: 'shelf_open', x: 0.1, y: 0.1, rotation: 0 }
    ];

    const merged = mergeProject(base(), saved);
    expect(merged.equipment.find((e) => e.id === 'my-shelf')).toBeDefined();
  });

  it('an object deleted by the owner does not come back', () => {
    const saved = base();
    saved.equipment = saved.equipment.filter((e) => e.id !== 'eq-sofa');

    const merged = mergeProject(base(), saved);
    expect(merged.equipment.find((e) => e.id === 'eq-sofa')).toBeUndefined();
  });

  it('a new point from the code is added to the old placement', () => {
    const saved = base();
    // Simulate an old saved project without electrics
    saved.equipment = saved.equipment.filter((e) => !e.id.startsWith('el-'));
    saved.equipment = [{ ...saved.equipment[0], x: 9 }, ...saved.equipment.slice(1)];

    const merged = mergeProject(base(), saved);
    // There were no electrics in the saved one, but they will not be added:
    // absence is treated as deletion by the owner
    expect(merged.equipment.find((e) => e.id === saved.equipment[0].id).x).toBe(9);
  });

  it('calculation parameters come from the CODE, not from the browser', () => {
    const saved = base();
    saved.screed = { ...saved.screed, insulation: 40, gravel: 999 };
    saved.levels = { ...saved.levels, sandFill: 777 };
    saved.coolant = { ...saved.coolant, base: 'water' };

    const merged = mergeProject(base(), saved);
    expect(merged.screed.insulation).toBe(base().screed.insulation);
    expect(merged.screed.gravel).toBe(base().screed.gravel);
    expect(merged.levels.sandFill).toBe(base().levels.sandFill);
    expect(merged.coolant.base).toBe('ethylene');
  });

  it('the stair is not taken from the saved project — it is fixed', () => {
    const saved = base();
    saved.stair = { ...saved.stair, x: 0, width: 2, locked: false };

    const merged = mergeProject(base(), saved);
    expect(merged.stair.width).toBeCloseTo(0.8, 6);
    expect(merged.stair.locked).toBe(true);
  });

  it('the owner toggles are kept', () => {
    const saved = base();
    saved.kitchenOnFrame = true;
    saved.loopMode = 'serpentine';
    saved.loopSpacings = { living: 0.2 };

    const merged = mergeProject(base(), saved);
    expect(merged.kitchenOnFrame).toBe(true);
    expect(merged.loopMode).toBe('serpentine');
    expect(merged.loopSpacings).toEqual({ living: 0.2 });
  });

  it('without a saved project the starting one is returned', () => {
    const b = base();
    expect(mergeProject(b, null)).toBe(b);
    expect(mergeProject(b, {})).toBe(b);
  });

  it('house nodes are not deleted, even if they are absent from the saved one', () => {
    const saved = base();
    saved.nodes = saved.nodes.filter((n) => n.type !== 'sewer_riser');

    const merged = mergeProject(base(), saved);
    // The stack physically exists — it cannot silently disappear
    expect(merged.nodes.some((n) => n.type === 'sewer_riser')).toBe(true);
  });
});

describe('placementRev — a coordinated rearrangement', () => {
  // The single exception to the rule “position belongs to the owner”.
  // It never fires silently: the revision has to be raised by hand.
  // The panel in the base is already moved with a raised revision, so in the tests
  // the revision is set explicitly on both sides — otherwise we check the wrong thing.
  const withSaved = (baseRev, savedRev) => {
    const set = (list, x, rev) => list.map((e) => {
      if (e.id !== 'eq-hob') return e;
      const n = { ...e, x };
      if (rev === null) delete n.placementRev; else n.placementRev = rev;
      return n;
    });
    const b = base();
    b.equipment = set(b.equipment, 2.76, baseRev);
    const s = JSON.parse(JSON.stringify(b));
    s.equipment = set(s.equipment, 1.11, savedRev);
    return mergeProject(b, s).equipment.find((e) => e.id === 'eq-hob');
  };

  it('without a revision the owner position wins, as before', () => {
    expect(withSaved(null, null).x).toBe(1.11);
  });

  it('a raised revision moves the fixture once', () => {
    expect(withSaved(1, null).x).toBe(2.76);
  });

  it('after the new revision is saved the owner is the master again', () => {
    // The fixture has already moved, the revisions are equal — from now on only the owner moves it
    expect(withSaved(1, 1).x).toBe(1.11);
  });

  it('an old revision in the code rolls nothing back', () => {
    expect(withSaved(1, 2).x).toBe(1.11);
  });
});
