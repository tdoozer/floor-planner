// Раскладка петель тёплого пола.
//
// Порядок рассуждения:
//   1. Сколько помещению нужно тепла на квадрат — из heatloss.
//   2. Сколько пол СПОСОБЕН отдать при ограничении температуры поверхности.
//      q = α · (T_пола − T_воздуха), α ≈ 10,8 Вт/(м²·К).
//      Керамогранит здесь помогает: его сопротивление почти нулевое.
//   3. Какой нужен шаг трубы и сколько получается метров.
//   4. Влезает ли это в предельную длину петли — с антифризом она меньше.

import { INNER_D, INNER_W, buildRooms } from '../data/project.js';
import { maxLoopLength } from '../data/coolant.js';
import { exclusionRect, excludesFloor } from '../data/fixtures.js';
import { pointInPolygon, polygonArea, polygonBounds } from './geometry.js';

// Отступ трубы от стен и от исключаемых предметов, м
export const WALL_MARGIN = 0.1;
export const OBSTACLE_MARGIN = 0.05;

export const ALPHA = 10.8; // Вт/(м²·К), теплоотдача поверхности пола

// Ограничение температуры поверхности пола по назначению помещения
export const MAX_FLOOR_TEMP = { living: 26, bath: 31, hall: 29 };

// Доступные шаги укладки, м
export const SPACINGS = [0.1, 0.15, 0.2, 0.25];

// Разбаланс петель на одном коллекторе выше этого — нужны балансировочные клапаны
export const BALANCE_TOLERANCE = 0.3;

// Сколько пол отдаёт при данном шаге и ограничении температуры поверхности.
// Упрощённо: широкий шаг снижает средний съём из-за неравномерности.
export function floorOutput({ maxFloorTemp, airTemp, spacing }) {
  const spacingPenalty = { 0.1: 1.0, 0.15: 0.95, 0.2: 0.88, 0.25: 0.8 }[spacing] ?? 0.8;
  return ALPHA * (maxFloorTemp - airTemp) * spacingPenalty;
}

// КРАЕВАЯ ЗОНА — полоса вдоль наружных стен с частым шагом.
// Там холод падает от окон и стен, и там же нормы разрешают более высокую
// температуру поверхности: у наружной стены не стоят подолгу.
// Приём стандартный и решает ровно ту задачу, из-за которой иначе приходится
// уплотнять шаг по всей площади.
// Полоса намеренно узкая: при ширине метра в комнате 5,5 м она захватывает
// половину площади, и средневзвешенный съём начинает завышать расчёт.
// Осторожная надбавка к температуре поверхности — +3 K, не больше.
export const EDGE_ZONE = { width: 0.6, spacing: 0.1, tempBonus: 3, maxFloorTemp: 31 };

// Минимальный продуваемый зазор под предметом, стоящим на тёплом полу.
// Дело не в температуре поверхности — 29 °C мебели не вредят. Вредит
// ЗАПЕРТОЕ тепло: без циркуляции под глухим предметом температура уходит
// к температуре теплоносителя, и вот это уже сушит и коробит.
// Величина типовая для систем ТП; сверить с паспортом системы и мебели.
export const MIN_FURNITURE_GAP = 0.05;

// Пересекается ли пятно предмета с краевой полосой вдоль наружных стен
export function overlapsEdgeZone(box, width = EDGE_ZONE.width) {
  return (
    box.x <= width ||
    box.x + box.w >= INNER_W - width ||
    box.y <= width ||
    box.y + box.d >= INNER_D - width
  );
}

// Площадь полосы шириной width вдоль габарита дома, внутри помещения
// и вне исключений. Считаем растеризацией — форма помещения произвольная.
export function edgeBandArea(polygon, exclusions, width = EDGE_ZONE.width, step = 0.025) {
  const b = polygonBounds(polygon);
  const cell = step * step;
  let band = 0;

  for (let y = b.minY + step / 2; y < b.maxY; y += step) {
    for (let x = b.minX + step / 2; x < b.maxX; x += step) {
      const nearOuter =
        x <= width || x >= INNER_W - width || y <= width || y >= INNER_D - width;
      if (!nearOuter) continue;
      if (!pointInPolygon(polygon, x, y)) continue;
      const blocked = exclusions.some(
        (e) => x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.d
      );
      if (!blocked) band += cell;
    }
  }
  return band;
}

// Длина трубы: поле плюс подводка от коллектора туда и обратно
export function pipeLength({ area, spacing, supplyRunM }) {
  return area / spacing + supplyRunM * 2;
}

// Шаг между соседними трубами подводки в пучке, м
export const SUPPLY_PITCH = 0.05;
// Отступ пучка от стены, на которой висит коллектор, м
export const SUPPLY_STANDOFF = 0.12;

// Трассы подводки от коллектора к началу каждой петли.
//
// ТОЛЬКО ПОД ПРЯМЫМ УГЛОМ. Диагоналей в стяжке не бывает: трубы идут вдоль
// стен пучком, каждая в своей полосе. Полосы назначаются по удалённости —
// кто ближе, тот отходит первым, тогда пучок не перехлёстывается.
export function supplyRoutes(manifold, targets, opts = {}) {
  const pitch = opts.pitch ?? SUPPLY_PITCH;
  const standoff = opts.standoff ?? SUPPLY_STANDOFF;

  const mx = manifold.x + manifold.w / 2;
  const my = manifold.y + manifold.d / 2;

  // Ближние петли получают внутренние полосы
  const ordered = targets
    .map((t, i) => ({ ...t, i, reach: Math.abs(t.y - my) + Math.abs(t.x - mx) }))
    .sort((a, b) => a.reach - b.reach);

  const routes = new Array(targets.length);

  ordered.forEach((t, lane) => {
    const corridorX = mx + standoff + lane * pitch;
    const points = [
      { x: mx, y: my },
      { x: corridorX, y: my },
      { x: corridorX, y: t.y },
      { x: t.x, y: t.y }
    ];

    // Убираем нулевые сегменты, чтобы на плане не было точек-артефактов
    const clean = points.filter(
      (p, i, a) => i === 0 || Math.hypot(p.x - a[i - 1].x, p.y - a[i - 1].y) > 1e-6
    );

    let length = 0;
    for (let i = 1; i < clean.length; i++) {
      length += Math.hypot(clean[i].x - clean[i - 1].x, clean[i].y - clean[i - 1].y);
    }

    routes[t.i] = { points: clean, length, lane, corridorX };
  });

  return routes;
}

// Манхэттенское расстояние от коллектора до центра помещения
export function supplyRun(manifold, polygon) {
  const cx = polygon.reduce((s, p) => s + p.x, 0) / polygon.length;
  const cy = polygon.reduce((s, p) => s + p.y, 0) / polygon.length;
  return Math.abs(cx - manifold.x) + Math.abs(cy - manifold.y);
}

// ---------------------------------------------------------------------------
// Геометрия трассы
// ---------------------------------------------------------------------------

// Полезная площадь пола: внутри помещения и вне всех исключений.
// Пятна приборов и сплошные зоны перекрываются, поэтому просто складывать
// их площади нельзя — считаем растеризацией по сетке.
export function effectiveFloorArea(polygon, exclusions, step = 0.025) {
  const b = polygonBounds(polygon);
  const cell = step * step;
  let free = 0;

  for (let y = b.minY + step / 2; y < b.maxY; y += step) {
    for (let x = b.minX + step / 2; x < b.maxX; x += step) {
      if (!pointInPolygon(polygon, x, y)) continue;
      const blocked = exclusions.some(
        (e) => x >= e.x && x <= e.x + e.w && y >= e.y && y <= e.y + e.d
      );
      if (!blocked) free += cell;
    }
  }
  return free;
}

// Пересечения горизонтальной прямой y с полигоном → интервалы по x внутри него
export function scanIntervals(polygon, y) {
  const xs = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (a.y === b.y) continue;
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    if (y < lo || y >= hi) continue;
    xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
  }
  xs.sort((p, q) => p - q);

  const out = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}

// Вычитание прямоугольников-препятствий из набора интервалов
export function subtractRects(intervals, y, rects) {
  let result = intervals;
  rects.forEach((r) => {
    const top = r.y - OBSTACLE_MARGIN;
    const bottom = r.y + r.d + OBSTACLE_MARGIN;
    if (y < top || y > bottom) return;
    const left = r.x - OBSTACLE_MARGIN;
    const right = r.x + r.w + OBSTACLE_MARGIN;

    result = result.flatMap(([a, b]) => {
      if (right <= a || left >= b) return [[a, b]];
      const parts = [];
      if (left > a) parts.push([a, Math.min(left, b)]);
      if (right < b) parts.push([Math.max(right, a), b]);
      return parts;
    });
  });
  return result.filter(([a, b]) => b - a > 0.15);
}

// ВСТРЕЧНАЯ УКЛАДКА («улитка», бифилярная).
//
// В обычной змейке труба идёт подряд: у входа она горячая, к концу остывает,
// и пол получается с градиентом — у коллектора теплее, в глубине холоднее.
//
// Во встречной укладке прямой ход идёт ЧЕРЕЗ строку, а обратный заполняет
// пропущенные. В результате рядом всегда оказываются подача и обратка,
// их температуры усредняются, и пол греет ровно по всей площади.
//
//   змейка:    1 → 2 → 3 → 4 → 5 → 6        (горячо … холодно)
//   встречная: 1 → 3 → 5 → 6 → 4 → 2        (горячо/холодно вперемешку)
export function bifilarOrder(rows) {
  const forward = [];
  const back = [];
  for (let i = 0; i < rows.length; i += 2) forward.push(i);
  for (let i = rows.length - 1 - ((rows.length - 1) % 2 === 0 ? 1 : 0); i >= 1; i -= 2) back.push(i);
  return [...forward, ...back].map((i) => rows[i]);
}

// Точки трассы из упорядоченного списка строк.
// Концы чередуются, чтобы получилась непрерывная линия.
export function pointsFromRows(rows) {
  const points = [];
  rows.forEach((row, i) => {
    const leftFirst = i % 2 === 0;
    points.push(
      { x: leftFirst ? row.x1 : row.x2, y: row.y },
      { x: leftFirst ? row.x2 : row.x1, y: row.y }
    );
  });
  return points;
}

export function pathLength(points) {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return len;
}

// Отрезки трассы с координатой t = 0…1 вдоль петли.
// Нужны, чтобы раскрасить трубу от подачи к обратке и увидеть чередование.
export function pathSegments(points) {
  const total = pathLength(points);
  const segs = [];
  let run = 0;
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    segs.push({
      x1: points[i - 1].x, y1: points[i - 1].y,
      x2: points[i].x, y2: points[i].y,
      t: total > 0 ? (run + l / 2) / total : 0
    });
    run += l;
  }
  return segs;
}

// Змейка: проходы с шагом spacing, соединённые попеременно слева и справа.
// Препятствия разрывают проход, поэтому берём самый длинный участок строки —
// так труба обходит мебель, не заходя под неё.
export function serpentinePath({
  polygon,
  spacing,
  exclusions = [],
  margin = WALL_MARGIN,
  mode = 'bifilar',
  edgeZone = true
}) {
  const b = polygonBounds(polygon);

  // Шаг переменный: у наружных стен проходы идут чаще.
  // Именно это и есть краевая зона — не отдельный контур, а сгущение
  // трассы в полосе вдоль наружной стены, там где падает холод.
  const stepAt = (y) => {
    if (!edgeZone) return spacing;
    const nearOuter = y <= EDGE_ZONE.width || y >= INNER_D - EDGE_ZONE.width;
    return nearOuter ? Math.min(EDGE_ZONE.spacing, spacing) : spacing;
  };

  const rows = [];
  let y = b.minY + margin;
  let guard = 0;
  while (y <= b.maxY - margin + 1e-9 && guard++ < 500) {
    let intervals = scanIntervals(polygon, y).map(([a, c]) => [a + margin, c - margin]);
    intervals = subtractRects(intervals, y, exclusions);
    if (intervals.length) {
      // Самый длинный сегмент строки — основная трасса
      const seg = intervals.reduce((best, cur) => (cur[1] - cur[0] > best[1] - best[0] ? cur : best));
      rows.push({ y, x1: seg[0], x2: seg[1], edge: stepAt(y) < spacing - 1e-9 });
    }
    y += stepAt(y);
  }

  const ordered = mode === 'bifilar' ? bifilarOrder(rows) : rows;
  const points = pointsFromRows(ordered);

  return { points, rows, ordered, mode, length: pathLength(points) };
}

// Разрезаем поле на несколько контуров по полосам строк.
// Внутри каждой полосы порядок снова встречный — чередование сохраняется.
export function splitIntoLoops(path, loops) {
  if (loops <= 1) return [path.points];
  const per = Math.ceil(path.rows.length / loops);
  const chunks = [];
  for (let i = 0; i < path.rows.length; i += per) {
    const slice = path.rows.slice(i, i + per);
    if (!slice.length) continue;
    const ordered = path.mode === 'bifilar' ? bifilarOrder(slice) : slice;
    chunks.push(pointsFromRows(ordered));
  }
  return chunks;
}

// Раскладка для одного помещения.
// minLoops — требование заказчика: отдельный контур на это помещение.
export function roomLoops({
  room,
  area,
  roomLoadW,
  airTemp,
  manifold,
  coolant,
  preferredSpacing,
  exclusions = [],
  mode = 'bifilar',
  edgeZone = true
}) {
  const limit = maxLoopLength(coolant);
  const maxFloorTemp = MAX_FLOOR_TEMP[room.id] ?? 26;
  const run = supplyRun(manifold, room.polygon);

  // Мебель, техника и сплошные фронты кухни съедают полезную площадь пола,
  // а нагрузку — нет. Значит оставшиеся квадраты должны отдать всё.
  const effectiveArea = Math.max(0.5, Math.min(area, effectiveFloorArea(room.polygon, exclusions)));
  const excludedArea = Math.max(0, area - effectiveArea);
  const requiredWm2 = roomLoadW / effectiveArea;
  const requiredBare = roomLoadW / area;

  // Краевая полоса вдоль наружных стен: там частый шаг и выше допустимая
  // температура поверхности. Остальное — поле с выбранным шагом.
  const edgeArea = edgeZone ? Math.min(effectiveArea, edgeBandArea(room.polygon, exclusions)) : 0;
  const fieldArea = Math.max(0, effectiveArea - edgeArea);
  const edgeCapacity = edgeZone
    ? floorOutput({
        maxFloorTemp: Math.min(EDGE_ZONE.maxFloorTemp, maxFloorTemp + EDGE_ZONE.tempBonus),
        airTemp,
        spacing: EDGE_ZONE.spacing
      })
    : 0;

  // Берём самый широкий шаг поля, который ещё покрывает потребность:
  // меньше трубы, меньше потерь давления, дешевле
  const candidates = SPACINGS.map((spacing) => {
    const fieldCapacity = floorOutput({ maxFloorTemp, airTemp, spacing });
    // Средневзвешенный съём по площадям краевой зоны и поля
    const capacity = effectiveArea > 0
      ? (edgeArea * edgeCapacity + fieldArea * fieldCapacity) / effectiveArea
      : fieldCapacity;
    const total = edgeArea / EDGE_ZONE.spacing + fieldArea / spacing + run * 2;
    const loops = Math.max(1, Math.ceil(total / limit));
    return {
      spacing,
      fieldCapacity,
      capacity,
      enough: capacity >= requiredWm2,
      totalPipe: total,
      loops,
      perLoop: total / loops
    };
  });

  const workable = candidates.filter((c) => c.enough);
  const chosen = preferredSpacing
    ? candidates.find((c) => c.spacing === preferredSpacing)
    : // Самый широкий шаг из покрывающих потребность, но не грубее 200 мм
      workable.filter((c) => c.spacing <= 0.2).sort((a, b) => b.spacing - a.spacing)[0]
        || workable[0]
        || candidates[0];

  const path = serpentinePath({
    polygon: room.polygon,
    spacing: chosen.spacing,
    exclusions,
    mode,
    edgeZone
  });
  const loopPaths = splitIntoLoops(path, chosen.loops);

  return {
    id: room.id,
    name: room.name,
    area,
    excludedArea,
    effectiveArea,
    edgeArea,
    fieldArea,
    edgeCapacity,
    requiredWm2,
    requiredBare,
    roomLoadW,
    airTemp,
    maxFloorTemp,
    supplyRunM: run,
    limit,
    candidates,
    ...chosen,
    path,
    loopPaths,
    exclusions,
    // Пол физически не вытягивает нагрузку ни при каком шаге
    deficit: !candidates.some((c) => c.enough)
  };
}

export function layoutLoops({
  layout,
  heatLossByRoom,
  manifold,
  coolant,
  spacings = {},
  equipment = [],
  exclusionZones = [],
  mode = 'bifilar',
  kitchenOnFrame = false,
  edgeZone = true
}) {
  const rooms = buildRooms(layout);

  // Кухня на открытом каркасе: сплошные фронты исчезают, столешницы и шкафы
  // перестают перекрывать пол — под ними остаётся продуваемый зазор.
  // Исключаются только приборы, реально стоящие на полу.
  // Что исключается даже на каркасе: приборы, стоящие на полу, плюс мойка
  // (под ней сифон, фильтр и трасса слива) и варочная панель (под ней газ,
  // и туда нужен доступ). Столешницы и глухие шкафы уходят на каркас.
  const alwaysExcluded = new Set([
    'fridge', 'dishwasher60', 'dishwasher45', 'washer', 'shower', 'oven',
    'sink', 'sink_corner', 'hob_gas'
  ]);
  const excluded = equipment.filter((e) =>
    kitchenOnFrame
      ? excludesFloor(e) && alwaysExcluded.has(e.catalogId)
      : excludesFloor(e)
  );

  const blockers = [
    ...excluded.map(exclusionRect),
    ...(kitchenOnFrame ? [] : exclusionZones.map((z) => ({ x: z.x, y: z.y, w: z.w, d: z.d, zone: z.id })))
  ];

  const byRoom = rooms.map((room) => {
    const hl = heatLossByRoom.find((r) => r.id === room.id);
    const area = polygonArea(room.polygon);
    const b = polygonBounds(room.polygon);
    const mine = blockers.filter(
      (r) => r.x + r.w > b.minX && r.x < b.maxX && r.y + r.d > b.minY && r.y < b.maxY
    );

    return roomLoops({
      room,
      area,
      roomLoadW: hl ? hl.total : 0,
      airTemp: hl ? hl.tIn : 20,
      manifold,
      coolant,
      preferredSpacing: spacings[room.id],
      exclusions: mine,
      mode,
      edgeZone
    });
  });

  const totalLoops = byRoom.reduce((s, r) => s + r.loops, 0);
  const totalPipe = byRoom.reduce((s, r) => s + r.totalPipe, 0);

  // Разбаланс: длины петель на одном коллекторе не должны сильно расходиться
  const perLoopLengths = byRoom.flatMap((r) => Array(r.loops).fill(r.perLoop));
  const shortest = Math.min(...perLoopLengths);
  const longest = Math.max(...perLoopLengths);
  const imbalance = longest / shortest - 1;

  // Ортогональные подводки от коллектора к началу каждой петли
  const starts = byRoom.flatMap((r) =>
    r.loopPaths.map((pts, i) => ({ roomId: r.id, loopIndex: i, x: pts[0]?.x ?? 0, y: pts[0]?.y ?? 0 }))
  );
  const supply = manifold ? supplyRoutes(manifold, starts) : [];
  const supplyByLoop = {};
  starts.forEach((s, i) => {
    supplyByLoop[`${s.roomId}-${s.loopIndex}`] = supply[i];
  });

  return {
    byRoom,
    supply,
    supplyByLoop,
    totalLoops,
    totalPipe,
    shortest,
    longest,
    imbalance,
    balanced: imbalance <= BALANCE_TOLERANCE,
    limit: maxLoopLength(coolant)
  };
}
