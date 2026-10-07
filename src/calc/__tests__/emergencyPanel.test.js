import { describe, expect, it } from 'vitest';
import {
  BRANCHES, MCB_CURVES, PANEL, autonomyCost, emergencyPanel,
  socketBreaker, tripsInstantly
} from '../emergencyPanel.js';
import { CLEAR_HEIGHT, makeInitialProject } from '../../data/project.js';
import { getFixture } from '../../data/fixtures.js';
import { runRules } from '../rules.js';

const SW500L = 400; // Shtil SW500L, 500 VA / 400 W

describe('emergency power board', () => {
  const ep = emergencyPanel({ inverterW: SW500L });

  it('splits the single output socket of the UPS into four branches', () => {
    // The SW500L has one Schuko at the output — the boiler and the router do not both
    // fit into it, so the board is not there for show
    expect(ep.branches).toHaveLength(4);
    expect(ep.branches.map((b) => b.id)).toEqual(['boiler', 'router', 'light', 'socket']);
  });

  it('every branch has its own device — a fault does not reach the boiler', () => {
    // This is the engineering answer to the original “nothing else on the boiler line”
    expect(ep.branches.every((b) => b.breaker > 0)).toBe(true);
    const socket = ep.branches.find((b) => b.id === 'socket');
    expect(socket.rcd).toBe(true);
    expect(socket.rcdMa).toBe(10);
    // The other branches do not need their own RCD
    expect(ep.branches.filter((b) => b.rcd)).toHaveLength(1);
  });

  it('the light on the UPS is class II, otherwise it can trip the common RCD', () => {
    const light = ep.branches.find((b) => b.id === 'light');
    expect(light.classII).toBe(true);
    expect(getFixture('light_ups').circuit).toBe('boiler');
  });

  it('fits into an 8-module enclosure with room to spare', () => {
    expect(ep.modulesUsed).toBeLessThanOrEqual(PANEL.modules);
    expect(ep.modulesFree).toBeGreaterThan(0);
  });
});

describe('rating of the emergency socket breaker', () => {
  const ep = emergencyPanel({ inverterW: SW500L });

  it('is set by what is left of the inverter, not by the cable', () => {
    // A 3×1.5 cable holds 16 A and needs no 1 A protection.
    // It is the UPS that has to be protected: 400 W minus the constant 135.
    expect(ep.baseW).toBe(135);
    expect(ep.socket.spareW).toBe(265);
    expect(ep.socket.rating).toBe(1);
    expect(ep.socket.peakW).toBeLessThanOrEqual(SW500L);
    expect(ep.socket.fits).toBe(true);
  });

  it('lets a charger and a laptop through, but not a kettle', () => {
    expect(ep.socket.allowedW).toBe(220);
    expect(220).toBeGreaterThan(65); // laptop
    expect(220).toBeLessThan(2000); // kettle
  });

  it('characteristic B, not C — and that is not a matter of taste', () => {
    // A kettle of 2 kW = 9.1 A = 9 ratings of a 1 A breaker.
    // B guarantees an instantaneous trip from 5 ratings, C — only from 10.
    const onB = tripsInstantly({ loadW: 2000, rating: 1, curve: MCB_CURVES.B });
    const onC = tripsInstantly({ loadW: 2000, rating: 1, curve: MCB_CURVES.C });
    expect(onB.guaranteed).toBe(true);
    expect(onC.guaranteed).toBe(false);
    expect(BRANCHES.find((b) => b.id === 'socket').curve).toBe('B');
  });

  it('on a weaker inverter there may be no breaker left for the socket', () => {
    // 150 W: constant 135, 15 W free — that is 0.07 A,
    // less than the smallest rating
    const tiny = emergencyPanel({ inverterW: 150 });
    expect(tiny.socket.rating).toBeNull();
    expect(tiny.socket.fits).toBe(false);
  });

  it('the more powerful the inverter, the larger the permissible breaker', () => {
    const big = socketBreaker({ inverterW: 1000, baseW: 135 });
    expect(big.rating).toBeGreaterThan(1);
    expect(big.peakW).toBeLessThanOrEqual(1000);
  });
});

describe('the price of run time', () => {
  // A 2 × 100 Ah bank gives 1020 Wh, the online UPS eats 30 W itself
  const rows = autonomyCost({
    usableWh: 1020, idleW: 30, loads: [
      { name: 'boiler', watts: 72 },
      { name: 'router', watts: 15 },
      { name: 'boiler-room light', watts: 10 },
      { name: 'laptop', watts: 65 }
    ]
  });

  it('every watt takes hours, and it is visible line by line', () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].hours).toBeLessThan(rows[i - 1].hours);
    }
  });

  it('the boiler-room light costs less than an hour of run time', () => {
    const before = rows.find((r) => r.name === 'router').hours;
    const after = rows.find((r) => r.name === 'boiler-room light').hours;
    expect(before - after).toBeLessThan(1);
  });

  it('a laptop in the socket costs almost three hours — that is expensive', () => {
    const before = rows.find((r) => r.name === 'boiler-room light').hours;
    const after = rows.find((r) => r.name === 'laptop').hours;
    expect(before - after).toBeGreaterThan(2.5);
  });
});

describe('the emergency line in the project', () => {
  const p = makeInitialProject();
  const onUps = p.equipment.filter((e) => e.circuit === 'boiler');

  it('there is exactly one socket on the UPS', () => {
    expect(onUps.filter((e) => e.catalogId === 'socket_ups')).toHaveLength(1);
    expect(onUps.filter((e) => e.catalogId === 'socket2')).toHaveLength(0);
  });

  it('luminaires with battery backup sit on the ORDINARY lighting line, not on the UPS', () => {
    // That is the whole idea: we do not pull a cable from the boiler room to the stair and upstairs,
    // and they work even if the UPS itself has failed
    const baps = p.equipment.filter((e) => e.catalogId === 'light_bap');
    expect(baps.length).toBeGreaterThanOrEqual(2);
    expect(getFixture('light_bap').circuit).toBe('light');
    expect(getFixture('light_bap').emergency).toBe(true);
    baps.forEach((b) => expect(b.circuit).toBeUndefined());
  });

  it('the board rule does not complain about the current hardware', () => {
    const hit = runRules(p, CLEAR_HEIGHT).find((r) => r.id === 'ups-panel');
    expect(hit).toBeTruthy();
    expect(hit.severity).toBe('info');
  });

  it('the rule finds no extra sockets or non-class-II luminaires', () => {
    const ids = runRules(p, CLEAR_HEIGHT).map((r) => r.id);
    expect(ids).not.toContain('ups-socket-count');
    expect(ids).not.toContain('ups-light-class');
  });
});
