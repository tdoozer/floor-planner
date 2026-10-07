import { describe, expect, it } from 'vitest';

import {
  DRAIN_SLOPE,
  drainFit,
  drainRoute,
  pointInPolygon,
  polygonArea,
  screedStackup,
  STAIR_NORMS,
  stairCheck,
  stairEnvelope,
  stairHeadroom,
  stairOptions
} from '../geometry.js';
import {
  BATH_SIZE,
  DEFAULT_LAYOUT,
  INNER_D,
  INNER_W,
  SCREED,
  STAIR,
  buildRooms
} from '../../data/project.js';

describe('buildRooms — the layout is derived from four numbers', () => {
  const rooms = buildRooms(DEFAULT_LAYOUT);
  const byId = (id) => rooms.find((r) => r.id === id);

  it('three rooms add up to 30.25 m² clear', () => {
    const total = rooms.reduce((s, r) => s + polygonArea(r.polygon), 0);
    expect(total).toBeCloseTo(INNER_W * INNER_D, 5);
  });

  it('the bathroom in the top right corner', () => {
    const bath = byId('bath');
    expect(polygonArea(bath.polygon)).toBeCloseTo(
      (INNER_W - DEFAULT_LAYOUT.bathX) * DEFAULT_LAYOUT.bathY, 5
    );
    expect(pointInPolygon(bath.polygon, 5.0, 1.0)).toBe(true);
  });

  it('the hall / boiler room in the bottom left corner', () => {
    const hall = byId('hall');
    expect(pointInPolygon(hall.polygon, 0.5, 5.0)).toBe(true);
    expect(pointInPolygon(hall.polygon, 5.0, 1.0)).toBe(false);
  });

  it('the living room is L-shaped: it goes under the bathroom at the bottom right and to the right of the hall', () => {
    const living = byId('living');
    expect(pointInPolygon(living.polygon, 5.0, 4.0)).toBe(true); // bottom right
    expect(pointInPolygon(living.polygon, 1.0, 1.0)).toBe(true); // top left
    expect(pointInPolygon(living.polygon, 0.5, 5.0)).toBe(false); // that is the hall
    expect(pointInPolygon(living.polygon, 5.0, 1.0)).toBe(false); // that is the bathroom
  });

  it('moving a partition redistributes the areas, the sum is constant', () => {
    const wider = buildRooms({ ...DEFAULT_LAYOUT, hallX: 2.4 });
    const total = wider.reduce((s, r) => s + polygonArea(r.polygon), 0);
    expect(total).toBeCloseTo(INNER_W * INNER_D, 5);

    const hallBefore = polygonArea(byId('hall').polygon);
    const hallAfter = polygonArea(wider.find((r) => r.id === 'hall').polygon);
    expect(hallAfter).toBeGreaterThan(hallBefore);
  });
});

describe('polygonArea', () => {
  it('computes the area of a rectangle', () => {
    const poly = [{ x: 0, y: 0 }, { x: 3.9, y: 0 }, { x: 3.9, y: 5.5 }, { x: 0, y: 5.5 }];
    expect(polygonArea(poly)).toBeCloseTo(21.45, 5);
  });
});

describe('drainRoute', () => {
  it('a Manhattan route equals the sum of the legs', () => {
    const r = drainRoute({ x: 1, y: 3 }, { x: 4, y: 1 });
    expect(r.length).toBeCloseTo(2 + 3, 6);
    expect(r.points).toHaveLength(3);
  });
});

describe('drainFit — the most important check before the pour', () => {
  const screed = { ...SCREED };

  it('a short toilet run fits in the build-up', () => {
    const fit = drainFit({ routeLength: 1.0, dia: 110, riserInvertM: -0.35, screed });
    // Invert: -350 + 1.0 × 20 = -330 mm; pipe crown -330 + 110 = -220 mm
    expect(fit.invertMm).toBeCloseTo(-330, 6);
    expect(fit.crownMm).toBeCloseTo(-220, 6);
    // Screed bottom: -(12 + 70) = -82 mm → the pipe is below, it fits
    expect(fit.underScreedMm).toBe(-82);
    expect(fit.ok).toBe(true);
  });

  it('a long Ø110 run stops fitting', () => {
    // 12 m × 2 cm/m = 240 mm of rise: -350 + 240 = -110, the pipe crown exactly 0.
    const fit = drainFit({ routeLength: 12, dia: 110, riserInvertM: -0.35, screed });
    expect(fit.crownMm).toBeCloseTo(0, 6);
    expect(fit.ok).toBe(false);
    expect(fit.marginMm).toBeLessThan(0);
  });

  it('slope is exactly 2 cm per metre', () => {
    const a = drainFit({ routeLength: 0, dia: 50, riserInvertM: -0.3, screed });
    const b = drainFit({ routeLength: 1, dia: 50, riserInvertM: -0.3, screed });
    expect(b.invertMm - a.invertMm).toBeCloseTo(DRAIN_SLOPE * 1000, 6);
  });
});

describe('screedStackup', () => {
  it('sums the layers of the floor build-up on the ground', () => {
    const s = screedStackup(SCREED);
    expect(s.total).toBe(
      SCREED.gravel + SCREED.sandBed + SCREED.waterproofing
      + SCREED.insulation + SCREED.screedTotal + SCREED.finishThickness
    );
    // The sand bed protects the membrane from the sharp edges of the crushed stone
    expect(s.layers.some((l) => l.id === 'sandBed')).toBe(true);
    expect(s.layers[0].top).toBe(0);
  });
});

describe('stairHeadroom — headroom under the flight', () => {
  it('there is almost no height at the bottom step', () => {
    const h = stairHeadroom(STAIR, STAIR.x + 0.5, STAIR.y + STAIR.length - 0.05, 2.7);
    expect(h).toBeLessThan(0.1);
  });

  it('at the upper end the height is close to full', () => {
    const h = stairHeadroom(STAIR, STAIR.x + 0.5, STAIR.y + 0.05, 2.7);
    expect(h).toBeGreaterThan(2.0);
  });

  it('grows monotonically towards the rise', () => {
    const near = stairHeadroom(STAIR, STAIR.x + 0.5, 3.5, 2.7);
    const far = stairHeadroom(STAIR, STAIR.x + 0.5, 1.0, 2.7);
    expect(far).toBeGreaterThan(near);
  });

  it('outside the stair footprint returns null', () => {
    expect(stairHeadroom(STAIR, 1.0, 1.0, 2.7)).toBeNull();
  });
});

describe('stairCheck — the measured existing flight and the proposed one', () => {
  it('measurements agree: approach 1100 + projection 2600 → opening edge 1800', () => {
    expect(STAIR.existingBottomY).toBeCloseTo(INNER_D - 1.1, 6);
    expect(STAIR.existingRun).toBeCloseTo(2.6, 6);
    expect(STAIR.existingBottomY - STAIR.existingRun).toBeCloseTo(STAIR.existingOpeningTopY, 6);
    // 1800 is exactly the bathroom face 1800 × 1800: the flight meets the slab
    // right where the bathroom begins
    expect(STAIR.existingOpeningTopY).toBeCloseTo(BATH_SIZE, 6);
  });

  it('the existing flight is steep precisely because of the short projection', () => {
    // 2600 over 17 risers → tread 162 mm, hence the 46°
    expect(STAIR.existingRun / (STAIR.existingRisers - 1)).toBeCloseTo(0.1625, 4);
    const sc = stairCheck({ ...STAIR, length: STAIR.existingRun, risers: STAIR.existingRisers });
    expect(sc.fits).toBe(false);
  });

  it('the proposed flight fits in the allotted length', () => {
    const sc = stairCheck(STAIR);
    expect(sc.risePerStep).toBeCloseTo(STAIR.totalRise / STAIR.risers, 6);
    expect(sc.fits).toBe(true);
  });

  it('step width grew from 700 to 800', () => {
    expect(STAIR.existingWidth).toBeCloseTo(0.7, 6);
    expect(STAIR.width).toBeCloseTo(0.8, 6);
  });

  it('the flight is fixed in place and does not move', () => {
    // The position is set by the approach below and the landing above, 1 m each
    expect(STAIR.locked).toBe(true);
    expect(STAIR.x).toBeCloseTo(4.7, 6);
  });

  it('computes the slope angle from the riser and the tread', () => {
    const sc = stairCheck(STAIR);
    expect(sc.angleDeg).toBeCloseTo((Math.atan(sc.risePerStep / sc.tread) * 180) / Math.PI, 6);
    // 2900 mm of rise over 3400 mm of projection — a steep flight
    expect(sc.angleDeg).toBeGreaterThan(STAIR_NORMS.maxAngleDeg - 2);
  });

  it('the accepted flight 15 × 200 × 243 passes BOTH formulas', () => {
    const sc = stairCheck(STAIR);
    expect(sc.risePerStep).toBeCloseTo(0.2, 3);
    expect(sc.tread).toBeCloseTo(3.4 / 14, 5);
    expect(sc.blondel).toBeCloseTo(2 * sc.risePerStep + sc.tread, 6);
    expect(sc.comfort).toBeCloseTo(sc.risePerStep + sc.tread, 6);
    // 2h + s = 643 at a limit of 650; h + s = 443 at 450
    expect(sc.blondelOk).toBe(true);
    expect(sc.comfortOk).toBe(true);
  });

  it('the formulas are met on the reference flight 170 × 290', () => {
    const sc = stairCheck({ ...STAIR, totalRise: 2.89, risers: 17, tread: 0.29 });
    expect(sc.blondelOk).toBe(true); // 2×170 + 290 = 630
    expect(sc.comfortOk).toBe(true); // 170 + 290 = 460 ≈ 450
    expect(sc.angleOk).toBe(true);
    // ...but such a flight needs a projection of 4.64 m, and there is none here
    expect(sc.fits).toBe(false);
  });

  it('the proposed flight keeps a metre below and above', () => {
    expect(INNER_D - (STAIR.y + STAIR.length)).toBeGreaterThanOrEqual(STAIR.minApproach);
    expect(STAIR.y).toBeGreaterThanOrEqual(STAIR.minLanding);
  });
});

describe('stairOptions — flight selection', () => {
  it('an approach and a landing of a metre leave 3.5 m for the flight', () => {
    expect(stairOptions(STAIR, INNER_D).maxRun).toBeCloseTo(3.5, 6);
  });

  it('with 15 risers a comfortable tread is achievable', () => {
    const env = stairEnvelope(STAIR, INNER_D);
    expect(env.maxTread).toBeGreaterThan(0.23);
    expect(env.comfortReachable).toBe(true);
  });

  it('and with the former 17 it was unachievable', () => {
    const env = stairEnvelope({ ...STAIR, risers: 17 }, INNER_D);
    expect(env.maxTread).toBeLessThan(0.23);
    expect(env.comfortReachable).toBe(false);
  });

  it('finds an option that passes all five criteria', () => {
    const { best } = stairOptions(STAIR, INNER_D);
    expect(best.allOk).toBe(true);
    expect(best.passed).toBe(5);
    // 3000 mm of rise in 15 risers: 200 × 250, angle 38.7°
    expect(best.risers).toBe(15);
    expect(best.risePerStep * 1000).toBeCloseTo(200, 1);
    expect(best.tread * 1000).toBeCloseTo(250, 1);
  });

  it('at 3000 mm of rise the best option runs into the limits of the norms', () => {
    const { best } = stairOptions(STAIR, INNER_D);
    // Riser exactly 200 and 2h + s exactly 650 — no margin
    expect(best.riseTight).toBe(true);
    expect(best.blondelTight).toBe(true);
  });

  it('raising the floor by 100 mm moves the stair away from the limits', () => {
    // The floor level is set by the fill, so this is a real lever
    const { best } = stairOptions({ ...STAIR, totalRise: 2.9 }, INNER_D);
    expect(best.allOk).toBe(true);
    expect(best.risers).toBe(15);
    expect(best.risePerStep * 1000).toBeCloseTo(193.3, 1);
    expect(best.riseTight).toBe(false);
    expect(best.blondelTight).toBe(false);
  });

  it('the best option satisfies both formulas', () => {
    const { best } = stairOptions(STAIR, INNER_D);
    expect(best.blondel * 1000).toBeGreaterThanOrEqual(600);
    expect(best.blondel * 1000).toBeLessThanOrEqual(650);
    expect(Math.abs(best.comfort - 0.45)).toBeLessThanOrEqual(0.02);
    expect(best.angleDeg).toBeLessThanOrEqual(40);
  });

  it('the accepted flight is no worse than the best of the selection', () => {
    const { best } = stairOptions(STAIR, INNER_D);
    const sc = stairCheck(STAIR);
    const now = [sc.riseOk, sc.treadOk, sc.blondelOk, sc.comfortOk, sc.angleOk].filter(Boolean).length;
    expect(now).toBeGreaterThanOrEqual(best.passed);
  });
});
