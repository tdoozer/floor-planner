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
  it('при 100 % влажности точка росы равна температуре воздуха', () => {
    expect(dewPoint(20, 100)).toBeCloseTo(20, 1);
  });

  it('чем суше воздух, тем ниже точка росы', () => {
    expect(dewPoint(20, 40)).toBeLessThan(dewPoint(20, 60));
  });

  it('справочное значение: 20 °C и 50 % дают около 9,3 °C', () => {
    expect(dewPoint(20, 50)).toBeCloseTo(9.3, 1);
  });
});

describe('glassTemp', () => {
  it('лучше стеклопакет — теплее стекло', () => {
    const good = glassTemp({ uWindow: 1.0, tIn: 20, tOut: -27 });
    const poor = glassTemp({ uWindow: 2.5, tIn: 20, tOut: -27 });
    expect(good).toBeGreaterThan(poor);
  });

  it('при U = 1,7 и минус 27 стекло держится около 9,6 °C', () => {
    expect(glassTemp({ uWindow: 1.7, tIn: 20, tOut: -27 })).toBeCloseTo(9.6, 1);
  });

  it('иней требует однокамерного стекла: U около 3', () => {
    expect(glassTemp({ uWindow: 1.7, tIn: 20, tOut: -27 })).toBeGreaterThan(0);
    expect(glassTemp({ uWindow: 3.3, tIn: 20, tOut: -27 })).toBeLessThan(0);
  });
});

describe('criticalHumidity', () => {
  it('при U = 1,7 конденсат начинается около 51 % влажности', () => {
    expect(criticalHumidity({ uWindow: 1.7, tIn: 20, tOut: -27 })).toBeCloseTo(51, 0);
  });

  it('улучшение стеклопакета поднимает порог', () => {
    const u17 = criticalHumidity({ uWindow: 1.7, tIn: 20, tOut: -27 });
    const u10 = criticalHumidity({ uWindow: 1.0, tIn: 20, tOut: -27 });
    expect(u10).toBeGreaterThan(u17);
    expect(u10).toBeCloseTo(68, 0);
  });

  it('в мороз слабее порог выше', () => {
    const hard = criticalHumidity({ uWindow: 1.7, tIn: 20, tOut: -27 });
    const mild = criticalHumidity({ uWindow: 1.7, tIn: 20, tOut: -5 });
    expect(mild).toBeGreaterThan(hard);
  });
});

describe('windowsCheck — окна проекта', () => {
  const p = makeInitialProject();
  const rows = windowsCheck({
    openings: p.openings,
    envelope: p.envelope,
    climate: p.climate,
    rh: 50,
    roomTemp: { living: 20, bath: 24, hall: 18 }
  });

  it('проверяются только окна, двери пропускаются', () => {
    expect(rows.length).toBe(p.openings.filter((o) => o.kind === 'window').length);
  });

  it('ни одно окно не обмерзает', () => {
    rows.forEach((r) => expect(r.frost).toBe(false));
  });

  it('окно прихожей — самое холодное: там держат 18 °C', () => {
    const hall = rows.find((r) => r.room === 'hall');
    const living = rows.find((r) => r.room === 'living');
    expect(hall.tGlass).toBeLessThan(living.tGlass);
    expect(hall.blind).toBe(true);
  });

  it('при 50 % влажности запас до конденсата минимальный', () => {
    rows.forEach((r) => {
      expect(r.criticalRh).toBeGreaterThan(45);
      expect(r.criticalRh).toBeLessThan(60);
    });
  });
});

describe('backBoxCheck — подрозетник, утопленный в газобетон', () => {
  const p = makeInitialProject();
  const args = { envelope: p.envelope, tIn: p.climate.tInLiving, tOut: p.climate.tOutDesign };

  it('коронка 45 мм оставляет 255 из 300 мм блока', () => {
    const r = wallLayersR(p.envelope, { recessMm: 45 });
    expect(r.blockMm).toBe(255);
    // Штукатурку подрозетник срезает вместе с блоком
    expect(r.rFinish).toBe(0);
  });

  it('утапливание стоит меньше градуса — стена и так толстая', () => {
    const b = backBoxCheck(args);
    expect(b.penalty).toBeLessThan(1);
    expect(b.tAtBox).toBeLessThan(b.tSolid);
  });

  it('конденсата за розеткой нет с большим запасом', () => {
    const b = backBoxCheck(args);
    expect(b.condenses).toBe(false);
    expect(b.margin).toBeGreaterThan(5);
    // Начнётся только за 85 % влажности, чего в жилой комнате не бывает
    expect(b.criticalRh).toBeGreaterThan(85);
  });

  it('даже в худшем случае — блок 200 без наружного утеплителя — сухо', () => {
    const worst = {
      ...p.envelope,
      wall: { ...p.envelope.wall, thickness: 200 },
      wallInsulation: { thickness: 0, lambda: 0.034 }
    };
    const b = backBoxCheck({ ...args, envelope: worst });
    expect(b.condenses).toBe(false);
    expect(b.margin).toBeGreaterThan(3);
  });

  it('честно помечает, что толщина блока не замерена', () => {
    expect(backBoxCheck(args).assumed).toBe(true);
  });

  it('целое сечение теплее, чем сечение с коробкой', () => {
    const solid = wallSurfaceTemp(args);
    const box = wallSurfaceTemp({ ...args, recessMm: 45 });
    expect(solid).toBeGreaterThan(box);
  });
});
