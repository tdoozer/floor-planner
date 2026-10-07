import { describe, expect, it } from 'vitest';

import {
  CABLE_OD_MM,
  CIRCUITS,
  IN_FLOOR,
  cableRoutes,
  electricalPlan,
  electricalPoints,
  switchCoverage
} from '../electrical.js';
import { CLEAR_HEIGHT, makeInitialProject } from '../../data/project.js';
import { getFixture } from '../../data/fixtures.js';
import { runRules } from '../rules.js';

const project = makeInitialProject();
const entry = project.nodes.find((n) => n.type === 'electrical_panel');
const plan = electricalPlan({ equipment: project.equipment, entry });

describe('electricalPoints', () => {
  it('selects only the electrics from the placement', () => {
    const pts = electricalPoints(project.equipment);
    expect(pts.length).toBeGreaterThan(15);
    expect(pts.every((p) => p.id.startsWith('el-'))).toBe(true);
  });

  it('every point has a group and a level', () => {
    electricalPoints(project.equipment).forEach((p) => {
      expect(CIRCUITS[p.circuit]).toBeDefined();
      expect(p.mountHeight).toBeGreaterThan(0);
    });
  });

  it('switches are lower than luminaires', () => {
    const pts = electricalPoints(project.equipment);
    const sw = pts.find((p) => p.catalogId === 'switch1');
    const light = pts.find((p) => p.catalogId === 'light');
    expect(sw.mountHeight).toBeLessThan(light.mountHeight);
  });
});

describe('cableRoutes', () => {
  it('there are no diagonals in the routes', () => {
    plan.routes.forEach((r) => {
      for (let i = 1; i < r.points.length; i++) {
        const dx = Math.abs(r.points[i].x - r.points[i - 1].x);
        const dy = Math.abs(r.points[i].y - r.points[i - 1].y);
        expect(Math.min(dx, dy)).toBeLessThan(1e-6);
      }
    });
  });

  it('every route runs in its own lane', () => {
    const lanes = plan.routes.map((r) => r.corridorX);
    expect(new Set(lanes).size).toBe(lanes.length);
  });

  it('more cable is needed than the route length along the floor', () => {
    plan.routes.forEach((r) => expect(r.cableM).toBeGreaterThan(r.runM));
  });

  it('a far point needs more cable than a near one', () => {
    const sorted = [...plan.routes].sort((a, b) => a.runM - b.runM);
    expect(sorted[sorted.length - 1].cableM).toBeGreaterThan(sorted[0].cableM);
  });

  it('moving a point changes the route', () => {
    const moved = project.equipment.map((e) =>
      e.id === 'el-tv' ? { ...e, x: 0.5, y: 0.5 } : e
    );
    const before = plan.routes.find((r) => r.id === 'el-tv').runM;
    const after = electricalPlan({ equipment: moved, entry })
      .routes.find((r) => r.id === 'el-tv').runM;
    expect(after).not.toBeCloseTo(before, 2);
  });
});

describe('Electrical points and openings', () => {
  it('no point stands in an opening', () => {
    const bad = runRules(project, CLEAR_HEIGHT).filter((w) => w.id.startsWith('el-in-opening'));
    expect(bad.map((w) => w.id)).toEqual([]);
  });

  it('a point pushed into a door is caught by the rule', () => {
    const p = makeInitialProject();
    // Door hall→living room: opening 3300…4100 on the partition x = 2.0
    p.equipment = p.equipment.map((e) =>
      e.id === 'el-sw-living' ? { ...e, x: 2.02, y: 3.7 } : e
    );
    const bad = runRules(p, CLEAR_HEIGHT).filter((w) => w.id.startsWith('el-in-opening'));
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0].severity).toBe('error');
  });

  it('a socket BELOW the sill does not count as being in the opening', () => {
    const p = makeInitialProject();
    // Top wall window 1000…2300, sill 960.
    // The refrigerator and dishwasher sockets stand under it, at level 150.
    const dw = p.equipment.find((e) => e.id === 'el-dishwasher');
    expect(dw.x).toBeGreaterThan(1.0);
    expect(dw.x).toBeLessThan(2.3);
    const bad = runRules(p, CLEAR_HEIGHT).filter((w) => w.id.includes('el-dishwasher'));
    expect(bad).toHaveLength(0);
  });

  it('but a 1100 block in the same place is already a conflict', () => {
    const p = makeInitialProject();
    p.equipment = p.equipment.map((e) =>
      e.id === 'el-kitchen-block' ? { ...e, x: 1.6 } : e
    );
    const bad = runRules(p, CLEAR_HEIGHT).filter((w) => w.id.includes('el-kitchen-block'));
    expect(bad.length).toBeGreaterThan(0);
  });
});

describe('Floor slab: wiring in timber', () => {
  it('the space between the joists is empty — access from below', () => {
    expect(project.ceiling.cavityFilled).toBe(false);
    expect(project.ceiling.subfloor).toBe(false);
  });

  it('insulation between the floors is needed for SOUND, not heat', () => {
    // The attic is heated — two bedrooms with radiators
    expect(project.ceiling.insulationPurpose).toBe('acoustic');
  });

  it('the metal hose rule fires', () => {
    const w = runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'ceiling-wiring');
    expect(w).toBeDefined();
    expect(w.detail).toContain('metal hose');
  });

  it('and reminds that the access window is temporary', () => {
    const w = runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'ceiling-access-window');
    expect(w).toBeDefined();
  });
});

describe('electricalPlan — groups', () => {
  // Only one dedicated line is left — the oven: 3.5 kW takes
  // 3×2.5 on a 16 A breaker entirely, there is nobody to share it with.
  it('only the oven is left on a dedicated line', () => {
    const app = plan.byCircuit.find((g) => g.circuit === 'appliance');
    expect(app.lines).toBe(app.count);
    expect(app.count).toBe(1);
    expect(app.points[0].id).toBe('el-oven');
  });

  it('the refrigerator and dishwasher are combined into one group', () => {
    const g = plan.byCircuit.find((c) => c.circuit === 'kitchenApp');
    expect(g.count).toBe(2);
    expect(g.lines).toBe(1);
    // 0.3 + 2.2 kW against the 3.5 kW that 3×2.5 carries at 16 A
    expect(CIRCUITS.kitchenApp.load).toBeLessThan(3500);
  });

  it('the washing machine goes on the bathroom group, not its own line', () => {
    const g = plan.byCircuit.find((c) => c.circuit === 'bath');
    expect(g.points.map((p) => p.id)).toContain('el-washer');
    // a wet zone — RCD 10 mA, not the common 30
    expect(CIRCUITS.bath.rcdMa).toBe(10);
  });

  it('the emergency line carries exactly what is decided, and nothing more', () => {
    const g = plan.byCircuit.find((c) => c.circuit === 'boiler');
    // The line stopped being “boiler only”: the router, the boiler-room light and one
    // socket were deliberately added to the UPS. The original objection — someone else’s
    // fault must not shut down the heating — is removed NOT by a promise but by the board
    // after the UPS, where each branch has its own device. See calc/emergencyPanel.js.
    expect(g.points.map((p) => p.id).sort()).toEqual([
      'el-boiler', 'el-l-ups', 'el-panel-ups', 'el-router', 'el-soc-ups', 'el-sw-ups'
    ]);
    expect(g.breaker).toBe(6);
  });

  it('there is exactly one socket on the emergency line — the rest is non-removable', () => {
    // The inverter is 400 W. Everything that lands here must be small beyond doubt.
    // The luminaire and the board are small by definition, the boiler is known from the data sheet,
    // but the SOCKET is the only element whose content is unknown
    // in advance. So there must be exactly one, with a breaker
    // set by what is left of the inverter (see calc/emergencyPanel.js).
    const g = plan.byCircuit.find((c) => c.circuit === 'boiler');
    const sockets = g.points.filter((p) => p.catalogId === 'socket_ups');
    expect(sockets).toHaveLength(1);
    // There must be no ordinary sockets on this line at all
    expect(g.points.some((p) => p.catalogId === 'socket2')).toBe(false);
  });

  it('there are now seven groups instead of nine', () => {
    expect(plan.breakers).toBe(7);
  });

  it('cables in the floor are spaced enough not to derate the current', () => {
    // The clearance between adjacent routes is at least two diameters —
    // then the derating factor of the electrical code does not apply
    expect(plan.bundle.clearanceMm).toBeGreaterThanOrEqual(2 * CABLE_OD_MM);
    expect(plan.bundle.derating).toBe(1);
  });

  it('lighting does not run along the floor', () => {
    expect(IN_FLOOR.has('light')).toBe(false);
    const light = plan.byCircuit.find((g) => g.circuit === 'light');
    expect(light.inFloor).toBe(false);
  });

  it('socket groups run along the floor', () => {
    plan.byCircuit
      .filter((g) => g.circuit !== 'light' && !g.lowVoltage)
      .forEach((g) => expect(g.inFloor).toBe(true));
  });

  it('low-voltage does not go into the screed at all', () => {
    // Power cable will outlive the house, low-voltage standards will not.
    // Embedding twisted pair in concrete means burying it for good.
    expect(IN_FLOOR.has('data')).toBe(false);
    const data = plan.byCircuit.find((g) => g.circuit === 'data');
    expect(data.inFloor).toBe(false);
    expect(data.lowVoltage).toBe(true);
  });

  it('there is less cable in the floor than in total', () => {
    expect(plan.inFloorM).toBeGreaterThan(0);
    expect(plan.inFloorM).toBeLessThan(plan.totalCableM);
  });

  it('there are enough breakers for all power groups', () => {
    // Low-voltage takes no breaker and does not go to the power board
    const power = plan.byCircuit.filter((g) => !g.lowVoltage);
    expect(plan.breakers).toBeGreaterThanOrEqual(power.length);
  });

  it('the bathroom is on its own group with an RCD', () => {
    expect(CIRCUITS.bath.rcd).toBe(true);
    expect(plan.byCircuit.some((g) => g.circuit === 'bath')).toBe(true);
  });

  it('without an entry point the plan is empty but does not crash', () => {
    const empty = electricalPlan({ equipment: project.equipment, entry: null });
    expect(empty.routes).toEqual([]);
    expect(empty.totalCableM).toBe(0);
  });
});

describe('two-gang two-way switches for the living-room light', () => {
  const p = makeInitialProject();
  const at = (id) => p.equipment.find((e) => e.id === id);

  it('both ends of the two-way circuit are two-way switches', () => {
    // There used to be an ordinary single-gang one at the entrance: a two-way circuit
    // physically does not work like that, EACH of the two must be a two-way switch
    expect(at('el-sw-living').catalogId).toBe('switch2_way');
    expect(at('el-sw-living-2').catalogId).toBe('switch2_way');
    expect(getFixture('switch2_way').twoWay).toBe(true);
    expect(getFixture('switch2_way').gangs).toBe(2);
  });

  it('the pair refers to each other both ways', () => {
    expect(at('el-sw-living').pairWith).toBe('el-sw-living-2');
    expect(at('el-sw-living-2').pairWith).toBe('el-sw-living');
  });

  it('the gangs match at both ends — group to group', () => {
    expect(at('el-sw-living').groups).toEqual(at('el-sw-living-2').groups);
  });

  it('the living-room light is split into two groups, no lamp is lost', () => {
    const g = at('el-sw-living').groups;
    expect(g).toHaveLength(2);
    const all = g.flat().sort();
    // A luminaire with battery backup is an ordinary lamp, just with a battery inside:
    // it hangs on the same gang as the rest of the living-room light, and in an emergency
    // it comes on by itself. It needs no separate control.
    expect(all).toEqual(['el-bap-living', 'el-l1', 'el-l2', 'el-l3']);
  });

  it('the stair lighting stayed a separate pair with the attic', () => {
    const st = at('el-sw-stair');
    expect(st.catalogId).toBe('switch_way');
    expect(st.pairWith).toBe('MANSARD');
  });

  it('all lamps are still controlled by something', () => {
    const cov = switchCoverage(p.equipment);
    expect(cov.orphanLights).toHaveLength(0);
  });

  it('the living-room light is reachable from two places', () => {
    const cov = switchCoverage(p.equipment);
    ['el-l1', 'el-l2', 'el-l3'].forEach((id) =>
      expect(cov.dualControlled).toContain(id)
    );
  });
});
