// Сборка трёхмерной сцены из той же модели, что и план.
//
// Модуль ЧИСТЫЙ: он не знает про Three.js и возвращает обычное описание —
// плиты, стены, трубы, кабели и коробки в метрах. Рисует это Scene3D.jsx.
// Разделение нужно, чтобы сцену можно было проверить тестами: главная
// ценность 3D здесь не красота, а ответ на вопрос «что на какой отметке
// лежит и не пересекается ли оно с соседом».
//
// Система координат: x и y — как на плане, в метрах. Отметка `elev` —
// метры ОТ ЧИСТОГО ПОЛА, вниз отрицательные. Пересчёт в оси Three.js
// делает компонент, здесь этой заботы нет.

import { CLEAR_HEIGHT, buildWalls } from '../data/project.js';
import { boundingBox, dims, getFixture } from '../data/fixtures.js';
import { buildWorktop } from '../data/worktop.js';
import { screedStackup } from './geometry.js';

// Цвета слоёв пирога берём те же, что на разрезе, — чтобы 3D и разрез
// читались как одно и то же
export const PIE_OPACITY = {
  finish: 1,
  screed: 0.35, // сквозь стяжку должна быть видна труба — это и есть «рентген»
  insulation: 0.55,
  waterproofing: 0.9,
  sandBed: 0.8,
  gravel: 0.8
};

export const PIPE_RADIUS = 0.008; // 16 мм наружный
export const CABLE_RADIUS = 0.006;

// Отметка оси трубы: она лежит на утеплителе, значит её центр —
// на пол-диаметра выше низа стяжки
export function pipeElevation(screed) {
  const screedBottomMm = screed.finishThickness + screed.screedTotal;
  return -(screedBottomMm - screed.pipeOd / 2) / 1000;
}

// Кабель идёт В УТЕПЛИТЕЛЕ, ниже трубы — чтобы пересечения были безопасны
export function cableElevation(screed, cableOdMm = 12) {
  const insulationTopMm = screed.finishThickness + screed.screedTotal;
  return -(insulationTopMm + cableOdMm / 2) / 1000;
}

export function pieSlabs(screed) {
  return screedStackup(screed).layers.map((l) => ({
    id: l.id,
    name: l.name,
    top: -l.top / 1000,
    bottom: -l.bottom / 1000,
    thickness: l.thickness / 1000,
    color: l.color,
    opacity: PIE_OPACITY[l.id] ?? 0.7,
    layer: 'architecture'
  }));
}

export function wallSolids(layout, height = CLEAR_HEIGHT) {
  return buildWalls(layout).map((w) => ({
    id: w.id,
    kind: w.kind,
    a: w.a,
    b: w.b,
    thickness: w.t,
    // Перегородки гипсокартонные и до перекрытия, наружные — несущие
    bottom: 0,
    top: height,
    layer: 'architecture'
  }));
}

// Марш: каждая ступень отдельной коробкой. Именно так и видно,
// что подступенок 200, а проступь 243 — на плане этого не разглядеть.
export function stairSteps(stair) {
  if (!stair) return [];
  const rise = stair.totalRise / stair.risers;
  const going = stair.tread;
  const steps = [];
  // Нижняя ступень у большего y, марш поднимается в сторону меньшего
  for (let i = 0; i < stair.risers - 1; i++) {
    steps.push({
      id: `step-${i}`,
      x: stair.x,
      y: stair.y + stair.length - (i + 1) * going,
      w: stair.width,
      d: going,
      bottom: i * rise,
      height: rise,
      layer: 'architecture'
    });
  }
  return steps;
}

// Оборудование и мебель. Электроточки берутся коробочками на своей отметке —
// именно так видно, что розетка не попала в проём и не села на столешницу.
export function equipmentBoxes(equipment = []) {
  return equipment
    .map((item) => {
      const spec = getFixture(item.catalogId);
      if (!spec) return null;
      const bb = boundingBox(item);
      const own = dims(item);
      const h = spec.h ?? 0.8;
      const bottom = spec.mountHeight ?? 0;
      return {
        id: item.id,
        name: spec.name,
        category: spec.category,
        // Габарит НЕ повёрнутый плюс сам угол: коробку крутит рендер,
        // иначе повёрнутый прибор выглядел бы толще, чем он есть
        cx: bb.cx,
        cy: bb.cy,
        w: own.w,
        d: own.d,
        rotation: item.rotation ?? 0,
        bottom,
        height: h,
        color: spec.color ?? '#cbd5e1',
        layer: spec.category === 'electrical' ? 'electrical' : 'equipment'
      };
    })
    .filter(Boolean);
}

export function pipeRuns(loops, screed) {
  const elev = pipeElevation(screed);
  const runs = [];

  (loops?.byRoom ?? []).forEach((room) => {
    (room.loopPaths ?? []).forEach((points, i) => {
      if (points.length < 2) return;
      runs.push({
        id: `${room.id}-${i}`,
        name: room.loops > 1 ? `${room.name} ${i + 1}` : room.name,
        points,
        elev,
        radius: PIPE_RADIUS,
        color: '#dc2626',
        kind: 'loop',
        layer: 'heating'
      });
    });
  });

  (loops?.supply ?? []).forEach((s, i) => {
    if (!s?.points || s.points.length < 2) return;
    runs.push({
      id: `supply-${i}`,
      name: 'подводка',
      points: s.points,
      elev,
      radius: PIPE_RADIUS,
      color: '#f97316',
      kind: 'supply',
      layer: 'heating'
    });
  });

  return runs;
}

export function cableRuns(electrical, screed) {
  const elev = cableElevation(screed);
  return (electrical?.routes ?? [])
    .filter((r) => r.points?.length >= 2)
    .map((r) => ({
      id: r.id,
      points: r.points,
      elev,
      radius: CABLE_RADIUS,
      color: '#eab308',
      layer: 'electrical'
    }));
}

// Проёмы. Отметки берём из самой записи: sill и h там уже замерены,
// придумывать свои не надо.
export function openingPanels(openings = [], layout) {
  const walls = buildWalls(layout);
  return openings
    .map((o) => {
      const wall = walls.find((w) => w.id === o.wallId);
      if (!wall) return null;
      const dx = wall.b.x - wall.a.x;
      const dy = wall.b.y - wall.a.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      return {
        id: o.id,
        kind: o.kind,
        wallId: wall.id,
        thickness: wall.t,
        a: { x: wall.a.x + ux * o.start, y: wall.a.y + uy * o.start },
        b: { x: wall.a.x + ux * (o.start + o.len), y: wall.a.y + uy * (o.start + o.len) },
        bottom: o.sill ?? 0,
        height: o.h ?? 2.05,
        blind: !!o.blind,
        confirmed: o.confirmed !== false,
        layer: 'architecture'
      };
    })
    .filter(Boolean);
}

// Столешница как плита с вырезами. Приборы под ней остаются нарисованными:
// в «рентгене» и должно быть видно, что стоит под плоскостью.
export function worktopSlab(layout, equipment) {
  const w = buildWorktop(layout, equipment);
  if (!w) return null;
  return {
    id: 'worktop',
    polygon: w.polygon,
    cutouts: w.cutouts,
    bottom: w.bottom,
    top: w.top,
    thickness: w.thickness,
    color: '#9ca3af', // бетон
    layer: 'equipment',
    beneath: w.beneath,
    runM: w.runM,
    area: w.area
  };
}

export function buildScene({ project, loops, electrical, height = CLEAR_HEIGHT }) {
  const { layout, screed, equipment, stair, openings } = project;
  const pie = pieSlabs(screed);

  return {
    height,
    pieBottom: pie.length ? pie[pie.length - 1].bottom : 0,
    slabs: pie,
    walls: wallSolids(layout, height),
    steps: stairSteps(stair),
    boxes: equipmentBoxes(equipment),
    worktop: worktopSlab(layout, equipment),
    pipes: pipeRuns(loops, screed),
    cables: cableRuns(electrical, screed),
    openings: openingPanels(openings, layout)
  };
}
