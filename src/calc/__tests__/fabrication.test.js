import { describe, expect, it } from 'vitest';

import {
  STAIR_FAB,
  WORKTOP_FAB,
  backSupportOptions,
  slabThicknessOptions,
  stairFabrication,
  worktopFabrication
} from '../fabrication.js';
import { makeInitialProject } from '../../data/project.js';
import { buildWorktop } from '../../data/worktop.js';

const p = makeInitialProject();
const s = stairFabrication(p.stair);
const w = buildWorktop(p.layout, p.equipment);
const f = worktopFabrication(w, p.screed);

describe('stair: flight', () => {
  it('riser 200, tread 243, angle 39.5°', () => {
    expect(s.rise).toBeCloseTo(200, 6);
    expect(s.going).toBeCloseTo(242.857, 2);
    expect(s.angleDeg).toBeCloseTo(39.5, 1);
  });

  it('there is one step fewer than risers', () => {
    expect(s.treads).toBe(p.stair.risers - 1);
  });

  it('the rise along the nosing line is less than the full one — the last riser leads onto the landing', () => {
    expect(s.nosingRise).toBe(2800);
    expect(s.nosingRise).toBeLessThan(p.stair.totalRise * 1000);
  });
});

describe('stair: gussets', () => {
  // The key idea of the drawing: a straight tube under a stepped surface
  // LEAVES triangular voids, and the legs of those triangles are
  // exactly the tread and the riser. They are not invented, they follow from the flight.
  it('the triangle legs equal the tread and the riser', () => {
    expect(s.gusset.base).toBeCloseTo(s.going, 6);
    expect(s.gusset.height).toBeCloseTo(s.rise, 6);
  });

  it('the hypotenuse lies on the tube face', () => {
    expect(s.gusset.hyp).toBeCloseTo(Math.hypot(s.going, s.rise), 6);
    // hypotenuse angle = flight angle
    expect((Math.atan(s.gusset.height / s.gusset.base) * 180) / Math.PI).toBeCloseTo(s.angleDeg, 6);
  });

  it('one gusset per step per stringer', () => {
    expect(s.gusset.count).toBe(s.treads * STAIR_FAB.stringerCount);
    expect(s.gusset.count).toBe(28);
  });

  it('the sheet is cut to less than a square metre', () => {
    expect(s.gusset.areaM2).toBeGreaterThan(0.6);
    expect(s.gusset.areaM2).toBeLessThan(0.8);
  });
});

describe('stair: stringer', () => {
  it('the top face of the tube is lowered by the tread plus the angle ledge', () => {
    expect(s.faceDrop).toBe(STAIR_FAB.treadT + STAIR_FAB.platform.t);
  });

  it('the heel is set back from the start of the flight — otherwise the tube would go into the floor', () => {
    expect(s.footX).toBeGreaterThan(200);
    expect(s.footX).toBeLessThan(300);
  });

  it('the cut is longer than the projection and shorter than a 6 m bar', () => {
    expect(s.stringers.cutLen).toBeGreaterThan(s.run);
    expect(s.stringers.cutLen).toBeLessThan(6000);
    expect(s.stockBars).toBe(2);
  });

  it('the step overhang beyond the stringer is the same on both sides', () => {
    expect(s.overhang).toBe((STAIR_FAB.treadWidth - STAIR_FAB.gauge) / 2);
    expect(s.overhang).toBe(150);
  });
});

describe('worktop: frame', () => {
  it('slab underside at 860, the post is longer by the tile thickness', () => {
    // A 40 mm slab: 900 − 40 = 860. The embed is recessed flush with the screed,
    // the tile goes on top — the post is longer by exactly its thickness.
    expect(f.underside).toBe(860);
    expect(f.embedLevel).toBe(-p.screed.finishThickness);
    expect(f.postLen).toBe(860 + p.screed.finishThickness);
  });

  it('the rear edge is on posts too — from a single line the slab would cantilever', () => {
    expect(f.backPosts).toBeGreaterThan(0);
    expect(f.posts).toBe(f.frontPosts + f.backPosts);
    expect(f.embed.count).toBe(f.posts);
  });

  // At the back a post gets in nobody’s way, but there is no point in setting them often:
  // what must be calculated is the deflection of the ASSEMBLY of angle and slab, not of the bare angle
  it('there are fewer posts at the back and the pitch is twice as sparse as at the front', () => {
    expect(f.backPitch).toBe(f.framePitch * 2);
    expect(f.backPosts).toBeLessThan(f.frontPosts);
  });

  it('at the sparse pitch the concrete carries, not the angle', () => {
    const opts = backSupportOptions(w, p.screed);
    const sparse = opts.options.find((o) => o.id === 'sparse');
    expect(sparse.ok).toBe(true);
    // a bare angle would deflect noticeably, together with the slab — not
    expect(sparse.deflAngleMm).toBeGreaterThan(1);
    expect(sparse.deflCombinedMm).toBeLessThan(0.3);
  });

  it('the wall angle holds on aerated concrete but not on plasterboard', () => {
    const opts = backSupportOptions(w, p.screed);
    const led = opts.options.find((o) => o.id === 'ledger');
    expect(led.ledger.ok).toBe(true);
    expect(led.ledger.safety).toBeGreaterThan(3);
    // along the bathroom partition the posts stay in any case
    expect(led.posts).toBeGreaterThan(0);
    expect(led.ledger.sideBranchM).toBeGreaterThan(1);
  });

  it('a 600 pitch at the back passes with margin, but it is overspending', () => {
    const opts = backSupportOptions(w, p.screed);
    const dense = opts.options.find((o) => o.id === 'dense');
    expect(dense.ok).toBe(true);
    expect(dense.posts).toBeGreaterThan(
      opts.options.find((o) => o.id === 'sparse').posts
    );
  });

  it('the frames are enough for the whole front at a 600 pitch', () => {
    expect((f.frames - 1) * WORKTOP_FAB.framePitch).toBeGreaterThanOrEqual(w.runM * 1000 - 600);
    expect(f.frames).toBe(8);
  });

  it('the cross member is shorter than the depth by the edge insets', () => {
    expect(f.crossLen).toBe(w.depth * 1000 - 2 * WORKTOP_FAB.edgeInset);
  });

  it('the posts eat more metal than the frame itself', () => {
    expect(f.postM).toBeGreaterThan(f.crossM);
    expect(f.angleTotalM).toBeCloseTo(f.longitudinalM + f.crossM + f.postM, 6);
  });

  it('the load per post is small — a few kilograms', () => {
    expect(f.loadPerPostKg).toBeLessThan(40);
  });

  it('without a worktop the module stays silent instead of crashing', () => {
    expect(worktopFabrication(null, p.screed)).toBeNull();
  });
});

describe('embeds for the worktop', () => {
  const embeds = p.nodes.filter((n) => n.type === 'embed');

  it('there are enough for all posts', () => {
    expect(embeds.length).toBeGreaterThanOrEqual(f.posts);
  });

  it('there are both a front line and a rear one at the wall', () => {
    const back = embeds.filter((e) => e.y < 0.2);
    const front = embeds.filter((e) => e.y >= 0.2 && e.y < 0.6);
    expect(back.length).toBeGreaterThanOrEqual(6);
    expect(front.length).toBeGreaterThanOrEqual(6);
  });

  it('the rear line starts at the right face of the refrigerator', () => {
    const first = p.nodes.find((n) => n.id === 'emb-b1');
    expect(first.x).toBeCloseTo(0.66, 6);
  });
});


describe('stair: top connection', () => {
  const t = s.topNode;

  it('the stringer ends EXACTLY at the edge of the opening', () => {
    // the last step is the attic floor itself, there is nowhere to take the tube further:
    // under the slab it rests on nothing
    expect(STAIR_FAB.topAllowance).toBe(0);
    expect(s.stringers.cutLen).toBeLessThan(s.run / Math.cos((s.angleDeg * Math.PI) / 180) + 20);
  });

  it('the top of the tube is below the finished floor by exactly the last riser with the tread', () => {
    expect(t.dropUnderFloor).toBeCloseTo(200 + 43 + 5, 6);
    expect(t.faceTop).toBeCloseTo(2752, 0);
  });

  it('the stringer cannot be fixed end-on to the joist — it arrives below it', () => {
    expect(t.directToJoist).toBe(false);
    expect(t.joistBottom).toBeGreaterThan(t.faceTop);
  });

  it('the gap is closed by a bracket from the bottom of the tube to the top of the joist', () => {
    expect(t.bracketH).toBeGreaterThan(300);
    expect(t.bracketH).toBeLessThan(400);
    expect(t.boltSize).toBe('M12');
  });

  it('the joist height is honestly marked as not measured', () => {
    expect(t.joistConfirmed).toBe(false);
  });
});

describe('worktop slab thickness', () => {
  const opts = slabThicknessOptions({ worktop: w });
  const at = (t) => opts.find((o) => o.t === t);

  it('the slab field decides nothing — it passes at any thickness', () => {
    opts.forEach((o) => expect(o.fieldOk).toBe(true));
  });

  // This is why 60 is usually made: a 75 mm strip between the sink cut-out
  // and the edge, if there is nothing under it, breaks at the first lean.
  it('a free bridge at the cut-out passes only at 60', () => {
    expect(at(40).stripOkFree).toBe(false);
    expect(at(60).stripOkFree).toBe(true);
  });

  it('but ours has the longitudinal angle UNDER the bridge — there is no span', () => {
    opts.forEach((o) => expect(o.stripOkFramed).toBe(true));
    expect(at(40).stripFramedMPa).toBeLessThan(at(40).stripFreeMPa / 50);
  });

  it('30 mm is out: nothing is left for the reinforcement', () => {
    expect(at(30).barMm).toBeLessThanOrEqual(0);
    expect(at(30).barOk).toBe(false);
  });

  it('at 40 mm 10 is left for the mesh — Ø4 fits, Ø6 does not', () => {
    expect(at(40).barMm).toBe(10);
    expect(at(40).barOk).toBe(true);
  });

  it('40 mm lets the dishwasher under the worktop, 60 does not', () => {
    expect(at(40).underMm).toBe(860);
    expect(at(40).applianceFits).toBe(true);
    expect(at(60).underMm).toBe(840);
    expect(at(60).applianceFits).toBe(false);
  });

  it('the accepted thickness is 40, and it removes the conflict with the dishwasher', () => {
    expect(w.thickness).toBe(0.04);
    expect(w.beneath.every((b) => b.fits)).toBe(true);
  });

  it('the slab got lighter from 366 to 244 kg', () => {
    expect(at(60).massKg).toBeCloseTo(366, 0);
    expect(at(40).massKg).toBeCloseTo(244, 0);
  });
});
