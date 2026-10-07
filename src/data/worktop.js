// Столешница кухни.
//
// Она НЕ ХРАНИТСЯ в состоянии, а ВЫВОДИТСЯ из расстановки — по тому же
// правилу, что стены и помещения выводятся из четырёх чисел планировки.
// Двинули посудомойку — фронт пересчитался сам, и не надо помнить,
// что где-то лежит отдельный полигон, который тоже надо подвинуть.
//
// Геометрия угловая: ветка вдоль верхней стены дома плюс ветка вдоль
// перегородки санузла. Начинается от холодильника (он полноростовой
// и под столешницу не уходит) и кончается вместе с перегородкой.
//
// Приборы делятся на два вида, и это принципиально:
//   • стоят ПОД столешницей — духовой шкаф, посудомойка, шкафы;
//   • ВРЕЗАЮТСЯ в неё — варочная панель и мойка (`builtInTop`).
// Первым нужен просвет под низом плиты, вторым — вырез в ней.

import { boundingBox, getFixture } from './fixtures.js';

export const WORKTOP = {
  // Отметка ВЕРХА. 900 — стандарт; ниже неудобно мыть, выше неудобно резать.
  top: 0.9,
  // Бетон по стальному каркасу на закладных, 40 мм.
  //
  // Толщину решает НЕ поле плиты: пролёт 500 между продольными уголками
  // не гнётся ни при какой разумной толщине. Решают три другие вещи:
  //   • перемычка у выреза мойки — но у нас продольный уголок идёт
  //     в 50 мм от кромки, то есть ПРЯМО ПОД ней, и пролёта там нет;
  //   • защитный слой: 40 − 2 × 15 = 10 мм на арматуру, Ø4 влезает,
  //     Ø6 уже нет. При 30 мм не остаётся ничего;
  //   • просвет под плитой: 40 даёт 860, и посудомойка 850 наконец входит.
  // При 60 мм просвет 840 — прибор не проходил.
  thickness: 0.04,
  depth: 0.6,
  material: 'бетон по стальному каркасу',
  // Приборы выше этого считаются полноростовыми: столешница до них,
  // а не над ними
  tallThreshold: 1.2
};

function itemBox(item) {
  const spec = getFixture(item.catalogId);
  if (!spec) return null;
  const bb = boundingBox(item);
  return { id: item.id, spec, ...bb, h: spec.h ?? 0.9 };
}

// Ветка вдоль стены: от какого x до какого. Полноростовой прибор
// слева отодвигает начало — столешница начинается ОТ него.
function spanFrom(boxes, key, size, tall) {
  const lo = Math.min(...boxes.map((b) => b[key]));
  const hi = Math.max(...boxes.map((b) => b[key] + b[size]));
  const blocker = tall
    .filter((t) => t[key] + t[size] <= lo + 0.05)
    .sort((a, b) => b[key] + b[size] - (a[key] + a[size]))[0];
  return { from: blocker ? blocker[key] + blocker[size] : lo, to: hi };
}

export function buildWorktop(layout, equipment = [], spec = WORKTOP) {
  const boxes = equipment
    .map(itemBox)
    .filter((b) => b && b.spec.category === 'kitchen' && !b.spec.wallMounted);

  const under = boxes.filter((b) => b.h <= spec.tallThreshold);
  const tall = boxes.filter((b) => b.h > spec.tallThreshold);
  if (!under.length) return null;

  const mirrored = layout.variant === 'bathLeft';
  // Вертикальная ветка идёт по перегородке санузла: в bathRight она слева
  // от санузла, в bathLeft кухня уходит на правую стену дома.
  const legX = mirrored ? layout.bathW : layout.bathX;
  const legEndY = mirrored ? layout.bathBottom : layout.bathY;

  // Что относится к верхней ветке, а что к вертикальной
  const topRow = under.filter((b) => b.y < spec.depth * 0.25);
  const sideRow = under.filter((b) => !topRow.includes(b));

  const topSpan = topRow.length ? spanFrom(topRow, 'x', 'w', tall) : null;
  const hasSide = sideRow.length > 0;

  // Верхняя ветка доводится до перегородки: обрывать её раньше нельзя,
  // иначе в углу остаётся дыра
  const aFrom = topSpan ? topSpan.from : legX - spec.depth;
  const aTo = mirrored ? Math.max(topSpan?.to ?? 0, layout.bathW + spec.depth) : legX;

  const bX0 = mirrored ? legX : legX - spec.depth;
  const bX1 = mirrored ? legX + spec.depth : legX;
  const bY1 = hasSide ? legEndY : spec.depth;

  // Полигон буквой Г. Если вертикальной ветки нет — вырождается в прямоугольник.
  const polygon = hasSide
    ? [
        { x: aFrom, y: 0 },
        { x: aTo, y: 0 },
        { x: bX1, y: bY1 },
        { x: bX0, y: bY1 },
        { x: bX0, y: spec.depth },
        { x: aFrom, y: spec.depth }
      ]
    : [
        { x: aFrom, y: 0 },
        { x: aTo, y: 0 },
        { x: aTo, y: spec.depth },
        { x: aFrom, y: spec.depth }
      ];

  // Вырезы — приборы, врезанные В плиту. Габарит берём повёрнутый:
  // мойка стоит под 45°, и её вырез не прямоугольник по осям.
  const cutouts = boxes
    .filter((b) => b.spec.builtInTop)
    .map((b) => {
      const item = equipment.find((e) => e.id === b.id);
      const own = { w: item.w ?? b.spec.w, d: item.d ?? b.spec.d };
      return {
        id: b.id,
        name: b.spec.name,
        cx: b.cx,
        cy: b.cy,
        w: own.w,
        d: own.d,
        rotation: item.rotation ?? 0
      };
    });

  // Приборы ПОД плитой и просвет над каждым.
  // Корпуса шкафов (`carcass`) в проверку не идут: их высота подстраивается
  // под столешницу по определению, спорить им с ней не о чем.
  const clearance = spec.top - spec.thickness;
  const beneath = under
    .filter((b) => !b.spec.builtInTop && !b.spec.carcass)
    .map((b) => ({
      id: b.id,
      name: b.spec.name,
      height: b.h,
      clearance,
      margin: clearance - b.h,
      fits: b.h <= clearance + 1e-9
    }));

  const carcasses = under
    .filter((b) => b.spec.carcass)
    .map((b) => ({ id: b.id, name: b.spec.name, height: clearance }));

  const runM = hasSide
    ? aTo - aFrom + (bY1 - spec.depth)
    : aTo - aFrom;

  return {
    ...spec,
    bottom: spec.top - spec.thickness,
    polygon,
    cutouts,
    beneath,
    carcasses,
    tall: tall.map((t) => ({ id: t.id, name: t.spec.name, height: t.h })),
    runM,
    // Площадь по контуру без вычета вырезов: бетон льётся сплошным,
    // вырезы делаются формой, но материал в них всё равно расходуется
    area: polygonAreaOf(polygon)
  };
}

function polygonAreaOf(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += poly[j].x * poly[i].y - poly[i].x * poly[j].y;
  }
  return Math.abs(a / 2);
}
