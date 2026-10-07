import { describe, expect, it } from 'vitest';

import {
  backBoxCheck,
  criticalHumidity,
  dewPoint,
  glassTemp,
  wallLayersR,
  wallSurfaceTemp,
  windowsCheck
} from '../condensation.js';
import { makeInitialProject } from '../../data/project.js';

describe('dewPoint', () => {
  it('at 100 % humidity the dew point equals the air temperature', () => {
    expect(dewPoint(20, 100)).toBeCloseTo(20, 1);
  });

  it('the drier the air, the lower the dew point', () => {
    expect(dewPoint(20, 40)).toBeLessThan(dewPoint(20, 60));
  });

  it('reference value: 20 °C and 50 % give about 9.3 °C', () => {
    expect(dewPoint(20, 50)).toBeCloseTo(9.3, 1);
  });
});

describe('glassTemp', () => {
  it('a better glazing unit — warmer glass', () => {
    const good = glassTemp({ uWindow: 1.0, tIn: 20, tOut: -27 });
    const poor = glassTemp({ uWindow: 2.5, tIn: 20, tOut: -27 });
    expect(good).toBeGreaterThan(poor);
  });

  it('at U = 1.7 and minus 27 the glass stays at about 9.6 °C', () => {
    expect(glassTemp({ uWindow: 1.7, tIn: 20, tOut: -27 })).toBeCloseTo(9.6, 1);
  });

  it('frost requires single-chamber glass: U about 3', () => {
    expect(glassTemp({ uWindow: 1.7, tIn: 20, tOut: -27 })).toBeGreaterThan(0);
    expect(glassTemp({ uWindow: 3.3, tIn: 20, tOut: -27 })).toBeLessThan(0);
  });
});

describe('criticalHumidity', () => {
  it('at U = 1.7 condensation starts at about 51 % humidity', () => {
    expect(criticalHumidity({ uWindow: 1.7, tIn: 20, tOut: -27 })).toBeCloseTo(51, 0);
  });

  it('improving the glazing unit raises the threshold', () => {
    const u17 = criticalHumidity({ uWindow: 1.7, tIn: 20, tOut: -27 });
    const u10 = criticalHumidity({ uWindow: 1.0, tIn: 20, tOut: -27 });
    expect(u10).toBeGreaterThan(u17);
    expect(u10).toBeCloseTo(68, 0);
  });

  it('in frost the threshold is higher at weaker glazing', () => {
    const hard = criticalHumidity({ uWindow: 1.7, tIn: 20, tOut: -27 });
    const mild = criticalHumidity({ uWindow: 1.7, tIn: 20, tOut: -5 });
    expect(mild).toBeGreaterThan(hard);
  });
});

describe('windowsCheck — project windows', () => {
  const p = makeInitialProject();
  const rows = windowsCheck({
    openings: p.openings,
    envelope: p.envelope,
    climate: p.climate,
    rh: 50,
    roomTemp: { living: 20, bath: 24, hall: 18 }
  });

  it('only windows are checked, doors are skipped', () => {
    expect(rows.length).toBe(p.openings.filter((o) => o.kind === 'window').length);
  });

  it('no window ices up', () => {
    rows.forEach((r) => expect(r.frost).toBe(false));
  });

  it('the hall window is the coldest: 18 °C is held there', () => {
    const hall = rows.find((r) => r.room === 'hall');
    const living = rows.find((r) => r.room === 'living');
    expect(hall.tGlass).toBeLessThan(living.tGlass);
    expect(hall.blind).toBe(true);
  });

  it('at 50 % humidity the margin to condensation is minimal', () => {
    rows.forEach((r) => {
      expect(r.criticalRh).toBeGreaterThan(45);
      expect(r.criticalRh).toBeLessThan(60);
    });
  });
});

describe('backBoxCheck — a back box recessed into aerated concrete', () => {
  const p = makeInitialProject();
  const args = { envelope: p.envelope, tIn: p.climate.tInLiving, tOut: p.climate.tOutDesign };

  it('a 45 mm crown leaves 255 of the 300 mm block', () => {
    const r = wallLayersR(p.envelope, { recessMm: 45 });
    expect(r.blockMm).toBe(255);
    // The back box cuts the plaster together with the block
    expect(r.rFinish).toBe(0);
  });

  it('recessing costs less than a degree — the wall is thick anyway', () => {
    const b = backBoxCheck(args);
    expect(b.penalty).toBeLessThan(1);
    expect(b.tAtBox).toBeLessThan(b.tSolid);
  });

  it('there is no condensation behind the socket, with a large margin', () => {
    const b = backBoxCheck(args);
    expect(b.condenses).toBe(false);
    expect(b.margin).toBeGreaterThan(5);
    // It would start only above 85 % humidity, which does not happen in a living room
    expect(b.criticalRh).toBeGreaterThan(85);
  });

  it('even in the worst case — a 200 block without outer insulation — it is dry', () => {
    const worst = {
      ...p.envelope,
      wall: { ...p.envelope.wall, thickness: 200 },
      wallInsulation: { thickness: 0, lambda: 0.034 }
    };
    const b = backBoxCheck({ ...args, envelope: worst });
    expect(b.condenses).toBe(false);
    expect(b.margin).toBeGreaterThan(3);
  });

  it('honestly marks that the block thickness is not measured', () => {
    expect(backBoxCheck(args).assumed).toBe(true);
  });

  it('the full section is warmer than the section with a box', () => {
    const solid = wallSurfaceTemp(args);
    const box = wallSurfaceTemp({ ...args, recessMm: 45 });
    expect(solid).toBeGreaterThan(box);
  });
});
