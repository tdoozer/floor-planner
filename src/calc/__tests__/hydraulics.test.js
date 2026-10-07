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

describe('boilerPumpHead — паспортный график, приложение Е', () => {
  it('напор падает с ростом расхода', () => {
    expect(boilerPumpHead(200)).toBeGreaterThan(boilerPumpHead(900));
  });

  it('в рабочей точке 345 л/ч даёт около 4,8 м', () => {
    expect(boilerPumpHead(345)).toBeGreaterThan(4.7);
    expect(boilerPumpHead(345)).toBeLessThan(4.9);
  });

  it('интерполирует между точками графика', () => {
    const mid = boilerPumpHead(250);
    expect(mid).toBeLessThan(boilerPumpHead(200));
    expect(mid).toBeGreaterThan(boilerPumpHead(300));
  });

  it('за пределами графика не экстраполирует', () => {
    expect(boilerPumpHead(-100)).toBe(BOILER_PUMP_CURVE[0][1]);
    expect(boilerPumpHead(99999)).toBe(BOILER_PUMP_CURVE[BOILER_PUMP_CURVE.length - 1][1]);
  });

  it('паспорт даёт заметно больше прежней осторожной оценки 2,5 м', () => {
    expect(boilerPumpHead(345) - BOILER_INTERNAL_LOSS_M).toBeGreaterThan(2.5);
  });
});

describe('PIPE', () => {
  it('труба 16×2,0 имеет внутренний диаметр 12 мм', () => {
    expect(PIPE.inner).toBeCloseTo(0.012, 6);
  });
});

describe('loopFlow', () => {
  it('расход обратно пропорционален перепаду', () => {
    const dt5 = loopFlow({ powerW: 600, coolant, deltaT: 5 });
    const dt10 = loopFlow({ powerW: 600, coolant, deltaT: 10 });
    expect(dt10.lPerMin).toBeCloseTo(dt5.lPerMin / 2, 6);
  });

  it('на антифризе расход выше, чем на воде при той же мощности', () => {
    const g = loopFlow({ powerW: 600, coolant, deltaT: 5 });
    const w = loopFlow({ powerW: 600, coolant: water, deltaT: 5 });
    expect(g.lPerMin).toBeGreaterThan(w.lPerMin);
  });
});

describe('loopHydraulics', () => {
  const loop = { powerW: 623, lengthM: 59 };

  it('скорость в трубе остаётся в рабочем диапазоне', () => {
    const h = loopHydraulics({ ...loop, coolant });
    expect(h.velocity).toBeGreaterThan(0.15);
    expect(h.velocity).toBeLessThan(0.6);
  });

  it('на антифризе течение ламинарное — это важно для теплоотдачи', () => {
    const h = loopHydraulics({ ...loop, coolant });
    expect(h.laminar).toBe(true);
    expect(h.reynolds).toBeLessThan(2300);
  });

  it('вода уходит в турбулентный режим, этиленгликоль остаётся ламинарным', () => {
    const g = loopHydraulics({ ...loop, coolant });
    const w = loopHydraulics({ ...loop, coolant: water });
    expect(w.reynolds).toBeGreaterThan(g.reynolds);
    expect(w.laminar).toBe(false);
    expect(g.laminar).toBe(true);
  });

  it('на этиленгликоле потери почти равны воде — штрафа за антифриз нет', () => {
    // С пропиленгликолем разрыв был кратным. Этикетка показала этиленгликоль,
    // он заметно жиже, и гидравлический проигрыш практически исчез.
    const g = loopHydraulics({ ...loop, coolant });
    const w = loopHydraulics({ ...loop, coolant: water });
    expect(g.dropM / w.dropM).toBeGreaterThan(0.8);
    expect(g.dropM / w.dropM).toBeLessThan(1.25);
  });

  it('длинный контур сопротивляется сильнее короткого', () => {
    const short = loopHydraulics({ powerW: 623, lengthM: 30, coolant });
    const long = loopHydraulics({ powerW: 623, lengthM: 60, coolant });
    expect(long.dropM).toBeGreaterThan(short.dropM);
  });
});

describe('systemHydraulics — хватит ли насоса котла', () => {
  const loops = [
    { powerW: 623, lengthM: 59 },
    { powerW: 623, lengthM: 59 },
    { powerW: 213, lengthM: 30 },
    { powerW: 383, lengthM: 27 }
  ];

  it('насос считается по самому тяжёлому контуру, а не по сумме', () => {
    const s = systemHydraulics({ loops, coolant });
    expect(s.requiredHeadM).toBeCloseTo(s.worst.dropM * FITTINGS_FACTOR, 6);
    expect(s.worst.dropM).toBeGreaterThanOrEqual(Math.max(...s.perLoop.map((p) => p.dropM)) - 1e-9);
  });

  it('суммарный расход складывается по всем контурам', () => {
    const s = systemHydraulics({ loops, coolant });
    const sum = s.perLoop.reduce((acc, p) => acc + p.lPerHour, 0);
    expect(s.totalFlowLh).toBeCloseTo(sum, 6);
  });

  it('на антифризе хотя бы один контур ламинарный', () => {
    expect(systemHydraulics({ loops, coolant }).anyLaminar).toBe(true);
  });

  it('слабый насос не продавливает систему', () => {
    const s = systemHydraulics({ loops, coolant, boilerHeadM: 0.2 });
    expect(s.boilerPumpEnough).toBe(false);
    expect(s.margin).toBeLessThan(0);
  });
});
