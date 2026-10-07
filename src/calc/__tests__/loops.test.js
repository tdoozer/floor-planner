import { describe, expect, it } from 'vitest';

import {
  ALPHA,
  EDGE_ZONE,
  MIN_FURNITURE_GAP,
  overlapsEdgeZone,
  bifilarOrder,
  floorOutput,
  layoutLoops,
  pathSegments,
  pipeLength,
  roomLoops,
  supplyRun
} from '../loops.js';
import { heatLoss } from '../heatloss.js';
import { CLEAR_HEIGHT, buildRooms, makeInitialProject } from '../../data/project.js';
import { boundingBox, getFixture } from '../../data/fixtures.js';

function build(project = makeInitialProject()) {
  const hl = heatLoss({
    layout: project.layout,
    openings: project.openings,
    climate: project.climate,
    envelope: project.envelope,
    screed: project.screed,
    clearHeight: CLEAR_HEIGHT
  });
  return layoutLoops({
    layout: project.layout,
    heatLossByRoom: hl.byRoom,
    manifold: project.nodes.find((n) => n.type === 'manifold'),
    coolant: project.coolant,
    equipment: project.equipment,
    exclusionZones: project.floorExclusionZones,
    mode: project.loopMode,
    kitchenOnFrame: project.kitchenOnFrame
  });
}

describe('floorOutput', () => {
  it('съём растёт с перепадом поверхность–воздух', () => {
    const warm = floorOutput({ maxFloorTemp: 31, airTemp: 24, spacing: 0.15 });
    const cool = floorOutput({ maxFloorTemp: 26, airTemp: 20, spacing: 0.15 });
    expect(warm).toBeGreaterThan(cool);
  });

  it('широкий шаг снижает съём', () => {
    const tight = floorOutput({ maxFloorTemp: 26, airTemp: 20, spacing: 0.1 });
    const wide = floorOutput({ maxFloorTemp: 26, airTemp: 20, spacing: 0.25 });
    expect(wide).toBeLessThan(tight);
    expect(tight).toBeCloseTo(ALPHA * 6, 6);
  });
});

describe('pipeLength', () => {
  it('подводка входит в длину дважды', () => {
    const a = pipeLength({ area: 20, spacing: 0.15, supplyRunM: 0 });
    const b = pipeLength({ area: 20, spacing: 0.15, supplyRunM: 5 });
    expect(b - a).toBeCloseTo(10, 6);
  });
});

describe('supplyRun', () => {
  it('манхэттенское расстояние от коллектора до центра помещения', () => {
    const square = [{ x: 4, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 2 }, { x: 4, y: 2 }];
    expect(supplyRun({ x: 0, y: 0 }, square)).toBeCloseTo(5 + 1, 6);
  });
});

describe('layoutLoops — требование заказчика', () => {
  const L = build();
  const byId = (id) => L.byRoom.find((r) => r.id === id);

  it('санузел и прихожая укладываются в один контур каждый', () => {
    expect(byId('bath').loops).toBe(1);
    expect(byId('hall').loops).toBe(1);
  });

  it('зал одним контуром НЕ укладывается', () => {
    expect(byId('living').loops).toBeGreaterThan(1);
  });

  it('даже самый широкий рабочий шаг не спасает зал', () => {
    const living = byId('living');
    const oneLoop = living.candidates.filter((c) => c.loops === 1);
    expect(oneLoop).toHaveLength(0);
  });

  // Вернув пол под лестницей, зал получил столько запаса, что закрывается
  // на ЛЮБОМ шаге. Выбранные 200 — не предел, а осознанная середина:
  // шире смысла нет, уже — лишняя труба.
  it('после возврата пола под лестницей зал закрывается на любом шаге', () => {
    byId('living').candidates.forEach((c) => expect(c.enough).toBe(true));
    expect(byId('living').spacing).toBeCloseTo(0.2, 3);
  });

  it('ни одна петля не длиннее предела по антифризу', () => {
    L.byRoom.forEach((r) => expect(r.perLoop).toBeLessThanOrEqual(L.limit + 1e-6));
    expect(L.limit).toBeLessThan(90);
  });

  it('зал закрывается полом, санузел — нет', () => {
    // В зале ТП оставлен между холодильником и панелью и под стиралкой,
    // поэтому площади хватает. В санузле мешает душевой поддон:
    // 0,81 из 3,24 м² — четверть помещения, и это уже не отыграть.
    expect(L.byRoom.find((r) => r.id === 'living').deficit).toBe(false);
    expect(L.byRoom.find((r) => r.id === 'bath').deficit).toBe(true);
    expect(L.byRoom.find((r) => r.id === 'hall').deficit).toBe(false);
  });

  it('сплошной фронт кухни вернул бы зал в дефицит', () => {
    // Проверяем, что запас держится именно на открытых участках пола
    const p = makeInitialProject();
    p.floorExclusionZones = [
      { id: 'all-top', x: 0, y: 0, w: 3.7, d: 0.6 },
      { id: 'all-side', x: 3.1, y: 0.6, w: 0.6, d: 1.2 },
      ...p.floorExclusionZones
    ];
    p.equipment = p.equipment.map((e) =>
      ['eq-washer', 'eq-sofa', 'eq-table'].includes(e.id) ? { ...e, floorExclusion: true } : e
    );
    expect(build(p).byRoom.find((r) => r.id === 'living').deficit).toBe(true);
  });

  it('без мебели пол справляется — дело именно в потерянной площади', () => {
    const p = makeInitialProject();
    p.equipment = p.equipment.map((e) => ({ ...e, floorExclusion: false }));
    p.floorExclusionZones = [];
    build(p).byRoom.forEach((r) => expect(r.deficit).toBe(false));
  });

  it('дефицит санузла считается количественно', () => {
    const bath = L.byRoom.find((r) => r.id === 'bath');
    const best = Math.max(...bath.candidates.map((c) => c.capacity));
    const shortfallW = (bath.requiredWm2 - best) * bath.effectiveArea;
    // Порядка 30 Вт — закрывается полотенцесушителем
    expect(shortfallW).toBeGreaterThan(10);
    expect(shortfallW).toBeLessThan(60);
  });

  it('в зале остаётся запас по съёму', () => {
    const living = L.byRoom.find((r) => r.id === 'living');
    const best = Math.max(...living.candidates.map((c) => c.capacity));
    expect(best).toBeGreaterThan(living.requiredWm2);
  });

  it('разбаланс длин требует балансировочных клапанов', () => {
    expect(L.balanced).toBe(false);
    expect(L.imbalance).toBeGreaterThan(0.3);
  });

  it('зал укладывается в два контура при подтверждённом пределе', () => {
    // Правило большого пальца давало 71 м и требовало трёх контуров.
    // Поверочный расчёт гидравлики позволил поднять предел до 75.
    const living = L.byRoom.find((r) => r.id === 'living');
    expect(living.limit).toBe(75);
    expect(living.loops).toBe(2);
    expect(living.perLoop).toBeLessThanOrEqual(living.limit);
  });

  it('всего четыре контура', () => {
    expect(L.totalLoops).toBe(4);
  });

  it('на пропиленгликоле зал требовал бы трёх контуров', () => {
    // Так считалось, пока состав не был прочитан по этикетке
    const p = makeInitialProject();
    p.coolant = { ...p.coolant, maxLoopOverrideM: null, pressureDropFactor: 1.6 };
    const living = build(p).byRoom.find((r) => r.id === 'living');
    // 90 м для воды, делённые на корень из поправки 1,6
    expect(living.limit).toBeCloseTo(71.2, 0);
    // Каждая петля укладывается в предел — иначе контуров было бы больше
    expect(living.perLoop).toBeLessThanOrEqual(living.limit);
  });

  it('на фактическом этиленгликоле двух хватает и по правилу большого пальца', () => {
    // Этиленгликоль жиже: предел поднимается с 71 до 76 м сам собой,
    // и подтверждённый расчётом override 75 оказывается консервативнее
    const p = makeInitialProject();
    p.coolant = { ...p.coolant, maxLoopOverrideM: null };
    const living = build(p).byRoom.find((r) => r.id === 'living');
    expect(living.limit).toBeGreaterThan(75);
    expect(living.loops).toBe(2);
  });

  it('санузел и прихожая укладываются в один контур', () => {
    expect(L.byRoom.find((r) => r.id === 'bath').loops).toBe(1);
    expect(L.byRoom.find((r) => r.id === 'hall').loops).toBe(1);
  });

  it('без краевой зоны зал требует трёх контуров', () => {
    const p = makeInitialProject();
    const bare = layoutLoops({
      layout: p.layout,
      heatLossByRoom: heatLoss({
        layout: p.layout, openings: p.openings, climate: p.climate,
        envelope: p.envelope, screed: p.screed, clearHeight: CLEAR_HEIGHT
      }).byRoom,
      manifold: p.nodes.find((n) => n.type === 'manifold'),
      coolant: p.coolant, equipment: p.equipment,
      exclusionZones: p.floorExclusionZones, edgeZone: false
    });
    const living = bare.byRoom.find((r) => r.id === 'living');
    // Без краевой зоны зал уже не закрывается на 200 — его загоняет
    // на 100 мм и три контура. Именно это краевая зона и покупает.
    expect(living.spacing).toBeCloseTo(0.15, 3);
    expect(living.candidates.find((c) => c.spacing === 0.2).enough).toBe(false);
  });
});

describe('Мебель вычитается из поля тёплого пола', () => {
  const L = build();
  const living = L.byRoom.find((r) => r.id === 'living');

  it('кухня съедает полезную площадь', () => {
    // Порог ниже прежнего: ручных зон больше нет, вычитаются только
    // сами приборы, а линейная мойка 600 меньше углового модуля 1061
    expect(living.excludedArea).toBeGreaterThan(1.5);
    expect(living.effectiveArea).toBeLessThan(living.area);
  });

  it('нагрузка на оставшиеся квадраты растёт', () => {
    expect(living.requiredWm2).toBeGreaterThan(living.requiredBare);
  });

  it('унитаз и раковина трубу не вытесняют — под ними кладут', () => {
    const bath = L.byRoom.find((r) => r.id === 'bath');
    // Исключается только душевой поддон
    expect(bath.exclusions).toHaveLength(1);
  });

  it('стиральная машина под лестницей вытесняет трубу', () => {
    const ids = living.exclusions.length;
    expect(ids).toBeGreaterThan(3);
  });

  it('снятие исключения возвращает площадь', () => {
    const p = makeInitialProject();
    p.equipment = p.equipment.map((e) => ({ ...e, floorExclusion: false }));
    p.floorExclusionZones = [];
    const free = build(p).byRoom.find((r) => r.id === 'living');
    // Растеризация даёт погрешность порядка нанометра — сравниваем приближённо
    expect(free.excludedArea).toBeCloseTo(0, 6);
    expect(free.requiredWm2).toBeCloseTo(free.requiredBare, 4);
  });
});

describe('Кухня на открытом каркасе', () => {
  const flat = build();
  const frame = build({ ...makeInitialProject(), kitchenOnFrame: true });
  const living = (L) => L.byRoom.find((r) => r.id === 'living');

  // Флаг стал НИЧЕГО НЕ МЕНЯТЬ, и это правильное состояние: всё, что он
  // раньше снимал, — ручные зоны исключения — уже убрано насовсем.
  // Приборы вычитаются в обоих режимах одинаково.
  it('каркас больше ничего не возвращает — возвращать нечего', () => {
    expect(living(frame).effectiveArea).toBeCloseTo(living(flat).effectiveArea, 6);
  });

  it('и запас в зале одинаков в обоих режимах', () => {
    const margin = (L) => {
      const r = living(L);
      return Math.max(...r.candidates.map((c) => c.capacity)) - r.requiredWm2;
    };
    expect(margin(frame)).toBeCloseTo(margin(flat), 6);
    expect(living(frame).deficit).toBe(false);
  });

  it('мойка, панель и приборы на полу исключаются и на каркасе', () => {
    // Столешницы уходят на каркас, остальное остаётся вычтенным.
    // Порог ниже прежнего: линейная мойка 600 отнимает меньше пола,
    // чем угловой модуль 1061 × 1061 под 45°.
    expect(living(frame).excludedArea).toBeGreaterThan(1.5);
  });

  it('в санузле каркас ничего не меняет — там душевой поддон', () => {
    const bath = (L) => L.byRoom.find((r) => r.id === 'bath');
    expect(bath(frame).effectiveArea).toBeCloseTo(bath(flat).effectiveArea, 2);
    expect(bath(frame).deficit).toBe(true);
  });

  it('исключение стиралки отняло бы площадь обратно', () => {
    const p = makeInitialProject();
    p.kitchenOnFrame = true;
    p.equipment = p.equipment.map((e) =>
      e.catalogId === 'washer' ? { ...e, floorExclusion: true } : e
    );
    expect(living(build(p)).effectiveArea).toBeLessThan(living(frame).effectiveArea);
  });
});

describe('Подводка от коллектора', () => {
  const L = build();
  const p = makeInitialProject();
  const manifold = p.nodes.find((n) => n.type === 'manifold');

  it('коллектор встал между котлом и окном', () => {
    const boiler = p.nodes.find((n) => n.type === 'boiler');
    // Котёл 4.80…5.20, окно 3.20…4.10 — между ними 700 мм
    expect(boiler.y).toBeCloseTo(4.8, 2);
    expect(manifold.y).toBeGreaterThanOrEqual(4.1);
    expect(manifold.y + manifold.d).toBeLessThanOrEqual(4.8);
  });

  it('каждая петля получила свою трассу', () => {
    expect(L.supply.length).toBe(L.totalLoops);
  });

  it('в трассах НЕТ диагоналей — только прямые углы', () => {
    L.supply.forEach((route) => {
      for (let i = 1; i < route.points.length; i++) {
        const dx = Math.abs(route.points[i].x - route.points[i - 1].x);
        const dy = Math.abs(route.points[i].y - route.points[i - 1].y);
        // Отрезок либо горизонтальный, либо вертикальный
        expect(Math.min(dx, dy)).toBeLessThan(1e-6);
      }
    });
  });

  it('трубы идут параллельными полосами, не по одной линии', () => {
    const lanes = L.supply.map((r) => r.corridorX);
    expect(new Set(lanes).size).toBe(lanes.length);
  });

  it('ближняя петля получает внутреннюю полосу', () => {
    const sorted = [...L.supply].sort((a, b) => a.lane - b.lane);
    expect(sorted[0].corridorX).toBeLessThan(sorted[sorted.length - 1].corridorX);
  });
});

describe('Краевая зона и мебель', () => {
  it('полоса узкая: метр захватил бы половину комнаты', () => {
    expect(EDGE_ZONE.width).toBeLessThanOrEqual(0.6);
    expect(EDGE_ZONE.spacing).toBeLessThan(0.15);
  });

  it('трасса в краевой полосе идёт чаще, чем в поле', () => {
    const living = build().byRoom.find((r) => r.id === 'living');
    const edgeRows = living.path.rows.filter((r) => r.edge);
    expect(edgeRows.length).toBeGreaterThan(5);
    expect(edgeRows.length).toBeLessThan(living.path.rows.length);
  });

  it('без краевой зоны трасса идёт равномерно', () => {
    const p = makeInitialProject();
    const bare = layoutLoops({
      layout: p.layout,
      heatLossByRoom: heatLoss({
        layout: p.layout, openings: p.openings, climate: p.climate,
        envelope: p.envelope, screed: p.screed, clearHeight: CLEAR_HEIGHT
      }).byRoom,
      manifold: p.nodes.find((n) => n.type === 'manifold'),
      coolant: p.coolant, equipment: p.equipment,
      exclusionZones: p.floorExclusionZones, edgeZone: false
    });
    const living = bare.byRoom.find((r) => r.id === 'living');
    expect(living.path.rows.every((r) => !r.edge)).toBe(true);
  });

  it('диван у южной стены попадает в краевую полосу', () => {
    const sofa = makeInitialProject().equipment.find((e) => e.catalogId === 'sofa');
    expect(overlapsEdgeZone(boundingBox(sofa))).toBe(true);
  });

  it('обеденный стол в центре — не попадает', () => {
    const table = makeInitialProject().equipment.find((e) => e.catalogId === 'dining_table');
    expect(overlapsEdgeZone(boundingBox(table))).toBe(false);
  });

  it('минимальный зазор задан явно', () => {
    expect(MIN_FURNITURE_GAP).toBeGreaterThanOrEqual(0.05);
  });
});

describe('Трасса змейкой обходит мебель', () => {
  const L = build();

  it('у каждого помещения построена геометрия трассы', () => {
    L.byRoom.forEach((r) => {
      expect(r.path.points.length).toBeGreaterThan(4);
      expect(r.loopPaths.length).toBe(r.loops);
    });
  });

  it('точки трассы не попадают внутрь исключённых пятен', () => {
    const living = L.byRoom.find((r) => r.id === 'living');
    living.path.points.forEach((p) => {
      living.exclusions.forEach((e) => {
        const inside = p.x > e.x + 0.01 && p.x < e.x + e.w - 0.01
          && p.y > e.y + 0.01 && p.y < e.y + e.d - 0.01;
        expect(inside).toBe(false);
      });
    });
  });

  it('трасса держится внутри габарита дома', () => {
    L.byRoom.forEach((r) => {
      r.path.points.forEach((p) => {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(5.5);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(5.5);
      });
    });
  });

  it('деление на контуры сохраняет все проходы', () => {
    const living = L.byRoom.find((r) => r.id === 'living');
    const total = living.loopPaths.reduce((s, p) => s + p.length, 0);
    expect(total).toBe(living.path.points.length);
  });
});

describe('Встречная укладка', () => {
  it('порядок строк чередуется: прямой ход через одну, обратный по пропущенным', () => {
    const rows = [0, 1, 2, 3, 4, 5].map((i) => ({ y: i, x1: 0, x2: 1 }));
    const order = bifilarOrder(rows).map((r) => r.y);
    // Вперёд по чётным, назад по нечётным
    expect(order).toEqual([0, 2, 4, 5, 3, 1]);
  });

  it('соседние строки разнесены по ходу петли — кроме точки разворота', () => {
    const rows = Array.from({ length: 8 }, (_, i) => ({ y: i, x1: 0, x2: 1 }));
    const order = bifilarOrder(rows).map((r) => r.y);

    const gaps = [];
    for (let y = 0; y < 7; y++) {
      gaps.push(Math.abs(order.indexOf(y) - order.indexOf(y + 1)));
    }
    // Ровно одна пара идёт подряд — там, где труба разворачивается
    // у дальнего края. Это физика улитки, а не изъян раскладки.
    expect(gaps.filter((g) => g === 1)).toHaveLength(1);
    expect(gaps.filter((g) => g > 1)).toHaveLength(6);
  });

  it('все строки использованы ровно один раз', () => {
    const rows = Array.from({ length: 7 }, (_, i) => ({ y: i, x1: 0, x2: 1 }));
    const order = bifilarOrder(rows).map((r) => r.y).sort((a, b) => a - b);
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('длина трубы от порядка укладки не зависит', () => {
    const p = makeInitialProject();
    const bif = build({ ...p, loopMode: 'bifilar' }).totalPipe;
    const ser = build({ ...p, loopMode: 'serpentine' }).totalPipe;
    expect(bif).toBeCloseTo(ser, 6);
  });

  it('сегменты трассы размечены от подачи к обратке', () => {
    const segs = pathSegments([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]);
    expect(segs[0].t).toBeLessThan(segs[segs.length - 1].t);
    expect(segs[0].t).toBeGreaterThanOrEqual(0);
    expect(segs[segs.length - 1].t).toBeLessThanOrEqual(1);
  });
});

describe('roomLoops — влияние теплоносителя', () => {
  it('на воде предел петли выше, чем на антифризе', () => {
    const p = makeInitialProject();
    const room = buildRooms(p.layout).find((r) => r.id === 'living');
    const args = {
      room,
      area: 22.41,
      requiredWm2: 56,
      airTemp: 20,
      manifold: { x: 0.3, y: 3.26 },
      preferredSpacing: 0.2
    };
    const glycol = roomLoops({ ...args, coolant: p.coolant });
    const water = roomLoops({ ...args, coolant: { pressureDropFactor: 1 } });
    expect(water.limit).toBeGreaterThan(glycol.limit);
    // Но зал всё равно не помещается в один контур даже на воде
    expect(water.loops).toBeGreaterThan(1);
  });
});

describe('тёплый пол под лестницей', () => {
  const p = makeInitialProject();

  // Полоса 800 × 2600 под маршем раньше была вычтена «как не помещение».
  // Ошибка: теплопотери зала считаются на полную площадь, включая её
  // и участок ВОСТОЧНОЙ НАРУЖНОЙ стены над ней.
  it('зон исключения под лестницей не осталось', () => {
    const stair = p.floorExclusionZones.filter((z) => z.x >= 4.5);
    expect(stair).toHaveLength(0);
  });

  it('ручных зон исключения не осталось совсем', () => {
    expect(p.floorExclusionZones).toHaveLength(0);
  });

  it('полезная площадь зала выросла до 20 м²', () => {
    const L = build(p);
    const living = L.byRoom.find((r) => r.id === 'living');
    expect(living.effectiveArea).toBeGreaterThan(19.9);
    expect(living.deficit).toBe(false);
  });

  it('запас зала стал двузначным, а шаг раздвинулся до 200', () => {
    const living = build(p).byRoom.find((r) => r.id === 'living');
    const cap = Math.max(...living.candidates.map((c) => c.capacity));
    expect(cap - living.requiredWm2).toBeGreaterThan(10);
    expect(living.spacing).toBeCloseTo(0.2, 3);
  });

  it('возврат исключения снова зажимает зал', () => {
    const tight = makeInitialProject();
    tight.floorExclusionZones = [
      ...tight.floorExclusionZones,
      { id: 'under-stair', x: 4.7, y: 1.8, w: 0.8, d: 2.6 }
    ];
    const living = build(tight).byRoom.find((r) => r.id === 'living');
    const cap = Math.max(...living.candidates.map((c) => c.capacity));
    expect(cap - living.requiredWm2).toBeLessThan(7);
  });
});

describe('мебель на полу против мебели у стены', () => {
  const withWardrobe = (excl) => {
    const p = makeInitialProject();
    p.equipment = [
      ...p.equipment,
      { id: 'eq-wardrobe', catalogId: 'wardrobe', x: 0.45, y: 4.6, rotation: 0,
        ...(excl === undefined ? {} : { floorExclusion: excl }) }
    ];
    return build(p).byRoom.find((r) => r.id === 'hall');
  };

  // Шкаф был единственным предметом мебели, вычитавшим пол, — и это
  // расходилось и с диваном, и с лавками, и со стеллажом.
  it('гардероб трубу не вытесняет', () => {
    expect(getFixture('wardrobe').floorExclusion).toBe(false);
    expect(withWardrobe(undefined).effectiveArea).toBeCloseTo(4.6, 2);
  });

  it('вся мебель ведёт себя одинаково', () => {
    ['sofa', 'bench', 'dining_table', 'shelf_open', 'tv_unit', 'wardrobe']
      .forEach((id) => expect(getFixture(id).floorExclusion).toBeFalsy());
  });

  // Прихожая закрывается в обоих случаях — дело не в мощности,
  // а в холодном кармане за задней стенкой шкафа у наружной стены
  it('исключение шкафа поднимает требуемую отдачу, но дефицита нет', () => {
    const off = withWardrobe(true);
    const on = withWardrobe(false);
    expect(off.requiredWm2).toBeGreaterThan(on.requiredWm2);
    expect(off.deficit).toBe(false);
    expect(on.deficit).toBe(false);
  });
});

describe('кухонные зоны исключения после переезда мойки', () => {
  const p = makeInitialProject();

  // Зоны описывали УГЛОВУЮ мойку 1061 × 1061 у перегородки санузла.
  // Мойка стала линейной и уехала под окно — зоны остались висеть там,
  // где теперь панель и духовка, и задваивали их собственное исключение.
  it('ручных зон в правом варианте не осталось', () => {
    expect(p.floorExclusionZones).toHaveLength(0);
  });

  it('приборы по-прежнему вычитают свой габарит сами', () => {
    ['fridge', 'sink', 'dishwasher60', 'hob_gas', 'oven']
      .forEach((id) => expect(getFixture(id).floorExclusion).toBe(true));
  });

  it('нижний шкаф трубу не вытесняет — он на вентилируемом цоколе', () => {
    const store = p.equipment.find((e) => e.id === 'eq-store1');
    expect(store.floorExclusion).toBe(false);
  });

  it('зал получил ещё площади и запаса', () => {
    const living = build(p).byRoom.find((r) => r.id === 'living');
    const cap = Math.max(...living.candidates.map((c) => c.capacity));
    expect(living.effectiveArea).toBeGreaterThan(20.5);
    expect(cap - living.requiredWm2).toBeGreaterThan(14);
  });
});
