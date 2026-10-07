// Геометрические примитивы плана. Чистые функции, без React.
// Все координаты — в метрах, толщины пирога пола — в миллиметрах.

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return Math.abs(a / 2);
}

export function polygonBounds(poly) {
  const xs = poly.map((p) => p.x);
  const ys = poly.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys)
  };
}

export function pointInPolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function roomOfPoint(rooms, x, y) {
  return rooms.find((r) => pointInPolygon(r.polygon, x, y)) || null;
}

// ---------- Стены ----------

export function wallVector(wall) {
  const dx = wall.b.x - wall.a.x;
  const dy = wall.b.y - wall.a.y;
  const len = Math.hypot(dx, dy);
  return { dx, dy, len, ux: dx / len, uy: dy / len };
}

export function pointAlongWall(wall, dist) {
  const { ux, uy } = wallVector(wall);
  return { x: wall.a.x + ux * dist, y: wall.a.y + uy * dist };
}

// Прямоугольник стены для отрисовки.
// Наружные стены откладываются НАРУЖУ от внутренней линии (outward),
// перегородки — симметрично относительно оси.
export function wallRect(wall) {
  const { ux, uy } = wallVector(wall);
  const minX = Math.min(wall.a.x, wall.b.x);
  const maxX = Math.max(wall.a.x, wall.b.x);
  const minY = Math.min(wall.a.y, wall.b.y);
  const maxY = Math.max(wall.a.y, wall.b.y);
  const horizontal = Math.abs(ux) > Math.abs(uy);

  if (wall.kind === 'outer') {
    const o = wall.outward;
    if (horizontal) {
      const y = o.y < 0 ? minY - wall.t : minY;
      // Наружные стены смыкаются в углах — расширяем на толщину в обе стороны
      return { x: minX - wall.t, y, w: maxX - minX + wall.t * 2, h: wall.t };
    }
    const x = o.x < 0 ? minX - wall.t : minX;
    return { x, y: minY - wall.t, w: wall.t, h: maxY - minY + wall.t * 2 };
  }

  if (horizontal) {
    return { x: minX, y: minY - wall.t / 2, w: maxX - minX, h: wall.t };
  }
  return { x: minX - wall.t / 2, y: minY, w: wall.t, h: maxY - minY };
}

// Прямоугольник проёма в плане — вырез в стене на всю её толщину.
export function openingRect(wall, opening) {
  const rect = wallRect(wall);
  const { ux } = wallVector(wall);
  const horizontal = Math.abs(ux) > 0.5;
  const p0 = pointAlongWall(wall, opening.start);
  const p1 = pointAlongWall(wall, opening.start + opening.len);

  if (horizontal) {
    return {
      x: Math.min(p0.x, p1.x),
      y: rect.y,
      w: Math.abs(p1.x - p0.x),
      h: rect.h
    };
  }
  return {
    x: rect.x,
    y: Math.min(p0.y, p1.y),
    w: rect.w,
    h: Math.abs(p1.y - p0.y)
  };
}

// Геометрия открывания двери.
//   hinge — у какого края проёма петли: 'a' ближе к началу стены, 'b' дальше
//   swing — в какую сторону уходит створка: +1 по нормали к стене, −1 против.
// Нормаль получается поворотом направления стены на +90°.
export function doorSwing(wall, opening) {
  const { ux, uy } = wallVector(wall);
  const nx = -uy;
  const ny = ux;
  const s = opening.swing ?? 1;

  const atA = (opening.hinge ?? 'a') === 'a';
  const hingeDist = atA ? opening.start : opening.start + opening.len;
  const closedDist = atA ? opening.start + opening.len : opening.start;

  const hinge = pointAlongWall(wall, hingeDist);
  const closed = pointAlongWall(wall, closedDist);
  const open = {
    x: hinge.x + nx * s * opening.len,
    y: hinge.y + ny * s * opening.len
  };

  // Направление обхода дуги от закрытого положения к открытому
  const cross = (closed.x - hinge.x) * (open.y - hinge.y) - (closed.y - hinge.y) * (open.x - hinge.x);
  return { hinge, closed, open, sweep: cross > 0 ? 1 : 0 };
}

// ---------- Лестница ----------

export const STAIR_STRUCTURE_THICKNESS = 0.15; // m, stringers + step

export function stairFootprint(stair) {
  return { x: stair.x, y: stair.y, w: stair.width, h: stair.length };
}

// Высота прохода под маршем в точке (px, py).
// Марш поднимается в сторону уменьшения y: низ у (y + length), верх у y.
// Возвращает null, если точка вне пятна лестницы.
export function stairHeadroom(stair, px, py, clearHeight) {
  const f = stairFootprint(stair);
  if (px < f.x || px > f.x + f.w || py < f.y || py > f.y + f.h) return null;

  const risePerStep = stair.totalRise / stair.risers;
  const slope = risePerStep / stair.tread; // rise per metre of projection
  const run = f.y + f.h - py; // distance from the bottom step
  const treadTop = run * slope;
  const underside = treadTop - STAIR_STRUCTURE_THICKNESS;

  return Math.max(0, Math.min(underside, clearHeight));
}

// Что достижимо для прямого марша в этих габаритах.
// Заход снизу и площадка наверху съедают длину; на оставшуюся проекцию
// перебираем число подступенков и смотрим, какое сочетание проходит по всем
// критериям. Это превращает предупреждение в готовый ответ.
export function stairOptions(stair, innerDepth, norms = STAIR_NORMS) {
  const maxRun = innerDepth - stair.minApproach - stair.minLanding;

  const options = [];
  for (let n = 12; n <= 20; n++) {
    const candidate = { ...stair, risers: n, tread: maxRun / (n - 1), length: maxRun };
    const c = stairCheck(candidate, norms);
    const passed = [c.riseOk, c.treadOk, c.blondelOk, c.comfortOk, c.angleOk].filter(Boolean).length;
    options.push({ risers: n, run: maxRun, ...c, passed, allOk: passed === 5 });
  }

  // Лучший — прошедший больше критериев; при равенстве меньше ступеней
  const best = options.reduce((a, b) => (b.passed > a.passed ? b : a), options[0]);

  return { maxRun, options, best };
}

// Совместимость с прежним вызовом: предел проступи при текущем числе ступеней.
export function stairEnvelope(stair, innerDepth, norms = STAIR_NORMS) {
  const { maxRun, best } = stairOptions(stair, innerDepth, norms);
  return {
    maxRun,
    maxTread: maxRun / (stair.risers - 1),
    risePerStep: stair.totalRise / stair.risers,
    best,
    comfortReachable: maxRun / (stair.risers - 1) >= norms.minTread
  };
}

// Точка присоединения к стояку — его центр, а не угол габарита.
export function riserPoint(riser) {
  return { x: riser.x + riser.w / 2, y: riser.y + riser.d / 2 };
}

// Ориентиры для марша. Это ПРЕДПОЛОЖЕНИЯ до сверки с актуальным текстом СП —
// инструмент считает соответствие, а не выдаёт нормы за проверенную истину.
export const STAIR_NORMS = {
  blondel: [0.6, 0.65], // 2h + s, the “stride” formula
  comfort: 0.45, // h + s, the comfort formula
  comfortTolerance: 0.02,
  minTread: 0.23, // tread depth
  maxRise: 0.2, // riser height
  minWidth: 0.9, // step (flight) width — to be refined for a single-family house
  maxAngleDeg: 40
};

// Полный расчёт марша: геометрия ступени и обе формулы.
//   h — высота ступени (подступенок)
//   s — ширина проступи
//   width — ширина ступени, она же ширина марша
export function stairCheck(stair, norms = STAIR_NORMS) {
  const h = stair.totalRise / stair.risers;
  const s = stair.tread;
  const run = s * (stair.risers - 1); // projection without the top landing
  const angleDeg = (Math.atan(h / s) * 180) / Math.PI;
  const blondel = 2 * h + s;
  const comfort = h + s;

  // Полмиллиметра допуска: точнее на объекте всё равно не построить,
  // а без него значение ровно на границе нормы «проваливается» из-за
  // погрешности двоичной арифметики.
  const T = 0.0005;

  return {
    risePerStep: h,
    tread: s,
    width: stair.width,
    angleDeg,
    blondel,
    blondelOk: blondel >= norms.blondel[0] - T && blondel <= norms.blondel[1] + T,
    comfort,
    comfortOk: Math.abs(comfort - norms.comfort) <= norms.comfortTolerance + T,
    requiredRun: run,
    actualRun: stair.length,
    fits: run <= stair.length + 1e-6,
    riseOk: h <= norms.maxRise + T,
    treadOk: s >= norms.minTread - T,
    widthOk: stair.width >= norms.minWidth - T,
    angleOk: angleDeg <= norms.maxAngleDeg + 0.05,
    // Значение упирается в границу нормы — запаса нет
    riseTight: Math.abs(h - norms.maxRise) < 0.002,
    blondelTight: Math.abs(blondel - norms.blondel[1]) < 0.005 || Math.abs(blondel - norms.blondel[0]) < 0.005
  };
}

// ---------- Трассы канализации ----------

// Манхэттенская трасса от точки прибора до стояка: сначала по Y, потом по X.
export function drainRoute(from, riser) {
  const corner = { x: from.x, y: riser.y };
  const pts = [{ x: from.x, y: from.y }, corner, { x: riser.x, y: riser.y }];
  let length = 0;
  for (let i = 1; i < pts.length; i++) {
    length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return { points: pts, length };
}

export const DRAIN_SLOPE = 0.02; // 2 cm per metre

// Помещается ли слив в пирог пола.
// Отсчёт в мм от чистого пола, вниз — отрицательные значения.
//
// Труба у прибора должна лежать НИЖЕ низа стяжки, при этом её лоток поднят
// над лотком стояка на (длина × уклон). Самое узкое место пола по грунту.
export function drainFit({ routeLength, dia, riserInvertM, screed }) {
  const underScreedMm = -(screed.finishThickness + screed.screedTotal);
  const bottomOfInsulationMm = underScreedMm - screed.insulation;

  const invertMm = riserInvertM * 1000 + routeLength * DRAIN_SLOPE * 1000;
  const crownMm = invertMm + dia;

  return {
    invertMm,
    crownMm,
    underScreedMm,
    bottomOfInsulationMm,
    // Запас до низа стяжки: отрицательный — труба лезет в стяжку
    marginMm: underScreedMm - crownMm,
    ok: crownMm <= underScreedMm,
    // Опустилась ли труба ниже утеплителя — тогда режем подсыпку, это допустимо,
    // но требует отдельного решения по опиранию
    belowInsulation: invertMm < bottomOfInsulationMm
  };
}

// ---------- Пирог пола ----------

// ---------- Потери в грунт через поле пола ----------
//
// УПРОЩЁННАЯ одномерная оценка: поток вниз в середине пола.
// Периметр здесь НЕ учитывается — он считается отдельно и через торцевой
// утеплитель, потому что там перепад вдвое больше и задача уже двумерная.
// Все коэффициенты — ориентиры, их нужно подтвердить.
export const GROUND_DEFAULTS = {
  lambdaXps: 0.034, // W/(m·K), XPS
  lambdaScreed: 1.2, // cement-sand screed
  lambdaFinish: 0.2, // finish covering
  rSoil: 1.5, // effective resistance of the ground under the insulated slab
  deltaT: 20, // mean “screed ↔ ground” difference, K
  seasonHours: 5000 // hours of the heating season
};

export function groundLoss(screed, area, p = GROUND_DEFAULTS) {
  const rIns = screed.insulation / 1000 / p.lambdaXps;
  const rScreed = screed.screedTotal / 1000 / p.lambdaScreed;
  const rFinish = screed.finishThickness / 1000 / p.lambdaFinish;
  const rTotal = rIns + rScreed + rFinish + p.rSoil;
  const q = p.deltaT / rTotal;
  return {
    rIns,
    rTotal,
    q, // W/m²
    watts: q * area,
    kwhPerSeason: (q * area * p.seasonHours) / 1000
  };
}

// Сравнение толщин утеплителя: тепло, песок, общая высота пирога.
// Толще утеплитель — меньше песка засыпать, и это часть экономики.
export function insulationOptions(screed, levels, area, thicknesses, p = GROUND_DEFAULTS) {
  return thicknesses.map((mm) => {
    const variant = { ...screed, insulation: mm };
    const pie = screedStackup(variant).total;
    return {
      insulation: mm,
      pie,
      sandNeeded: levels.crawlDepth - pie,
      ...groundLoss(variant, area, p)
    };
  });
}

// ---------- Отметки: подполье засыпается песком ----------
//
// Дом куплен готовым, на первом этаже деревянный пол по лагам, под ним —
// подполье до песка. Пол по грунту получается засыпкой этого подполья.
// Всё в миллиметрах; 0 = существующий чистый деревянный пол.
export function floorLevels(levels, screed) {
  const pie = screedStackup(screed).total;

  // Верх нового пирога относительно старого пола: > 0 — пол поднялся
  const floorDelta = -levels.crawlDepth + levels.sandFill + pie;

  const clearHeight = levels.clearHeightNow - floorDelta;
  const floorToFloor = levels.floorToFloorNow - floorDelta;
  const compactLayers = Math.ceil(levels.sandFill / Math.max(1, levels.compactLayer));

  return {
    pie,
    floorDelta,
    clearHeight,
    floorToFloor,
    compactLayers,
    // Сколько песка нужно, чтобы новый пол встал ровно на месте старого
    sandForNoChange: levels.crawlDepth - pie
  };
}

export function screedStackup(screed) {
  const layers = [
    { id: 'finish', name: 'Finish covering', thickness: screed.finishThickness, color: '#a16207' },
    { id: 'screed', name: 'Screed with heating pipe', thickness: screed.screedTotal, color: '#94a3b8' },
    { id: 'insulation', name: 'XPS', thickness: screed.insulation, color: '#fbbf24' },
    { id: 'waterproofing', name: 'Waterproofing', thickness: screed.waterproofing, color: '#1e293b' },
    { id: 'sandBed', name: 'Sand bed', thickness: screed.sandBed ?? 0, color: '#fbbf24' },
    { id: 'gravel', name: 'Crushed stone, capillary break', thickness: screed.gravel, color: '#78716c' }
  ];
  const total = layers.reduce((s, l) => s + l.thickness, 0);
  let top = 0;
  const withOffsets = layers.map((l) => {
    const o = { ...l, top, bottom: top + l.thickness };
    top += l.thickness;
    return o;
  });
  return { layers: withOffsets, total };
}
