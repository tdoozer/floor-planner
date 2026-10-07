import { describe, expect, it } from 'vitest';

import { WORKTOP, buildWorktop } from '../worktop.js';
import { CLEAR_HEIGHT, makeInitialProject } from '../project.js';
import { boundingBox, getFixture } from '../fixtures.js';
import { runRules } from '../../calc/rules.js';
import { worktopSlab } from '../../calc/scene3d.js';

const p = makeInitialProject();
const w = buildWorktop(p.layout, p.equipment);

describe('контур столешницы', () => {
  it('начинается от холодильника, а не от края стены', () => {
    const fridge = p.equipment.find((e) => e.id === 'eq-fridge');
    // Холодильник 2 м высотой — он полноростовой и под столешницу не уходит
    expect(w.tall.map((t) => t.id)).toContain('eq-fridge');
    expect(w.polygon[0].x).toBeCloseTo(fridge.x + 0.6, 2);
  });

  it('верхняя ветка доходит до перегородки санузла', () => {
    expect(w.polygon[1].x).toBeCloseTo(p.layout.bathX, 6);
  });

  it('вертикальная ветка кончается вместе с перегородкой', () => {
    const maxY = Math.max(...w.polygon.map((q) => q.y));
    expect(maxY).toBeCloseTo(p.layout.bathY, 6);
  });

  it('контур — буква Г из шести точек, а не прямоугольник', () => {
    expect(w.polygon).toHaveLength(6);
    expect(w.area).toBeGreaterThan(2);
    expect(w.area).toBeLessThan(3);
  });

  it('глубина 600 по обеим веткам', () => {
    expect(w.depth).toBe(0.6);
    // ширина вертикальной ветки
    expect(w.polygon[1].x - w.polygon[4].x).toBeCloseTo(0.6, 6);
  });
});

describe('приборы относительно плиты', () => {
  it('врезаются только мойка и варочная панель', () => {
    const ids = w.cutouts.map((c) => c.id).sort();
    expect(ids).toEqual(['eq-hob', 'eq-sink']);
  });

  it('вырез мойки — прямоугольник 600 без поворота', () => {
    // Мойка стала линейной: угловой модуль под 45° уступил место
    // правильному порядку зон и крану под глухой створкой окна.
    const sink = w.cutouts.find((c) => c.id === 'eq-sink');
    expect(sink.rotation).toBe(0);
    expect(sink.w).toBe(0.6);
    expect(sink.d).toBe(0.6);
  });

  it('но поворот выреза модуль по-прежнему умеет отдавать', () => {
    // габарит НЕ повёрнутый: крутит его рендер, иначе вырез раздуется
    const turned = buildWorktop(p.layout, p.equipment.map((e) =>
      e.id === 'eq-sink' ? { ...e, catalogId: 'sink_corner', rotation: 45 } : e));
    const sink = turned.cutouts.find((c) => c.id === 'eq-sink');
    expect(sink.rotation).toBe(45);
    expect(sink.w).toBe(0.9);
    expect(sink.d).toBe(0.6);
  });

  it('духовой шкаф и посудомойка стоят ПОД плитой', () => {
    const ids = w.beneath.map((b) => b.id);
    expect(ids).toContain('eq-oven');
    expect(ids).toContain('eq-dishwasher');
  });

  it('корпуса шкафов в проверку просвета не идут — они подстраиваются', () => {
    expect(w.beneath.map((b) => b.id)).not.toContain('eq-store1');
    expect(w.carcasses.map((c) => c.id)).toContain('eq-store1');
    expect(w.carcasses[0].height).toBeCloseTo(WORKTOP.top - WORKTOP.thickness, 6);
  });

  it('духовому шкафу просвета хватает', () => {
    expect(w.beneath.find((b) => b.id === 'eq-oven').fits).toBe(true);
  });

  // При плите 60 мм просвет был 840 и прибор в 850 не входил.
  // Толщина 40 сняла вопрос: 860 против 850.
  it('посудомойка проходит под плитой 40 мм', () => {
    const dw = w.beneath.find((b) => b.id === 'eq-dishwasher');
    expect(dw.fits).toBe(true);
    expect(dw.margin * 1000).toBeCloseTo(10, 0);
  });

  it('на прежних 60 мм она бы не прошла', () => {
    const thick = buildWorktop(p.layout, p.equipment, { ...WORKTOP, thickness: 0.06 });
    const dw = thick.beneath.find((b) => b.id === 'eq-dishwasher');
    expect(dw.fits).toBe(false);
    expect(-dw.margin * 1000).toBeCloseTo(10, 0);
  });
});

describe('правила и сцена', () => {
  const warnings = runRules(p, CLEAR_HEIGHT);

  it('претензии к просвету больше нет', () => {
    expect(warnings.find((x) => x.id === 'worktop-clearance')).toBeUndefined();
  });

  it('но правило живо: утолщение плиты его вернёт', () => {
    const thick = makeInitialProject();
    thick.equipment = thick.equipment.map((e) =>
      e.id === 'eq-dishwasher' ? { ...e, y: 0.06 } : e
    );
    // прибор 850 против просвета 860 — запас 10 мм, границу видно
    const dw = buildWorktop(thick.layout, thick.equipment)
      .beneath.find((b) => b.id === 'eq-dishwasher');
    expect(dw.clearance * 1000).toBe(860);
    expect(dw.margin * 1000).toBeCloseTo(10, 0);
  });

  it('фронт и масса плиты выводятся справкой', () => {
    const r = warnings.find((x) => x.id === 'worktop-front');
    expect(r).toBeDefined();
    expect(r.detail).toContain('мойка');
  });

  it('в сцену плита попадает с вырезами и на своей отметке', () => {
    const slab = worktopSlab(p.layout, p.equipment);
    expect(slab.cutouts).toHaveLength(2);
    expect(slab.top).toBe(WORKTOP.top);
    expect(slab.bottom).toBeCloseTo(WORKTOP.top - WORKTOP.thickness, 6);
  });

  it('без кухонных приборов столешницы не возникает из воздуха', () => {
    expect(buildWorktop(p.layout, [])).toBeNull();
  });
});

describe('кухня после перехода на посудомойку 450', () => {
  const proj = makeInitialProject();
  const box = (id) => {
    const e = proj.equipment.find((x) => x.id === id);
    return { ...boundingBox(e), spec: getFixture(e.catalogId) };
  };

  it('посудомойка узкая — 450 вместо 600', () => {
    expect(proj.equipment.find((e) => e.id === 'eq-dishwasher').catalogId)
      .toBe('dishwasher45');
    expect(box('eq-dishwasher').w).toBeCloseTo(0.45, 3);
  });

  it('фронт уехал влево ровно на высвободившиеся 150', () => {
    expect(box('eq-sink').x).toBeCloseTo(1.11, 3);
    expect(box('eq-hob').x).toBeCloseTo(2.61, 3);
  });

  // Ради этого всё и двигалось: ручки у газовой панели справа,
  // и тянуться к ним через угол не надо
  it('справа от панели стало 490 вместо 340', () => {
    const hob = box('eq-hob');
    expect((proj.layout.bathX - (hob.x + hob.w)) * 1000).toBeCloseTo(490, 0);
  });

  it('разделочная зона осталась 900', () => {
    const sink = box('eq-sink');
    expect((box('eq-hob').x - (sink.x + sink.w)) * 1000).toBeCloseTo(900, 0);
  });

  it('кран мойки ушёл глубже под глухую створку', () => {
    const win = proj.openings.find((o) => o.id === 'win-n1');
    const gap = (win.start + win.len / 2 - box('eq-sink').cx) * 1000;
    expect(gap).toBeCloseTo(240, 0);
  });

  it('над панелью шкаф с встроенной вытяжкой, низ на 1650', () => {
    const hood = box('eq-wall2');
    expect(hood.spec.id).toBe('wall_cabinet_hood');
    expect(hood.spec.mountHeight).toBe(1.65);
    // верх совпадает с обычными шкафами: 1650 + 470 = 1400 + 720
    expect(hood.spec.mountHeight + hood.spec.h)
      .toBeCloseTo(getFixture('wall_cabinet').mountHeight + getFixture('wall_cabinet').h, 6);
  });

  it('навесные на перегородке больше не лезут в санузел', () => {
    ['eq-wall3', 'eq-wall4'].forEach((id) => {
      const b = box(id);
      expect(b.x + b.w).toBeLessThanOrEqual(proj.layout.bathX + 1e-6);
    });
  });
});
