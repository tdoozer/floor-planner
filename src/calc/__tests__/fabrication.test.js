import { describe, expect, it } from 'vitest';

import {
  STAIR_FAB,
  WORKTOP_FAB,
  backSupportOptions,
  slabThicknessOptions,
  stairFabrication,
  worktopFabrication
} from '../fabrication.js';
import { makeInitialProject } from '../../data/project.js';
import { buildWorktop } from '../../data/worktop.js';

const p = makeInitialProject();
const s = stairFabrication(p.stair);
const w = buildWorktop(p.layout, p.equipment);
const f = worktopFabrication(w, p.screed);

describe('лестница: марш', () => {
  it('подступенок 200, проступь 243, угол 39,5°', () => {
    expect(s.rise).toBeCloseTo(200, 6);
    expect(s.going).toBeCloseTo(242.857, 2);
    expect(s.angleDeg).toBeCloseTo(39.5, 1);
  });

  it('ступеней на одну меньше подступенков', () => {
    expect(s.treads).toBe(p.stair.risers - 1);
  });

  it('подъём по линии носков меньше полного — последний подступенок выходит на площадку', () => {
    expect(s.nosingRise).toBe(2800);
    expect(s.nosingRise).toBeLessThan(p.stair.totalRise * 1000);
  });
});

describe('лестница: косынки', () => {
  // Ключевая мысль чертежа: прямая труба под ступенчатой поверхностью
  // ОСТАВЛЯЕТ треугольные пустоты, и катеты этих треугольников —
  // ровно проступь и подступенок. Их не выдумывают, они следуют из марша.
  it('катеты треугольника равны проступи и подступенку', () => {
    expect(s.gusset.base).toBeCloseTo(s.going, 6);
    expect(s.gusset.height).toBeCloseTo(s.rise, 6);
  });

  it('гипотенуза ложится на грань трубы', () => {
    expect(s.gusset.hyp).toBeCloseTo(Math.hypot(s.going, s.rise), 6);
    // угол гипотенузы = углу марша
    expect((Math.atan(s.gusset.height / s.gusset.base) * 180) / Math.PI).toBeCloseTo(s.angleDeg, 6);
  });

  it('по одной косынке на ступень на каждый косоур', () => {
    expect(s.gusset.count).toBe(s.treads * STAIR_FAB.stringerCount);
    expect(s.gusset.count).toBe(28);
  });

  it('лист режется меньше квадратного метра', () => {
    expect(s.gusset.areaM2).toBeGreaterThan(0.6);
    expect(s.gusset.areaM2).toBeLessThan(0.8);
  });
});

describe('лестница: косоур', () => {
  it('верхняя грань трубы опущена на проступь плюс полку уголка', () => {
    expect(s.faceDrop).toBe(STAIR_FAB.treadT + STAIR_FAB.platform.t);
  });

  it('пятка отнесена от начала марша — иначе труба ушла бы в пол', () => {
    expect(s.footX).toBeGreaterThan(200);
    expect(s.footX).toBeLessThan(300);
  });

  it('рез длиннее проекции и короче хлыста 6 м', () => {
    expect(s.stringers.cutLen).toBeGreaterThan(s.run);
    expect(s.stringers.cutLen).toBeLessThan(6000);
    expect(s.stockBars).toBe(2);
  });

  it('свес ступени за косоур одинаков с двух сторон', () => {
    expect(s.overhang).toBe((STAIR_FAB.treadWidth - STAIR_FAB.gauge) / 2);
    expect(s.overhang).toBe(150);
  });
});

describe('столешница: каркас', () => {
  it('низ плиты на 860, стойка длиннее на толщину плитки', () => {
    // Плита 40 мм: 900 − 40 = 860. Закладная утоплена заподлицо со стяжкой,
    // плитка ляжет поверх — стойка длиннее ровно на её толщину.
    expect(f.underside).toBe(860);
    expect(f.embedLevel).toBe(-p.screed.finishThickness);
    expect(f.postLen).toBe(860 + p.screed.finishThickness);
  });

  it('задняя кромка тоже на стойках — от одной линии плита консолилась бы', () => {
    expect(f.backPosts).toBeGreaterThan(0);
    expect(f.posts).toBe(f.frontPosts + f.backPosts);
    expect(f.embed.count).toBe(f.posts);
  });

  // Сзади стойка ничему не мешает, но и часто ставить её незачем:
  // считать надо прогиб СВЯЗКИ уголка с плитой, а не голого уголка
  it('сзади стоек меньше и шаг вдвое реже, чем спереди', () => {
    expect(f.backPitch).toBe(f.framePitch * 2);
    expect(f.backPosts).toBeLessThan(f.frontPosts);
  });

  it('на редком шаге держит бетон, а не уголок', () => {
    const opts = backSupportOptions(w, p.screed);
    const sparse = opts.options.find((o) => o.id === 'sparse');
    expect(sparse.ok).toBe(true);
    // голый уголок прогнулся бы заметно, вместе с плитой — нет
    expect(sparse.deflAngleMm).toBeGreaterThan(1);
    expect(sparse.deflCombinedMm).toBeLessThan(0.3);
  });

  it('пристенный уголок держит по газобетону, но не по гипсокартону', () => {
    const opts = backSupportOptions(w, p.screed);
    const led = opts.options.find((o) => o.id === 'ledger');
    expect(led.ledger.ok).toBe(true);
    expect(led.ledger.safety).toBeGreaterThan(3);
    // вдоль перегородки санузла стойки остаются в любом случае
    expect(led.posts).toBeGreaterThan(0);
    expect(led.ledger.sideBranchM).toBeGreaterThan(1);
  });

  it('шаг 600 сзади проходит с запасом, но это перерасход', () => {
    const opts = backSupportOptions(w, p.screed);
    const dense = opts.options.find((o) => o.id === 'dense');
    expect(dense.ok).toBe(true);
    expect(dense.posts).toBeGreaterThan(
      opts.options.find((o) => o.id === 'sparse').posts
    );
  });

  it('рам хватает на весь фронт с шагом 600', () => {
    expect((f.frames - 1) * WORKTOP_FAB.framePitch).toBeGreaterThanOrEqual(w.runM * 1000 - 600);
    expect(f.frames).toBe(8);
  });

  it('поперечина короче глубины на отступы от краёв', () => {
    expect(f.crossLen).toBe(w.depth * 1000 - 2 * WORKTOP_FAB.edgeInset);
  });

  it('стойки съедают больше металла, чем сама рама', () => {
    expect(f.postM).toBeGreaterThan(f.crossM);
    expect(f.angleTotalM).toBeCloseTo(f.longitudinalM + f.crossM + f.postM, 6);
  });

  it('нагрузка на стойку невелика — считаные килограммы', () => {
    expect(f.loadPerPostKg).toBeLessThan(40);
  });

  it('без столешницы модуль молчит, а не падает', () => {
    expect(worktopFabrication(null, p.screed)).toBeNull();
  });
});

describe('закладные под столешницу', () => {
  const embeds = p.nodes.filter((n) => n.type === 'embed');

  it('их хватает на все стойки', () => {
    expect(embeds.length).toBeGreaterThanOrEqual(f.posts);
  });

  it('есть и передняя линия, и задняя у стены', () => {
    const back = embeds.filter((e) => e.y < 0.2);
    const front = embeds.filter((e) => e.y >= 0.2 && e.y < 0.6);
    expect(back.length).toBeGreaterThanOrEqual(6);
    expect(front.length).toBeGreaterThanOrEqual(6);
  });

  it('задняя линия начинается от правой грани холодильника', () => {
    const first = p.nodes.find((n) => n.id === 'emb-b1');
    expect(first.x).toBeCloseTo(0.66, 6);
  });
});


describe('лестница: верхний узел', () => {
  const t = s.topNode;

  it('косоур кончается РОВНО на кромке проёма', () => {
    // последняя ступень — это сам пол мансарды, заводить трубу дальше
    // некуда: под перекрытием она ни на что не опирается
    expect(STAIR_FAB.topAllowance).toBe(0);
    expect(s.stringers.cutLen).toBeLessThan(s.run / Math.cos((s.angleDeg * Math.PI) / 180) + 20);
  });

  it('верх трубы ниже чистого пола ровно на последний подступенок с проступью', () => {
    expect(t.dropUnderFloor).toBeCloseTo(200 + 43 + 5, 6);
    expect(t.faceTop).toBeCloseTo(2752, 0);
  });

  it('торцом к лаге косоур не пришить — он приходит ниже её', () => {
    expect(t.directToJoist).toBe(false);
    expect(t.joistBottom).toBeGreaterThan(t.faceTop);
  });

  it('разрыв закрывает кронштейн от низа трубы до верха лаги', () => {
    expect(t.bracketH).toBeGreaterThan(300);
    expect(t.bracketH).toBeLessThan(400);
    expect(t.boltSize).toBe('М12');
  });

  it('высота лаги честно помечена как незамеренная', () => {
    expect(t.joistConfirmed).toBe(false);
  });
});

describe('толщина плиты столешницы', () => {
  const opts = slabThicknessOptions({ worktop: w });
  const at = (t) => opts.find((o) => o.t === t);

  it('поле плиты не решает ничего — оно проходит при любой толщине', () => {
    opts.forEach((o) => expect(o.fieldOk).toBe(true));
  });

  // Вот из-за чего обычно и делают 60: полоса 75 мм между вырезом мойки
  // и кромкой, если под ней ничего нет, ломается при первом облокачивании.
  it('свободная перемычка у выреза проходит только на 60', () => {
    expect(at(40).stripOkFree).toBe(false);
    expect(at(60).stripOkFree).toBe(true);
  });

  it('но у нас продольный уголок идёт ПОД перемычкой — пролёта нет', () => {
    opts.forEach((o) => expect(o.stripOkFramed).toBe(true));
    expect(at(40).stripFramedMPa).toBeLessThan(at(40).stripFreeMPa / 50);
  });

  it('30 мм отпадает: на арматуру не остаётся ничего', () => {
    expect(at(30).barMm).toBeLessThanOrEqual(0);
    expect(at(30).barOk).toBe(false);
  });

  it('на 40 мм под сетку остаётся 10 — Ø4 влезает, Ø6 нет', () => {
    expect(at(40).barMm).toBe(10);
    expect(at(40).barOk).toBe(true);
  });

  it('40 мм пускает посудомойку под столешницу, а 60 — нет', () => {
    expect(at(40).underMm).toBe(860);
    expect(at(40).applianceFits).toBe(true);
    expect(at(60).underMm).toBe(840);
    expect(at(60).applianceFits).toBe(false);
  });

  it('принятая толщина — 40, и она снимает конфликт с посудомойкой', () => {
    expect(w.thickness).toBe(0.04);
    expect(w.beneath.every((b) => b.fits)).toBe(true);
  });

  it('плита полегчала со 366 до 244 кг', () => {
    expect(at(60).massKg).toBeCloseTo(366, 0);
    expect(at(40).massKg).toBeCloseTo(244, 0);
  });
});
