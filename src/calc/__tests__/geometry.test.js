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

describe('buildRooms — планировка выводится из четырёх чисел', () => {
  const rooms = buildRooms(DEFAULT_LAYOUT);
  const byId = (id) => rooms.find((r) => r.id === id);

  it('три помещения в сумме дают 30,25 м² в свету', () => {
    const total = rooms.reduce((s, r) => s + polygonArea(r.polygon), 0);
    expect(total).toBeCloseTo(INNER_W * INNER_D, 5);
  });

  it('санузел в правом верхнем углу', () => {
    const bath = byId('bath');
    expect(polygonArea(bath.polygon)).toBeCloseTo(
      (INNER_W - DEFAULT_LAYOUT.bathX) * DEFAULT_LAYOUT.bathY, 5
    );
    expect(pointInPolygon(bath.polygon, 5.0, 1.0)).toBe(true);
  });

  it('прихожая-котельная в левом нижнем углу', () => {
    const hall = byId('hall');
    expect(pointInPolygon(hall.polygon, 0.5, 5.0)).toBe(true);
    expect(pointInPolygon(hall.polygon, 5.0, 1.0)).toBe(false);
  });

  it('зал L-образный: заходит и под санузел справа снизу, и правее прихожей', () => {
    const living = byId('living');
    expect(pointInPolygon(living.polygon, 5.0, 4.0)).toBe(true); // справа снизу
    expect(pointInPolygon(living.polygon, 1.0, 1.0)).toBe(true); // слева сверху
    expect(pointInPolygon(living.polygon, 0.5, 5.0)).toBe(false); // это прихожая
    expect(pointInPolygon(living.polygon, 5.0, 1.0)).toBe(false); // это санузел
  });

  it('сдвиг перегородки перераспределяет площади, сумма постоянна', () => {
    const wider = buildRooms({ ...DEFAULT_LAYOUT, hallX: 2.4 });
    const total = wider.reduce((s, r) => s + polygonArea(r.polygon), 0);
    expect(total).toBeCloseTo(INNER_W * INNER_D, 5);

    const hallBefore = polygonArea(byId('hall').polygon);
    const hallAfter = polygonArea(wider.find((r) => r.id === 'hall').polygon);
    expect(hallAfter).toBeGreaterThan(hallBefore);
  });
});

describe('polygonArea', () => {
  it('считает площадь прямоугольника', () => {
    const poly = [{ x: 0, y: 0 }, { x: 3.9, y: 0 }, { x: 3.9, y: 5.5 }, { x: 0, y: 5.5 }];
    expect(polygonArea(poly)).toBeCloseTo(21.45, 5);
  });
});

describe('drainRoute', () => {
  it('манхэттенская трасса равна сумме катетов', () => {
    const r = drainRoute({ x: 1, y: 3 }, { x: 4, y: 1 });
    expect(r.length).toBeCloseTo(2 + 3, 6);
    expect(r.points).toHaveLength(3);
  });
});

describe('drainFit — самая важная проверка перед заливкой', () => {
  const screed = { ...SCREED };

  it('короткая трасса унитаза помещается в пирог', () => {
    const fit = drainFit({ routeLength: 1.0, dia: 110, riserInvertM: -0.35, screed });
    // Лоток: -350 + 1,0 × 20 = -330 мм; верх трубы -330 + 110 = -220 мм
    expect(fit.invertMm).toBeCloseTo(-330, 6);
    expect(fit.crownMm).toBeCloseTo(-220, 6);
    // Низ стяжки: -(12 + 70) = -82 мм → труба ниже, помещается
    expect(fit.underScreedMm).toBe(-82);
    expect(fit.ok).toBe(true);
  });

  it('длинная трасса Ø110 перестаёт помещаться', () => {
    // 12 м × 2 см/м = 240 мм подъёма: -350 + 240 = -110, верх трубы ровно 0.
    const fit = drainFit({ routeLength: 12, dia: 110, riserInvertM: -0.35, screed });
    expect(fit.crownMm).toBeCloseTo(0, 6);
    expect(fit.ok).toBe(false);
    expect(fit.marginMm).toBeLessThan(0);
  });

  it('уклон ровно 2 см на метр', () => {
    const a = drainFit({ routeLength: 0, dia: 50, riserInvertM: -0.3, screed });
    const b = drainFit({ routeLength: 1, dia: 50, riserInvertM: -0.3, screed });
    expect(b.invertMm - a.invertMm).toBeCloseTo(DRAIN_SLOPE * 1000, 6);
  });
});

describe('screedStackup', () => {
  it('суммирует слои пирога пола по грунту', () => {
    const s = screedStackup(SCREED);
    expect(s.total).toBe(
      SCREED.gravel + SCREED.sandBed + SCREED.waterproofing
      + SCREED.insulation + SCREED.screedTotal + SCREED.finishThickness
    );
    // Песчаная подсыпка защищает мембрану от острых граней щебня
    expect(s.layers.some((l) => l.id === 'sandBed')).toBe(true);
    expect(s.layers[0].top).toBe(0);
  });
});

describe('stairHeadroom — проход под маршем', () => {
  it('у нижней ступени высоты почти нет', () => {
    const h = stairHeadroom(STAIR, STAIR.x + 0.5, STAIR.y + STAIR.length - 0.05, 2.7);
    expect(h).toBeLessThan(0.1);
  });

  it('у верхнего конца высота близка к полной', () => {
    const h = stairHeadroom(STAIR, STAIR.x + 0.5, STAIR.y + 0.05, 2.7);
    expect(h).toBeGreaterThan(2.0);
  });

  it('растёт монотонно в сторону подъёма', () => {
    const near = stairHeadroom(STAIR, STAIR.x + 0.5, 3.5, 2.7);
    const far = stairHeadroom(STAIR, STAIR.x + 0.5, 1.0, 2.7);
    expect(far).toBeGreaterThan(near);
  });

  it('вне пятна лестницы возвращает null', () => {
    expect(stairHeadroom(STAIR, 1.0, 1.0, 2.7)).toBeNull();
  });
});

describe('stairCheck — замеренный существующий марш и предлагаемый', () => {
  it('замеры согласуются: заход 1100 + проекция 2600 → кромка проёма 1800', () => {
    expect(STAIR.existingBottomY).toBeCloseTo(INNER_D - 1.1, 6);
    expect(STAIR.existingRun).toBeCloseTo(2.6, 6);
    expect(STAIR.existingBottomY - STAIR.existingRun).toBeCloseTo(STAIR.existingOpeningTopY, 6);
    // 1800 — это ровно грань санузла 1800 × 1800: марш упирается в перекрытие
    // именно там, где начинается санузел
    expect(STAIR.existingOpeningTopY).toBeCloseTo(BATH_SIZE, 6);
  });

  it('существующий марш крут именно из-за короткой проекции', () => {
    // 2600 на 17 подступенков → проступь 162 мм, отсюда и 46°
    expect(STAIR.existingRun / (STAIR.existingRisers - 1)).toBeCloseTo(0.1625, 4);
    const sc = stairCheck({ ...STAIR, length: STAIR.existingRun, risers: STAIR.existingRisers });
    expect(sc.fits).toBe(false);
  });

  it('предлагаемый марш укладывается в отведённую длину', () => {
    const sc = stairCheck(STAIR);
    expect(sc.risePerStep).toBeCloseTo(STAIR.totalRise / STAIR.risers, 6);
    expect(sc.fits).toBe(true);
  });

  it('ширина ступени выросла с 700 до 800', () => {
    expect(STAIR.existingWidth).toBeCloseTo(0.7, 6);
    expect(STAIR.width).toBeCloseTo(0.8, 6);
  });

  it('марш зафиксирован на месте и не двигается', () => {
    // Позиция определена заходом снизу и площадкой сверху по 1 м
    expect(STAIR.locked).toBe(true);
    expect(STAIR.x).toBeCloseTo(4.7, 6);
  });

  it('считает угол наклона из высоты ступени и проступи', () => {
    const sc = stairCheck(STAIR);
    expect(sc.angleDeg).toBeCloseTo((Math.atan(sc.risePerStep / sc.tread) * 180) / Math.PI, 6);
    // 2900 мм подъёма на 3400 мм проекции — марш крутой
    expect(sc.angleDeg).toBeGreaterThan(STAIR_NORMS.maxAngleDeg - 2);
  });

  it('принятый марш 15 × 200 × 243 проходит ОБЕ формулы', () => {
    const sc = stairCheck(STAIR);
    expect(sc.risePerStep).toBeCloseTo(0.2, 3);
    expect(sc.tread).toBeCloseTo(3.4 / 14, 5);
    expect(sc.blondel).toBeCloseTo(2 * sc.risePerStep + sc.tread, 6);
    expect(sc.comfort).toBeCloseTo(sc.risePerStep + sc.tread, 6);
    // 2h + s = 643 при пределе 650; h + s = 443 при 450
    expect(sc.blondelOk).toBe(true);
    expect(sc.comfortOk).toBe(true);
  });

  it('формулы выполняются на эталонном марше 170 × 290', () => {
    const sc = stairCheck({ ...STAIR, totalRise: 2.89, risers: 17, tread: 0.29 });
    expect(sc.blondelOk).toBe(true); // 2×170 + 290 = 630
    expect(sc.comfortOk).toBe(true); // 170 + 290 = 460 ≈ 450
    expect(sc.angleOk).toBe(true);
    // ...но такой марш требует проекции 4,64 м, а её здесь нет
    expect(sc.fits).toBe(false);
  });

  it('предлагаемый марш держит по метру снизу и сверху', () => {
    expect(INNER_D - (STAIR.y + STAIR.length)).toBeGreaterThanOrEqual(STAIR.minApproach);
    expect(STAIR.y).toBeGreaterThanOrEqual(STAIR.minLanding);
  });
});

describe('stairOptions — подбор марша', () => {
  it('заход и площадка по метру оставляют на марш 3,5 м', () => {
    expect(stairOptions(STAIR, INNER_D).maxRun).toBeCloseTo(3.5, 6);
  });

  it('с 15 подступенками комфортная проступь достижима', () => {
    const env = stairEnvelope(STAIR, INNER_D);
    expect(env.maxTread).toBeGreaterThan(0.23);
    expect(env.comfortReachable).toBe(true);
  });

  it('а с прежними 17 — была недостижима', () => {
    const env = stairEnvelope({ ...STAIR, risers: 17 }, INNER_D);
    expect(env.maxTread).toBeLessThan(0.23);
    expect(env.comfortReachable).toBe(false);
  });

  it('находит вариант, проходящий по всем пяти критериям', () => {
    const { best } = stairOptions(STAIR, INNER_D);
    expect(best.allOk).toBe(true);
    expect(best.passed).toBe(5);
    // 3000 мм подъёма 15 подступенками: 200 × 250, угол 38,7°
    expect(best.risers).toBe(15);
    expect(best.risePerStep * 1000).toBeCloseTo(200, 1);
    expect(best.tread * 1000).toBeCloseTo(250, 1);
  });

  it('при 3000 мм подъёма лучший вариант упирается в границы норм', () => {
    const { best } = stairOptions(STAIR, INNER_D);
    // Высота ступени ровно 200 и 2h + s ровно 650 — запаса нет
    expect(best.riseTight).toBe(true);
    expect(best.blondelTight).toBe(true);
  });

  it('подъём пола на 100 мм уводит лестницу от границ', () => {
    // Уровень пола задаётся засыпкой, поэтому это реальный рычаг
    const { best } = stairOptions({ ...STAIR, totalRise: 2.9 }, INNER_D);
    expect(best.allOk).toBe(true);
    expect(best.risers).toBe(15);
    expect(best.risePerStep * 1000).toBeCloseTo(193.3, 1);
    expect(best.riseTight).toBe(false);
    expect(best.blondelTight).toBe(false);
  });

  it('лучший вариант укладывается в обе формулы', () => {
    const { best } = stairOptions(STAIR, INNER_D);
    expect(best.blondel * 1000).toBeGreaterThanOrEqual(600);
    expect(best.blondel * 1000).toBeLessThanOrEqual(650);
    expect(Math.abs(best.comfort - 0.45)).toBeLessThanOrEqual(0.02);
    expect(best.angleDeg).toBeLessThanOrEqual(40);
  });

  it('принятый марш уже не хуже лучшего из подбора', () => {
    const { best } = stairOptions(STAIR, INNER_D);
    const sc = stairCheck(STAIR);
    const now = [sc.riseOk, sc.treadOk, sc.blondelOk, sc.comfortOk, sc.angleOk].filter(Boolean).length;
    expect(now).toBeGreaterThanOrEqual(best.passed);
  });
});
