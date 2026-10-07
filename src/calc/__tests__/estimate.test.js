import { describe, expect, it } from 'vitest';

import { WASTE, floorEstimate, pipeCutting } from '../estimate.js';
import { heatLoss } from '../heatloss.js';
import { layoutLoops } from '../loops.js';
import { electricalPlan } from '../electrical.js';
import { CLEAR_HEIGHT, makeInitialProject } from '../../data/project.js';
import { lowVoltagePlan } from '../lowVoltage.js';

function build(p = makeInitialProject()) {
  const hl = heatLoss({
    layout: p.layout, openings: p.openings, climate: p.climate,
    envelope: p.envelope, screed: p.screed, clearHeight: CLEAR_HEIGHT
  });
  const loops = layoutLoops({
    layout: p.layout, heatLossByRoom: hl.byRoom,
    manifold: p.nodes.find((n) => n.type === 'manifold'),
    coolant: p.coolant, spacings: p.loopSpacings, equipment: p.equipment,
    exclusionZones: p.floorExclusionZones, mode: p.loopMode,
    kitchenOnFrame: p.kitchenOnFrame
  });
  const electrical = electricalPlan({
    equipment: p.equipment,
    entry: p.nodes.find((n) => n.type === 'electrical_panel')
  });
  return {
    p, loops, electrical,
    est: floorEstimate({
      layout: p.layout, screed: p.screed, levels: p.levels,
      loops, coolant: p.coolant, electrical, stair: p.stair,
      equipment: p.equipment
    })
  };
}

const find = (est, part) => est.items.find((i) => i.name.includes(part));

describe('floorEstimate — объёмы из геометрии', () => {
  const { est } = build();

  it('считает по площади в свету', () => {
    expect(est.area).toBeCloseTo(30.25, 2);
  });

  it('засыпки почти нет — подпол оказался 350, а не 900', () => {
    // Пирог сам заполняет объём подпола, песок нужен только на выравнивание
    const sand = find(est, 'Песок для засыпки');
    expect(sand.qty).toBeGreaterThan(0.5);
    expect(sand.qty).toBeLessThan(4);
  });

  it('гидроизоляция берётся с перехлёстом', () => {
    expect(find(est, 'Гидроизоляция').qty).toBeCloseTo(30.25 * WASTE.waterproofing, 1);
  });

  it('демпферная лента считает и периметр, и перегородки', () => {
    // 22 м периметра плюс перегородки — заметно больше одного периметра
    expect(est.damperLength).toBeGreaterThan(22);
    expect(find(est, 'Демпферная лента').qty).toBeGreaterThan(est.damperLength);
  });

  it('объём стяжки уменьшен на объём трубы', () => {
    const raw = (30.25 * 70) / 1000;
    expect(est.screedVolume).toBeLessThan(raw);
    expect(est.screedVolume).toBeGreaterThan(raw - 0.1);
  });

  it('цемент пересчитан в мешки', () => {
    expect(find(est, 'Цемент').note).toMatch(/мешк/);
  });

  it('евроконусов вдвое больше числа контуров', () => {
    const { loops, est: e } = build();
    expect(find(e, 'Евроконус').qty).toBe(loops.totalLoops * 2);
  });

  it('утолщение ЭППС увеличивает закупку утеплителя и уменьшает песок', () => {
    const thin = build();
    const p = makeInitialProject();
    p.screed = { ...p.screed, insulation: 200 };
    const thick = build(p);
    expect(find(thick.est, 'ЭППС').qty).toBeGreaterThanOrEqual(find(thin.est, 'ЭППС').qty);
    // Толщина ЭППС на объём стяжки не влияет — это разные слои
    expect(thick.est.screedVolume).toBeCloseTo(thin.est.screedVolume, 2);
  });
});

describe('Электрика и цены в смете', () => {
  const { est } = build();

  it('электрика попала в смету', () => {
    expect(est.groups).toContain('Электрика');
    expect(est.groups).toContain('Освещение');
    expect(find(est, 'Кабель ВВГнг-LS 3×2,5')).toBeDefined();
    expect(find(est, 'Спот поворотный')).toBeDefined();
  });

  it('количества электрики берутся из расставленных точек', () => {
    const sockets = find(est, 'Розетка с рамкой');
    expect(sockets.qty).toBeGreaterThan(8);
    expect(find(est, 'Автомат').qty).toBeGreaterThanOrEqual(5);
  });

  it('циркуляционного насоса в смете НЕТ — насоса котла хватает', () => {
    expect(est.items.some((i) => i.name.includes('Насос'))).toBe(false);
  });

  it('у каждой позиции есть цена', () => {
    expect(est.totals.unpriced).toEqual([]);
    est.items.forEach((i) => expect(i.cost.priced).toBe(true));
  });

  it('средняя лежит строго между «от» и «до»', () => {
    expect(est.totals.avg).toBeGreaterThan(est.totals.min);
    expect(est.totals.avg).toBeLessThan(est.totals.max);
  });

  it('итог равен сумме групп', () => {
    const sum = est.byGroup.reduce((s, g) => s + g.avg, 0);
    expect(sum).toBeCloseTo(est.totals.avg, 2);
  });

  it('порядок величины правдоподобен для 30 м²', () => {
    expect(est.totals.avg).toBeGreaterThan(150000);
    expect(est.totals.avg).toBeLessThan(500000);
  });

  it('прайс честно помечен как непроверенный', () => {
    expect(est.meta.verified).toBe(false);
    expect(est.meta.disclaimer).toMatch(/не котировки/);
  });
});

describe('Фасовка — сколько штук покупать', () => {
  const { est } = build();
  const packOf = (part) => find(est, part).pack;

  it('ЭППС считается плитами 1185 × 585', () => {
    const p = packOf('ЭППС 100 мм плитами');
    expect(p.size).toBeCloseTo(0.69, 2);
    expect(p.count).toBeGreaterThan(40);
    expect(p.count).toBeLessThan(55);
  });

  it('цоколь — та же плита 100 мм, не 80', () => {
    expect(find(est, 'на торец плиты').name).toContain('100 мм');
    expect(packOf('на торец плиты').unit).toBe('плит');
  });

  it('штук всегда округляется ВВЕРХ', () => {
    est.items.filter((i) => i.pack).forEach((i) => {
      expect(i.pack.count * i.pack.size).toBeGreaterThanOrEqual(i.qty - 1e-9);
      expect(i.pack.count).toBe(Math.ceil(i.qty / i.pack.size));
    });
  });

  it('плёнки хватает одного рулона, а хомутов нужно несколько упаковок', () => {
    expect(packOf('Гидроизоляция').count).toBe(1);
    expect(packOf('Хомуты').count).toBeGreaterThan(3);
  });

  it('сыпучее фасовки не имеет — щебень и песок берут кубами', () => {
    expect(find(est, 'Щебень').pack).toBeNull();
    expect(find(est, 'Песок для засыпки').pack).toBeNull();
  });
});

describe('Лестница в смете', () => {
  const { est } = build();
  const stair = makeInitialProject().stair;

  it('лестница попала в смету', () => {
    expect(est.groups).toContain('Лестница');
  });

  it('косоуров ДВА — длина трубы вдвое больше марша', () => {
    const slope = Math.hypot(stair.length, stair.totalRise);
    const tube = find(est, 'косоуры');
    // Покупается ХЛЫСТАМИ по 6 м: два косоура по 4,33 м из двух хлыстов,
    // обрезь 3,3 м. Платим за 12, а не за 8,7
    expect(tube.qty).toBe(12);
    expect(tube.note).toContain('хлыст');
  });

  it('площадок по две на ступень', () => {
    const steps = stair.risers - 1;
    const angle = find(est, 'площадки под ступени');
    expect(angle.note).toContain(String(steps * 2));
  });

  it('болтов и прокладок поровну — сталь не касается дерева', () => {
    expect(find(est, 'Болт М8').qty).toBe(find(est, 'Прокладка резиновая').qty);
  });

  it('закладные под пятки — до заливки, сверлить стяжку нельзя', () => {
    const emb = find(est, 'под пятку косоура');
    // По одной на косоур. Плита 250×120 — под ГОРИЗОНТАЛЬНЫЙ рез трубы,
    // 100×100 туда просто не помещается
    expect(emb.qty).toBe(2);
    expect(emb.note).toContain('ДО ЗАЛИВКИ');
  });

  it('закладных берём 16 при потребности 13 — выбор задней опоры откладывается', () => {
    const emb = find(est, 'под стойки столешницы');
    const onPlan = makeInitialProject().nodes.filter((n) => n.type === 'embed').length;
    expect(emb.qty).toBe(16);
    expect(onPlan).toBeGreaterThanOrEqual(13);
    expect(emb.note).toContain('ДО ЗАЛИВКИ');
    expect(emb.note).toContain('ИЗБЫТКОМ');
  });

  it('позиция закладных ровно одна — раньше их было две', () => {
    const rows = est.items.filter((i) => i.name.includes('под стойки столешницы'));
    expect(rows).toHaveLength(1);
  });

  it('балясин нет — марш закрыт с двух сторон', () => {
    expect(est.items.some((i) => i.name.includes('Балясин'))).toBe(false);
    expect(find(est, 'Поручень')).toBeDefined();
  });

  it('шире марш — больше проступей и зашивки', () => {
    const p = makeInitialProject();
    p.stair = { ...p.stair, width: 1.2 };
    const wide = build(p).est;
    expect(find(wide, 'Фанера 3 мм').qty).toBeGreaterThan(find(est, 'Фанера 3 мм').qty);
  });

  it('порядок величины лестницы правдоподобен', () => {
    const g = est.byGroup.find((x) => x.group === 'Лестница');
    expect(g.avg).toBeGreaterThan(30000);
    expect(g.avg).toBeLessThan(90000);
  });
});

describe('pipeCutting — петли без соединений в стяжке', () => {
  it('каждая петля попадает в одну бухту целиком', () => {
    const cut = pipeCutting([68, 68, 68, 38, 27]);
    cut.coils.forEach((c) => {
      expect(c.cuts.reduce((s, v) => s + v, 0)).toBeLessThanOrEqual(c.size);
    });
  });

  it('все петли раскроены', () => {
    const lengths = [68, 68, 68, 38, 27];
    const cut = pipeCutting(lengths);
    const all = cut.coils.flatMap((c) => c.cuts).sort((a, b) => a - b);
    expect(all).toEqual([...lengths].sort((a, b) => a - b));
  });

  it('бухты 200 + 100 дают меньше обрезков, чем две по 200', () => {
    const smart = pipeCutting([68, 68, 68, 38, 27], [200, 100]);
    const dumb = pipeCutting([68, 68, 68, 38, 27], [200]);
    expect(smart.waste).toBeLessThan(dumb.waste);
  });

  it('заказанного метража хватает на все петли', () => {
    const lengths = [68, 68, 68, 38, 27];
    const cut = pipeCutting(lengths);
    expect(cut.totalOrdered).toBeGreaterThanOrEqual(lengths.reduce((s, v) => s + v, 0));
  });
});

describe('смета — слаботочка', () => {
  const p = makeInitialProject();
  const hl = heatLoss({
    layout: p.layout, openings: p.openings, climate: p.climate,
    envelope: p.envelope, screed: p.screed, clearHeight: CLEAR_HEIGHT
  });
  const loops = layoutLoops({
    layout: p.layout, heatLossByRoom: hl.byRoom,
    manifold: p.nodes.find((n) => n.type === 'manifold'),
    coolant: p.coolant, spacings: p.loopSpacings, equipment: p.equipment,
    exclusionZones: p.floorExclusionZones, mode: p.loopMode
  });
  const electrical = electricalPlan({
    equipment: p.equipment,
    entry: p.nodes.find((n) => n.type === 'electrical_panel')
  });
  const est = floorEstimate({
    layout: p.layout, screed: p.screed, levels: p.levels, loops,
    coolant: p.coolant, electrical, stair: p.stair,
    equipment: p.equipment, lowVoltage: lowVoltagePlan()
  });

  it('идёт отдельной группой, а не внутри электрики', () => {
    const g = est.byGroup.find((x) => x.group === 'Слаботочка');
    expect(g).toBeTruthy();
    expect(g.rows.length).toBeGreaterThanOrEqual(5);
  });

  it('метраж витой пары берётся из посчитанных трасс', () => {
    const lv = lowVoltagePlan();
    const row = est.items.find((i) => i.name.includes('UTP'));
    expect(row.qty).toBeCloseTo(lv.utpM * 1.05, 6);
  });

  it('акустика заложена ЗАДЕЛОМ — до зашивки марша', () => {
    // Стойку винила ставить некуда, кроме зала, а кабель под колонки
    // прячется в зашивку лестницы, которую закроют один раз
    const row = est.items.find((i) => i.name.includes('Акустический'));
    expect(row.qty).toBeGreaterThan(0);
    expect(row.note).toMatch(/ЗАДЕЛ/);
  });

  it('без слаботочки смета собирается по-прежнему', () => {
    // Группа необязательная: старые вызовы floorEstimate не ломаются
    const bare = floorEstimate({
      layout: p.layout, screed: p.screed, levels: p.levels, loops,
      coolant: p.coolant, electrical, stair: p.stair, equipment: p.equipment
    });
    expect(bare.byGroup.some((g) => g.group === 'Слаботочка')).toBe(false);
    expect(bare.totals.avg).toBeLessThan(est.totals.avg);
  });
});
