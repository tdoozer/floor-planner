// Электрика: группы, трассы и метраж кабеля.
//
// Трассы считаются ОТ ТОЧКИ ВВОДА и только под прямым углом — как и подводки
// тёплого пола. Диагоналей в стенах и стяжке не бывает.
//
// Главное ограничение проекта: часть трасс идёт в полу, а в полу уже лежит
// труба ТП. Поэтому кабель ведём В СЛОЕ УТЕПЛИТЕЛЯ, ниже трубы, а не в стяжке
// рядом с ней — тогда пересечения безопасны и сверлить потом нечего.

import { INNER_D, INNER_W } from '../data/project.js';
import { boundingBox, getFixture } from '../data/fixtures.js';

// Группы: сечение кабеля и номинал автомата.
//
// Отдельная линия на КАЖДЫЙ прибор — избыточно. 3×2,5 на автомате 16 А несёт
// 3,5 кВт, а холодильник с посудомойкой вместе берут 2,5 кВт. Линию делят,
// когда мешает одно из трёх:
//   1) прибор один выбирает весь номинал (духовой шкаф 3,5 кВт);
//   2) отключение прибора недопустимо (котёл — дом размораживается);
//   3) нужна своя защита (мокрая зона — УЗО 10 мА, а не общие 30).
// Всё остальное объединяется.
export const CIRCUITS = {
  light: { label: 'Освещение', cable: '3×1,5', breaker: 10, rcd: false },
  sockets: { label: 'Розетки общие', cable: '3×2,5', breaker: 16, rcd: true },
  kitchen: { label: 'Розетки кухни', cable: '3×2,5', breaker: 16, rcd: true },
  // Холодильник + посудомойка: 0,3 + 2,2 = 2,5 кВт из 3,5 доступных
  kitchenApp: { label: 'Кухонная техника', cable: '3×2,5', breaker: 16, rcd: true, load: 2500 },
  // Духовой шкаф: 3,5 кВт — один выбирает линию целиком
  appliance: { label: 'Отдельная линия', cable: '3×2,5', breaker: 16, rcd: true, load: 3500 },
  // Санузел + стиральная машина: одна мокрая зона, УЗО 10 мА
  bath: { label: 'Санузел и стиральная', cable: '3×2,5', breaker: 16, rcd: true, rcdMa: 10, load: 3700 },
  // Котёл: отдельно не по мощности (110 Вт), а потому что чужое УЗО
  // не имеет права его гасить. Он же идёт через ИБП.
  //
  // Роутер сидит на ЭТОЙ ЖЕ линии — намеренно. ИБП и так стоит ради котла,
  // 12 Вт на нём теряются, а без интернета в отключение не видно ни котла,
  // ни дома. Цена решения честная: в байпасе ИБП розетка роутера окажется
  // под тем же УЗО, что и котёл. Больше на линию не вешать ничего.
  boiler: { label: 'Котёл и роутер (ИБП)', cable: '3×1,5', breaker: 6, rcd: true, load: 130 },
  // Слаботочка автомата не имеет и в силовой щит не идёт вовсе.
  // Она здесь только чтобы точки попали на слой электрики и в спецификацию.
  data: { label: 'Слаботочка', cable: 'UTP cat.6', breaker: 0, rcd: false, load: 0, lowVoltage: true }
};

// Что тянется по полу, а что по стенам и потолку.
// Свет идёт сверху — по мансардному перекрытию, к нему пол отношения не имеет.
// Слаботочки в стяжке НЕТ намеренно: в бетон её замуровывать нельзя,
// стандарты меняются быстрее, чем живёт пол. См. calc/lowVoltage.js.
export const IN_FLOOR = new Set(['sockets', 'kitchen', 'kitchenApp', 'appliance', 'bath', 'boiler']);

// Подрозетник для СПЛОШНЫХ стен (не для гипсокартона — лапки там не за что
// цеплять). Коронка 68 мм, посадка на гипсовую штукатурку, а не на дюбель:
// газобетон дюбель под такой нагрузкой не держит, а гипс схватывается
// с ним намертво.
export const BACK_BOX = { depth: 45, diameter: 68, crown: 68 };

// Габарит кабеля ВВГнг-LS 3×2,5 (плоский), мм — нужен для проверки,
// не слиплись ли трассы в пучке. Пока просвет между кабелями больше
// двух диаметров, снижающий коэффициент по ПУЭ не применяется.
export const CABLE_OD_MM = 12;

export const ROUTE = {
  pitch: 0.05, // расстояние между соседними трассами в пучке
  standoff: 0.1, // отступ пучка от стены
  riseAllowance: 1.2 // запас на подъём по стене и заводку в коробку, м
};

// Ортогональная трасса от ввода до точки. Полосы назначаются по удалённости,
// чтобы пучок вдоль стены не перехлёстывался.
export function cableRoutes(entry, points, opts = {}) {
  const pitch = opts.pitch ?? ROUTE.pitch;
  const standoff = opts.standoff ?? ROUTE.standoff;

  const ex = entry.x + (entry.w ?? 0) / 2;
  const ey = entry.y + (entry.d ?? 0) / 2;

  const ordered = points
    .map((p, i) => ({ ...p, i, reach: Math.abs(p.y - ey) + Math.abs(p.x - ex) }))
    .sort((a, b) => a.reach - b.reach);

  const routes = new Array(points.length);

  ordered.forEach((p, lane) => {
    const corridorX = ex + standoff + lane * pitch;
    const pts = [
      { x: ex, y: ey },
      { x: corridorX, y: ey },
      { x: corridorX, y: p.y },
      { x: p.x, y: p.y }
    ].filter((q, i, a) => i === 0 || Math.hypot(q.x - a[i - 1].x, q.y - a[i - 1].y) > 1e-6);

    let run = 0;
    for (let i = 1; i < pts.length; i++) {
      run += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }

    routes[p.i] = {
      id: p.id,
      circuit: p.circuit,
      points: pts,
      lane,
      corridorX,
      runM: run,
      // Кабеля нужно больше трассы: подъём по стене и запас на заводку
      cableM: run + ROUTE.riseAllowance + (p.mountHeight ?? 0.3)
    };
  });

  return routes;
}

// Разбор расставленных точек: что это, какая группа, где сидит
export function electricalPoints(equipment = []) {
  return equipment
    .map((item) => {
      const spec = getFixture(item.catalogId);
      if (!spec || spec.category !== 'electrical') return null;
      const bb = boundingBox(item);
      return {
        id: item.id,
        catalogId: item.catalogId,
        name: spec.name,
        circuit: item.circuit ?? spec.circuit ?? 'sockets',
        mountHeight: item.mountHeight ?? spec.mountHeight ?? 0.3,
        power: spec.power ?? 0,
        x: bb.cx,
        y: bb.cy
      };
    })
    .filter(Boolean);
}

// Проверка управления светом: чем каждый светильник включается и не осталось ли
// ламп без выключателя. Плюс контроль, что проходные стоят ПАРАМИ —
// одиночный проходной не работает.
export function switchCoverage(equipment = []) {
  const specOf = (e) => getFixture(e.catalogId);

  const lights = equipment.filter((e) => specOf(e)?.circuit === 'light' && specOf(e)?.power > 0);
  const switches = equipment.filter((e) => specOf(e)?.gangs);

  const controlled = new Set();
  switches.forEach((s) => (s.controls ?? []).forEach((id) => controlled.add(id)));

  const orphanLights = lights.filter((l) => !controlled.has(l.id)).map((l) => l.id);

  // Проходные: считаем, сколько выключателей управляет каждой лампой
  const perLight = {};
  switches.forEach((s) => {
    (s.controls ?? []).forEach((id) => {
      perLight[id] ??= [];
      perLight[id].push(s.id);
    });
  });

  const twoWay = switches.filter((s) => specOf(s)?.twoWay);
  const unpaired = twoWay.filter((s) => {
    if (s.pairWith === 'MANSARD') return false; // пара за пределами этажа
    return !switches.some((o) => o.id === s.pairWith || o.pairWith === s.id);
  });

  return {
    lights: lights.length,
    switches: switches.length,
    gangs: switches.reduce((n, s) => n + (specOf(s)?.gangs ?? 1), 0),
    orphanLights,
    perLight,
    twoWayCount: twoWay.length,
    unpairedTwoWay: unpaired.map((s) => s.id),
    // Лампы, доступные из двух мест — то, ради чего проходные и ставят
    dualControlled: Object.entries(perLight)
      .filter(([, ids]) => ids.length > 1)
      .map(([id]) => id)
  };
}

export function electricalPlan({ equipment = [], entry }) {
  const points = electricalPoints(equipment);
  if (!entry || !points.length) {
    return { points: [], routes: [], byCircuit: [], totalCableM: 0, inFloorM: 0 };
  }

  const routes = cableRoutes(entry, points);

  const groups = {};
  points.forEach((p, i) => {
    const key = p.circuit;
    groups[key] ??= { circuit: key, ...CIRCUITS[key], points: [], cableM: 0 };
    groups[key].points.push(p);
    groups[key].cableM += routes[i].cableM;
  });

  // Отдельная линия — по линии на прибор, а не одна на всех
  const byCircuit = Object.values(groups).map((g) => ({
    ...g,
    count: g.points.length,
    lines: g.circuit === 'appliance' ? g.points.length : 1,
    inFloor: IN_FLOOR.has(g.circuit)
  }));

  // Слаботочка автоматов не занимает
  const totalCableM = routes
    .filter((r) => !CIRCUITS[r.circuit]?.lowVoltage)
    .reduce((s, r) => s + r.cableM, 0);
  const inFloorM = routes
    .filter((r) => IN_FLOOR.has(r.circuit))
    .reduce((s, r) => s + r.runM, 0);

  // Пучок в слое утеплителя: просвет между соседними трассами.
  // Меньше двух диаметров — кабели греют друг друга и по ПУЭ идёт
  // снижающий коэффициент, то есть 2,5 мм² перестаёт держать 16 А.
  const clearance = ROUTE.pitch * 1000 - CABLE_OD_MM;

  return {
    points,
    routes,
    byCircuit,
    totalCableM,
    inFloorM,
    bundle: {
      lanes: routes.filter((r) => IN_FLOOR.has(r.circuit)).length,
      pitchMm: ROUTE.pitch * 1000,
      clearanceMm: clearance,
      // Просвет ≥ 2 диаметров — снижающего коэффициента нет
      derating: clearance >= 2 * CABLE_OD_MM ? 1 : 0.7
    },
    switches: switchCoverage(equipment),
    breakers: byCircuit
      .filter((g) => !g.lowVoltage)
      .reduce((s, g) => s + g.lines, 0)
  };
}
