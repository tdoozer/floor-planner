import { describe, expect, it } from 'vitest';

import {
  BOILER_INTERNAL_LOSS_M,
  BOILER_PUMP_CURVE,
  FITTINGS_FACTOR,
  PIPE,
  boilerPumpHead,
  loopFlow,
  loopHydraulics,
  systemHydraulics
} from '../hydraulics.js';
import { makeInitialProject } from '../../data/project.js';

const coolant = makeInitialProject().coolant;
const water = { base: 'water', c: 4.18, density: 1000 };

describe('boilerPumpHead — data sheet curve, appendix E', () => {
  it('the head falls as the flow grows', () => {
    expect(boilerPumpHead(200)).toBeGreaterThan(boilerPumpHead(900));
  });

  it('at the working point of 345 l/h it gives about 4.8 m', () => {
    expect(boilerPumpHead(345)).toBeGreaterThan(4.7);
    expect(boilerPumpHead(345)).toBeLessThan(4.9);
  });

  it('interpolates between curve points', () => {
    const mid = boilerPumpHead(250);
    expect(mid).toBeLessThan(boilerPumpHead(200));
    expect(mid).toBeGreaterThan(boilerPumpHead(300));
  });

  it('does not extrapolate beyond the curve', () => {
    expect(boilerPumpHead(-100)).toBe(BOILER_PUMP_CURVE[0][1]);
    expect(boilerPumpHead(99999)).toBe(BOILER_PUMP_CURVE[BOILER_PUMP_CURVE.length - 1][1]);
  });

  it('the data sheet gives noticeably more than the earlier cautious estimate of 2.5 m', () => {
    expect(boilerPumpHead(345) - BOILER_INTERNAL_LOSS_M).toBeGreaterThan(2.5);
  });
});

describe('PIPE', () => {
  it('a 16×2.0 pipe has an inner diameter of 12 mm', () => {
    expect(PIPE.inner).toBeCloseTo(0.012, 6);
  });
});

describe('loopFlow', () => {
  it('flow is inversely proportional to the difference', () => {
    const dt5 = loopFlow({ powerW: 600, coolant, deltaT: 5 });
    const dt10 = loopFlow({ powerW: 600, coolant, deltaT: 10 });
    expect(dt10.lPerMin).toBeCloseTo(dt5.lPerMin / 2, 6);
  });

  it('on antifreeze the flow is higher than on water at the same power', () => {
    const g = loopFlow({ powerW: 600, coolant, deltaT: 5 });
    const w = loopFlow({ powerW: 600, coolant: water, deltaT: 5 });
    expect(g.lPerMin).toBeGreaterThan(w.lPerMin);
  });
});

describe('loopHydraulics', () => {
  const loop = { powerW: 623, lengthM: 59 };

  it('velocity in the pipe stays in the working range', () => {
    const h = loopHydraulics({ ...loop, coolant });
    expect(h.velocity).toBeGreaterThan(0.15);
    expect(h.velocity).toBeLessThan(0.6);
  });

  it('on antifreeze the flow is laminar — this matters for heat transfer', () => {
    const h = loopHydraulics({ ...loop, coolant });
    expect(h.laminar).toBe(true);
    expect(h.reynolds).toBeLessThan(2300);
  });

  it('water goes into the turbulent regime, ethylene glycol stays laminar', () => {
    const g = loopHydraulics({ ...loop, coolant });
    const w = loopHydraulics({ ...loop, coolant: water });
    expect(w.reynolds).toBeGreaterThan(g.reynolds);
    expect(w.laminar).toBe(false);
    expect(g.laminar).toBe(true);
  });

  it('on ethylene glycol the losses are almost equal to water — no antifreeze penalty', () => {
    // With propylene glycol the gap was several-fold. The label showed ethylene glycol,
    // which is noticeably thinner, and the hydraulic loss practically disappeared.
    const g = loopHydraulics({ ...loop, coolant });
    const w = loopHydraulics({ ...loop, coolant: water });
    expect(g.dropM / w.dropM).toBeGreaterThan(0.8);
    expect(g.dropM / w.dropM).toBeLessThan(1.25);
  });

  it('a long loop resists more than a short one', () => {
    const short = loopHydraulics({ powerW: 623, lengthM: 30, coolant });
    const long = loopHydraulics({ powerW: 623, lengthM: 60, coolant });
    expect(long.dropM).toBeGreaterThan(short.dropM);
  });
});

describe('systemHydraulics — is the boiler pump enough', () => {
  const loops = [
    { powerW: 623, lengthM: 59 },
    { powerW: 623, lengthM: 59 },
    { powerW: 213, lengthM: 30 },
    { powerW: 383, lengthM: 27 }
  ];

  it('the pump is judged by the heaviest loop, not by the sum', () => {
    const s = systemHydraulics({ loops, coolant });
    expect(s.requiredHeadM).toBeCloseTo(s.worst.dropM * FITTINGS_FACTOR, 6);
    expect(s.worst.dropM).toBeGreaterThanOrEqual(Math.max(...s.perLoop.map((p) => p.dropM)) - 1e-9);
  });

  it('the total flow adds up over all loops', () => {
    const s = systemHydraulics({ loops, coolant });
    const sum = s.perLoop.reduce((acc, p) => acc + p.lPerHour, 0);
    expect(s.totalFlowLh).toBeCloseTo(sum, 6);
  });

  it('on antifreeze at least one loop is laminar', () => {
    expect(systemHydraulics({ loops, coolant }).anyLaminar).toBe(true);
  });

  it('a weak pump does not push the system through', () => {
    const s = systemHydraulics({ loops, coolant, boilerHeadM: 0.2 });
    expect(s.boilerPumpEnough).toBe(false);
    expect(s.margin).toBeLessThan(0);
  });
});
