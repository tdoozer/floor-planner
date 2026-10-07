import { describe, expect, it } from 'vitest';
import { LV, LV_LINKS, lowVoltagePlan, lvRoute } from '../lowVoltage.js';
import { IN_FLOOR } from '../electrical.js';
import { makeInitialProject, CLEAR_HEIGHT } from '../../data/project.js';
import { boundingBox } from '../../data/fixtures.js';
import { runRules } from '../rules.js';

describe('lvRoute — route along the slab', () => {
  it('is counted orthogonally: rise, along, across, drop', () => {
    const r = lvRoute({
      from: { x: 0, y: 0 },
      to: { x: 3, y: 4 },
      height: 2.7,
      dropTo: 0.3
    });
    expect(r.rise).toBeCloseTo(2.7 - LV.routerHeight, 6);
    expect(r.alongX).toBeCloseTo(3, 6);
    expect(r.alongY).toBeCloseTo(4, 6);
    expect(r.drop).toBeCloseTo(2.4, 6);
    // There are no diagonals along joists — a sum of segments, not a hypotenuse
    expect(r.runM).toBeCloseTo(r.rise + 7 + r.drop, 6);
    expect(r.runM).toBeGreaterThan(Math.hypot(3, 4));
  });

  it('more cable than route is needed: trimming and termination at both ends', () => {
    const r = lvRoute({ from: { x: 0, y: 0 }, to: { x: 1, y: 1 } });
    expect(r.cableM).toBeCloseTo(r.runM * LV.waste + LV.termination, 6);
    expect(r.cableM).toBeGreaterThan(r.runM);
  });
});

describe('lowVoltagePlan — composition', () => {
  const plan = lowVoltagePlan();

  it('four working links plus a spare', () => {
    expect(plan.utpLinks).toBe(4);
    expect(plan.reserveLinks).toBe(1);
    expect(plan.routes).toHaveLength(LV_LINKS.length);
  });

  it('the set-top box is pulled to the TV, not placed by the router', () => {
    const box = plan.routes.find((r) => r.id === 'tv-box');
    // The set-top box connects to the router by twisted pair, so it must hang
    // where the TV is — otherwise HDMI will not reach
    expect(box.to.x).toBeGreaterThan(4);
    expect(box.cableM).toBeGreaterThan(10);
  });

  it('conduit is counted by unique routes, not by cables', () => {
    // Two pairs to the TV go in ONE conduit and are not counted a second time
    const tv = plan.routes.filter((r) => r.to.x === 4.4 && r.to.y === 2.36);
    expect(tv).toHaveLength(2);
    expect(plan.conduitM).toBeLessThan(plan.utpM);
  });

  it('the spare conduit uses no cable', () => {
    const reserve = plan.routes.find((r) => r.kind === 'reserve');
    expect(reserve.kind).toBe('reserve');
    const utpSum = plan.routes
      .filter((r) => r.kind === 'utp')
      .reduce((s, r) => s + r.cableM, 0);
    expect(plan.utpM).toBeCloseTo(utpSum, 9);
  });

  it('the attic access point is provisioned while the slab is open', () => {
    // Between the router in the corner of the ground floor and the bedrooms — the slab
    // and the future insulation. The cable can ONLY be pulled NOW.
    const ap = plan.routes.find((r) => r.id === 'mansard-ap');
    expect(ap).toBeTruthy();
    expect(ap.dropTo).toBeGreaterThan(2);
  });

  it('the route is tied to the fibre entry point, not to the board', () => {
    // The fibre enters together with the gas, under the hall ceiling
    expect(plan.router).toBe(LV.entry);
    expect(plan.router.height).toBeGreaterThan(CLEAR_HEIGHT - 0.5);
  });
});

describe('low-voltage and the screed', () => {
  it('does not go into the screed at all', () => {
    // Low-voltage standards change faster than concrete lives
    expect(IN_FLOOR.has('data')).toBe(false);
  });

  it('the router stands farther than the norm from the gas inlet', () => {
    const p = makeInitialProject();
    const router = p.equipment.find((e) => e.catalogId === 'ont_router');
    const gas = p.nodes.find((n) => n.id === 'gas-boiler');
    const rb = boundingBox(router);
    const gapMm = Math.hypot(rb.cx - gas.x, rb.cy - gas.y) * 1000;
    expect(gapMm).toBeGreaterThanOrEqual(LV.gasClearanceMm);
  });

  it('the gas rule does not complain about the current placement', () => {
    const p = makeInitialProject();
    const hit = runRules(p, CLEAR_HEIGHT).find((r) => r.id === 'router-vs-gas');
    expect(hit).toBeTruthy();
    expect(hit.severity).toBe('info');
  });

  it('the router sits on the boiler line — on the same UPS', () => {
    const p = makeInitialProject();
    const router = p.equipment.find((e) => e.catalogId === 'ont_router');
    expect(router.circuit).toBe('boiler');
  });
});
