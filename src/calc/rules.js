// Валидатор конфликтов — главная ценность инструмента ДО заливки стяжки.
// Каждое правило возвращает предупреждение с привязкой к точке плана,
// чтобы по клику можно было перейти к проблемному месту.

import {
  boundingBox,
  connectionPoints,
  corners,
  excludesFloor,
  footprint,
  getFixture,
  shapesOverlap
} from '../data/fixtures.js';
import { INNER_D, INNER_W, buildRooms, buildWalls } from '../data/project.js';
import { buildWorktop } from '../data/worktop.js';
import { backSupportOptions, slabThicknessOptions } from './fabrication.js';

// Рабочий проход: сколько нужно человеку, стоящему у столешницы.
// Комфорт — развернуться с тарелкой, минимум — протиснуться боком.
export const WORK_AISLE = { comfort: 1.0, min: 0.9 };
import { coolantAge, maxLoopLength, volumetricRatio } from '../data/coolant.js';
import { boilerCheck, houseCooldown } from './boiler.js';
import { boilerRoomPlan } from './boilerRoom.js';
import { systemHydraulics } from './hydraulics.js';
import { heatLoss } from './heatloss.js';
import { BACK_BOX, CABLE_OD_MM, IN_FLOOR, ROUTE } from './electrical.js';
import { LV, lowVoltagePlan } from './lowVoltage.js';
import { emergencyPanel } from './emergencyPanel.js';
import { EDGE_ZONE, MIN_FURNITURE_GAP, layoutLoops, overlapsEdgeZone } from './loops.js';
import { upsSizing } from './ups.js';
import { backBoxCheck, windowsCheck } from './condensation.js';
import { WATER_PER_M3_GAS, cookingMoisture, ventilationPlan } from './ventilation.js';
import {
  STAIR_NORMS,
  drainFit,
  drainRoute,
  floorLevels,
  pointInPolygon,
  pointAlongWall,
  riserPoint,
  openingRect,
  roomOfPoint,
  screedStackup,
  stairCheck,
  stairHeadroom,
  stairOptions
} from './geometry.js';

const SEVERITY = { error: 3, warn: 2, info: 1 };

export function sortBySeverity(list) {
  return [...list].sort((a, b) => SEVERITY[b.severity] - SEVERITY[a.severity]);
}

// Требуемая высота под маршем.
// По умолчанию — собственная высота прибора плюс 50 мм на монтаж: под лестницу
// специально загоняют низкие шкафы, и запрещать это было бы неверно.
// Исключения — приборы, которыми пользуются стоя или сидя.
const HEADROOM_OVERRIDE = {
  wc: 1.3, // над унитазом сидят
  basin: 1.9,
  shower: 2.0,
  washer: 1.4,
  fridge: 2.05
};

// Комфортная высота над рабочей зоной кухни (мойка, варочная панель)
const WORKSTATION_HEADROOM = 1.9;

function requiredHeadroom(catalogId, spec) {
  return HEADROOM_OVERRIDE[catalogId] ?? spec.h + 0.05;
}

// Досягаемость существующего ввода газа для варочной панели, м
const GAS_REACH = 1.5;

export function runRules(project, clearHeight) {
  const out = [];
  const { layout, equipment, nodes, stair, screed, openings, levels } = project;
  const rooms = buildRooms(layout);
  const walls = buildWalls(layout);

  const riser = nodes.find((n) => n.type === 'sewer_riser');
  const gasPoints = nodes.filter((n) => n.type === 'gas_point');

  // --- 1. Уклон канализации от каждого прибора до стояка ---
  if (riser) {
    const riserAt = riserPoint(riser);
    equipment.forEach((item) => {
      const spec = getFixture(item.catalogId);
      if (!spec) return;
      connectionPoints(item)
        .filter((c) => c.kind === 'drain')
        .forEach((c) => {
          const route = drainRoute(c, riserAt);
          const fit = drainFit({
            routeLength: route.length,
            dia: c.dia,
            riserInvertM: riser.invert ?? -0.35,
            screed
          });

          if (!fit.ok) {
            out.push({
              id: `drain-${c.id}`,
              severity: 'error',
              layer: 'plumbing',
              title: `Слив «${spec.name}» не помещается в пирог пола`,
              detail:
                `Трасса ${route.length.toFixed(2)} м при уклоне 2 см/м поднимает лоток до ` +
                `${fit.invertMm.toFixed(0)} мм, верх трубы Ø${c.dia} — до ${fit.crownMm.toFixed(0)} мм ` +
                `от чистого пола. Низ стяжки на ${fit.underScreedMm.toFixed(0)} мм. ` +
                `Не хватает ${Math.abs(fit.marginMm).toFixed(0)} мм.`,
              fix: 'Сдвинуть прибор ближе к стояку, уменьшить ЭППС/стяжку или опустить лоток стояка.',
              at: { x: c.x, y: c.y }
            });
          } else if (fit.marginMm < 20) {
            out.push({
              id: `drain-tight-${c.id}`,
              severity: 'warn',
              layer: 'plumbing',
              title: `Слив «${spec.name}» проходит впритык`,
              detail: `Запас до низа стяжки всего ${fit.marginMm.toFixed(0)} мм при трассе ${route.length.toFixed(2)} м.`,
              fix: 'Заложить запас — на объекте отметки всегда «плывут».',
              at: { x: c.x, y: c.y }
            });
          }

          if (c.critical && fit.ok && fit.belowInsulation) {
            out.push({
              id: `drain-deep-${c.id}`,
              severity: 'info',
              layer: 'plumbing',
              title: `«${spec.name}»: труба уходит ниже утеплителя`,
              detail: 'Лоток опускается в подсыпку — это допустимо, но требует локального решения по опиранию и утеплению трубы.',
              at: { x: c.x, y: c.y }
            });
          }
        });
    });
  } else {
    out.push({
      id: 'no-riser',
      severity: 'warn',
      layer: 'plumbing',
      title: 'Не задан стояк канализации',
      detail: 'Без точки стояка невозможно проверить уклоны сливов.'
    });
  }

  // --- 2. Высота прохода под маршем лестницы ---
  if (stair) {
    equipment.forEach((item) => {
      const spec = getFixture(item.catalogId);
      if (!spec) return;
      const fp = footprint(item);
      const cx = item.x + fp.w / 2;
      const cy = item.y + fp.d / 2;
      const head = stairHeadroom(stair, cx, cy, clearHeight);
      if (head === null) return;

      const req = requiredHeadroom(item.catalogId, spec);
      if (head < req) {
        out.push({
          id: `head-${item.id}`,
          severity: head < req - 0.3 ? 'error' : 'warn',
          layer: 'architecture',
          title: `Под маршем мало высоты для «${spec.name}»`,
          detail: `В центре прибора высота под лестницей ${head.toFixed(2)} м, требуется ${req.toFixed(2)} м.`,
          fix: 'Переставить прибор в сторону высокой части марша либо сдвинуть лестницу.',
          at: { x: cx, y: cy }
        });
      } else if (spec.workstation && head < WORKSTATION_HEADROOM) {
        // Прибор влезает, но работать за ним под низким маршем неудобно.
        out.push({
          id: `work-${item.id}`,
          severity: 'info',
          layer: 'equipment',
          title: `За «${spec.name}» под маршем будет тесно`,
          detail: `Высота над прибором ${head.toFixed(2)} м. Сам он помещается, но стоять и работать комфортно от ${WORKSTATION_HEADROOM.toFixed(2)} м.`,
          fix: 'Рабочую зону — ближе к высокой части марша, под низкую убрать глухие шкафы.',
          at: { x: cx, y: cy }
        });
      }
    });

    // --- 3. Нормы марша ---
    const sc = stairCheck(stair);
    if (!sc.fits) {
      out.push({
        id: 'stair-run',
        severity: 'error',
        layer: 'architecture',
        title: 'Марш не помещается в отведённую длину',
        detail: `${stair.risers} подступенков по ${sc.risePerStep.toFixed(3)} м требуют проекции ${sc.requiredRun.toFixed(2)} м, отведено ${sc.actualRun.toFixed(2)} м.`,
        fix: 'Увеличить длину марша, добавить забежные ступени или площадку.',
        at: { x: stair.x + stair.width / 2, y: stair.y + stair.length / 2 }
      });
    }
    if (!sc.riseOk) {
      out.push({
        id: 'stair-rise',
        severity: 'warn',
        layer: 'architecture',
        title: 'Подступенок выше 200 мм',
        detail: `Расчётный подъём ${(sc.risePerStep * 1000).toFixed(0)} мм.`,
        fix: 'Добавить ступеней.',
        at: { x: stair.x + stair.width / 2, y: stair.y + stair.length / 2 }
      });
    }
    if (!sc.treadOk) {
      out.push({
        id: 'stair-tread',
        severity: 'warn',
        layer: 'architecture',
        title: 'Проступь меньше 230 мм',
        detail: `Проступь ${(sc.tread * 1000).toFixed(0)} мм — на такой ступени неудобно спускаться.`,
        at: { x: stair.x + stair.width / 2, y: stair.y + stair.length / 2 }
      });
    }
    if (!sc.blondelOk) {
      out.push({
        id: 'stair-blondel',
        severity: 'info',
        layer: 'architecture',
        title: 'Формула удобства вне диапазона',
        detail: `2h + b = ${sc.blondel.toFixed(3)} м, комфортный диапазон 0,60–0,65 м.`,
        at: { x: stair.x + stair.width / 2, y: stair.y + stair.length / 2 }
      });
    }
    if (!sc.widthOk) {
      out.push({
        id: 'stair-width',
        severity: 'info',
        layer: 'architecture',
        title: `Ширина ступени ${(stair.width * 1000).toFixed(0)} мм — меньше ориентира 900`,
        detail:
          `Сейчас ${(stair.existingWidth * 1000).toFixed(0)} мм, проектируется ` +
          `${(stair.width * 1000).toFixed(0)} мм — заметно лучше, но до 900 не дотягивает. ` +
          'Ориентир предположительный, сверьте с актуальным текстом СП.',
        at: { x: stair.x + stair.width / 2, y: stair.y + stair.length / 2 }
      });
    }
    if (!sc.angleOk) {
      out.push({
        id: 'stair-angle',
        severity: 'warn',
        layer: 'architecture',
        title: `Угол наклона ${sc.angleDeg.toFixed(1)}° — круче ${STAIR_NORMS.maxAngleDeg}°`,
        detail:
          `При высоте ступени ${(sc.risePerStep * 1000).toFixed(0)} и проступи ` +
          `${(sc.tread * 1000).toFixed(0)} мм марш получается крутым.`,
        fix: 'Увеличить проступь — это возможно только за счёт длины марша, то есть проёма.',
        at: { x: stair.x + stair.width / 2, y: stair.y + stair.length / 2 }
      });
    }
    if (!sc.comfortOk) {
      out.push({
        id: 'stair-comfort',
        severity: 'info',
        layer: 'architecture',
        title: `Формула удобства h + s = ${(sc.comfort * 1000).toFixed(0)} мм вместо ~450`,
        detail:
          `Высота ступени ${(sc.risePerStep * 1000).toFixed(0)} + проступь ` +
          `${(sc.tread * 1000).toFixed(0)} мм. Ниже 450 — шаг получается мелким и частым.`,
        at: { x: stair.x + stair.width / 2, y: stair.y + stair.length / 2 }
      });
    }

    // --- 3a. Заход снизу и площадка наверху: минимум по 1 м ---
    const approach = INNER_D - (stair.y + stair.length);
    if (stair.minApproach && approach < stair.minApproach - 0.02) {
      out.push({
        id: 'stair-approach',
        severity: 'error',
        layer: 'architecture',
        title: `Заход перед лестницей ${(approach * 1000).toFixed(0)} мм — меньше метра`,
        detail: `Перед нижней ступенью нужно не менее ${(stair.minApproach * 1000).toFixed(0)} мм, чтобы на неё можно было выйти.`,
        fix: 'Поднять низ марша обратно. Удлинять марш можно только вверх, за счёт проёма.',
        at: { x: stair.x + stair.width / 2, y: stair.y + stair.length }
      });
    }
    if (stair.minLanding && stair.y < stair.minLanding - 0.02) {
      out.push({
        id: 'stair-landing',
        severity: 'error',
        layer: 'architecture',
        title: `Площадка наверху ${(stair.y * 1000).toFixed(0)} мм — меньше метра`,
        detail:
          `Над отрезком 0…${stair.y.toFixed(2)} м на втором этаже должна остаться площадка ` +
          `не менее ${(stair.minLanding * 1000).toFixed(0)} мм, чтобы сойти с марша. Сейчас её не хватает.`,
        fix: 'Опустить верх марша либо уменьшить проступь.',
        at: { x: stair.x + stair.width / 2, y: stair.y }
      });
    }

    // --- 3c. Подбор лучшего прямого марша в этих габаритах ---
    const { maxRun, best } = stairOptions(stair, INNER_D);
    const currentPasses = [sc.riseOk, sc.treadOk, sc.blondelOk, sc.comfortOk, sc.angleOk]
      .filter(Boolean).length;

    if (best.passed > currentPasses) {
      out.push({
        id: 'stair-best',
        severity: 'info',
        layer: 'architecture',
        title: best.allOk
          ? `Есть вариант, проходящий по всем критериям: ${best.risers} подступенков`
          : `Лучше подходит ${best.risers} подступенков`,
        detail:
          `При заходе ${(stair.minApproach * 1000).toFixed(0)} и площадке ` +
          `${(stair.minLanding * 1000).toFixed(0)} мм на марш остаётся ${maxRun.toFixed(2)} м. ` +
          `${best.risers} подступенков дают высоту ступени ${(best.risePerStep * 1000).toFixed(0)}, ` +
          `проступь ${(best.tread * 1000).toFixed(0)} мм, угол ${best.angleDeg.toFixed(1)}°, ` +
          `2h + s = ${(best.blondel * 1000).toFixed(0)}, h + s = ${(best.comfort * 1000).toFixed(0)} мм. ` +
          `Сейчас ${stair.risers} подступенков: проступь ${(sc.tread * 1000).toFixed(0)} мм, ` +
          `2h + s = ${(sc.blondel * 1000).toFixed(0)}.`,
        fix: `Поставить ${best.risers} подступенков и проекцию ${maxRun.toFixed(2)} м.`,
        at: { x: stair.x + stair.width / 2, y: stair.y + stair.length / 2 }
      });
    }

    // --- 3b. Сдвиг проёма в перекрытии над санузлом ---
    // Проём менять можно — это и есть способ сделать марш пологим.
    const shift = stair.existingOpeningTopY - stair.y;
    if (shift > 0.02) {
      const existingRun = stair.existingRun ?? stair.existingBottomY - stair.existingOpeningTopY;
      const existingTread = existingRun / Math.max(1, stair.risers - 1);
      out.push({
        id: 'stair-opening',
        severity: 'info',
        layer: 'architecture',
        title: `Проём нужно сдвинуть на ${(shift * 1000).toFixed(0)} мм над санузлом`,
        detail:
          `Существующий проём заканчивается на отметке ${stair.existingOpeningTopY.toFixed(2)} м: ` +
          `при ${stair.risers} подступенках это проекция ${existingRun.toFixed(2)} м и проступь ` +
          `всего ${(existingTread * 1000).toFixed(0)} мм — отсюда крутизна. Предлагаемый марш ` +
          `${stair.length.toFixed(2)} м даёт проступь ${(sc.tread * 1000).toFixed(0)} мм.`,
        fix: 'Разобрать участок перекрытия над санузлом. Проверить направление и шаг балок, опирание, ригель по кромке.',
        at: { x: stair.x + stair.width / 2, y: (stair.y + stair.existingOpeningTopY) / 2 }
      });
    }
  }

  // --- 4. Варочная панель в досягаемости существующего ввода газа ---
  equipment.forEach((item) => {
    const spec = getFixture(item.catalogId);
    if (!spec || !spec.requiresGas) return;
    const fp = footprint(item);
    const cx = item.x + fp.w / 2;
    const cy = item.y + fp.d / 2;
    const nearest = gasPoints.reduce(
      (best, g) => {
        const d = Math.hypot(g.x - cx, g.y - cy);
        return d < best.d ? { d, g } : best;
      },
      { d: Infinity, g: null }
    );
    if (nearest.d > GAS_REACH) {
      out.push({
        id: `gas-${item.id}`,
        severity: 'warn',
        layer: 'plumbing',
        title: `«${spec.name}» далеко от ввода газа`,
        detail: `До ближайшей точки газа ${nearest.d.toFixed(2)} м. Ввод существует и перенос — отдельная работа со службой газа.`,
        fix: 'Держать панель в пределах ~1,5 м от существующего ввода.',
        at: { x: cx, y: cy }
      });
    }
  });

  // --- 5. Приборы не выходят за пределы своего помещения ---
  equipment.forEach((item) => {
    const spec = getFixture(item.catalogId);
    if (!spec) return;
    // Розетки и выключатели СИДЯТ В СТЕНЕ — это их нормальное положение.
    // Навесные шкафы висят над столешницей и границ пола не касаются.
    if (spec.category === 'electrical' || spec.wallMounted) return;
    const bb = boundingBox(item);
    // Углы берём ПОВЁРНУТЫЕ: у мойки под 45° углы рамки лежат вне прибора
    const roomsHit = new Set();
    corners(item).forEach((c) => {
      const r = roomOfPoint(rooms, c.x, c.y);
      roomsHit.add(r ? r.id : '__outside__');
    });
    if (roomsHit.has('__outside__') || roomsHit.size > 1) {
      out.push({
        id: `bounds-${item.id}`,
        severity: 'warn',
        layer: 'equipment',
        title: `«${spec.name}» пересекает стену или границу помещения`,
        detail: 'Прибор частично выходит за пределы одного помещения.',
        at: { x: bb.cx, y: bb.cy }
      });
    }
  });

  // --- 6. Наложение приборов друг на друга ---
  // В проверке не участвуют:
  //  • электроточки — это ЗНАЧКИ, розетка и должна «накладываться» на шкаф;
  //  • навесные шкафы — они на отметке 1400, над столешницей, и в плане
  //    пересекаются с нижними по определению.
  const solid = equipment.filter((e) => {
    const s = getFixture(e.catalogId);
    return s && s.category !== 'electrical' && !s.wallMounted;
  });
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      // Считаем по НАСТОЯЩИМ контурам, а не по габаритным рамкам:
      // у повёрнутой на 45° мойки рамка вдвое больше её самой
      const hit = shapesOverlap(solid[i], solid[j]);
      if (hit.overlap) {
        const sa = getFixture(solid[i].catalogId);
        const sb = getFixture(solid[j].catalogId);
        const a = boundingBox(solid[i]);
        const b = boundingBox(solid[j]);
        out.push({
          id: `overlap-${solid[i].id}-${solid[j].id}`,
          severity: 'warn',
          layer: 'equipment',
          title: `«${sa?.name}» и «${sb?.name}» накладываются`,
          detail: `Перекрытие около ${(hit.depth * 1000).toFixed(0)} мм.`,
          at: { x: (a.cx + b.cx) / 2, y: (a.cy + b.cy) / 2 }
        });
      }
    }
  }

  // --- 6b. Проём попал не в то помещение ---
  // Замеренные окна привязаны к наружным стенам, а перегородки двигаются мышкой.
  // Сдвинули перегородку мимо окна — окно оказалось в чужой комнате.
  openings.forEach((o) => {
    const wall = walls.find((w) => w.id === o.wallId);
    if (!wall || wall.kind !== 'outer' || !o.room) return;
    const room = rooms.find((r) => r.id === o.room);
    if (!room) return;

    // Точка в 150 мм внутрь дома от середины проёма
    const mid = pointAlongWall(wall, o.start + o.len / 2);
    const probe = { x: mid.x - wall.outward.x * 0.15, y: mid.y - wall.outward.y * 0.15 };
    if (pointInPolygon(room.polygon, probe.x, probe.y)) return;

    const actual = roomOfPoint(rooms, probe.x, probe.y);
    out.push({
      id: `opening-room-${o.id}`,
      severity: 'warn',
      layer: 'architecture',
      title: `Проём «${o.id}» оказался не в том помещении`,
      detail:
        `По привязке он должен быть в помещении «${room.name}», а попал ` +
        `${actual ? `в «${actual.name}»` : 'за пределы помещений'}. Привязка проёма замерена — ` +
        'значит, мимо него уехала перегородка.',
      fix: 'Вернуть перегородку либо перепроверить замер проёма.',
      at: probe
    });
  });

  // --- 6c. Засыпка подполья песком ---
  // Дом куплен готовым: под деревянным полом подполье, его засыпают песком.
  // Это главный источник риска для стяжки с трубой тёплого пола.
  if (levels) {
    const lv = floorLevels(levels, screed);

    out.push({
      id: 'fill-compaction',
      severity: lv.compactLayers > 1 ? 'warn' : 'info',
      layer: 'architecture',
      title: `Засыпка ${levels.sandFill} мм — ${lv.compactLayers} ${lv.compactLayers === 1 ? 'слой' : 'слоя'} уплотнения`,
      detail:
        `Песок уплотняется слоями не толще ${levels.compactLayer} мм, каждый с проливкой ` +
        'и виброплитой. Насыпать всё разом и утрамбовать сверху нельзя: низ останется рыхлым, ' +
        'и стяжка с трубой ТП просядет и треснет. Это необратимо — трубу из бетона не достать.',
      fix: 'Заложить в работы послойное уплотнение и контроль плотности перед заливкой.'
    });

    if (Math.abs(lv.floorDelta) > 5) {
      out.push({
        id: 'floor-delta',
        severity: 'info',
        layer: 'architecture',
        title: lv.floorDelta > 0
          ? `Пол поднимется на ${lv.floorDelta.toFixed(0)} мм`
          : `Пол опустится на ${Math.abs(lv.floorDelta).toFixed(0)} мм`,
        detail:
          `Высота помещения станет ${lv.clearHeight.toFixed(0)} мм, ` +
          `от пола до пола мансарды — ${lv.floorToFloor.toFixed(0)} мм. ` +
          `Чтобы пол остался на месте, песка нужно ${lv.sandForNoChange.toFixed(0)} мм.`
      });
    }

    if (lv.clearHeight < 2500) {
      out.push({
        id: 'clear-height',
        severity: 'warn',
        layer: 'architecture',
        title: `Высота помещения ${lv.clearHeight.toFixed(0)} мм`,
        detail: 'Подъём пола съедает высоту. Ниже 2500 мм комната начинает давить.',
        fix: 'Уменьшить засыпку или толщину пирога.'
      });
    }

    // Торец плиты — главный путь потерь, и добраться до него можно
    // только пока подполье открыто
    if (!levels.edgeInsulation) {
      out.push({
        id: 'edge-insulation',
        severity: 'error',
        layer: 'heating',
        title: 'Не заложено утепление торца плиты по периметру',
        detail:
          'Тёплый пол упирается краем в холодный фундамент: перепад там не 20, а 45–50 K, ' +
          'и на погонный метр периметра теряется больше, чем на квадратный метр поля. ' +
          'Снаружи цоколь закрыт отмосткой, но изнутри подполье пока открыто — ' +
          'это единственная возможность приклеить ЭППС к внутренней грани фундамента.',
        fix: 'Заложить ЭППС 50–100 мм по внутренней грани фундамента, вниз на 400–600 мм, ДО засыпки.'
      });
    } else {
      // Утеплитель должен доходить ДО ЧИСТОГО ПОЛА, а не до низа стяжки:
      // именно в стяжке лежит труба, и это самая горячая часть пирога.
      const screedTop = screed.finishThickness;
      if (levels.edgeTop > screedTop + 1) {
        const uncovered = levels.edgeTop - screedTop;
        out.push({
          id: 'edge-top',
          severity: 'error',
          layer: 'heating',
          title: `Торцевой утеплитель не доходит до чистого пола на ${levels.edgeTop.toFixed(0)} мм`,
          detail:
            `${uncovered.toFixed(0)} мм стяжки касаются фундамента напрямую. Труба ТП лежит ` +
            'именно в стяжке, поэтому здесь самая высокая температура и самый большой поток ' +
            'наружу — утеплять только нижние слои бессмысленно.',
          fix: 'Довести разрыв до уровня чистого пола: ЭППС до низа стяжки, выше — демпферная лента.'
        });
      }
      // Разрыв на уровне САМОЙ стяжки. Толстую плиту сюда не поставить —
      // 100 мм отняли бы полосу комнаты, которую не закрыть плинтусом.
      // Значит здесь работает лента, и её отсутствие — ошибка.
      if (!levels.edgeStrip) {
        out.push({
          id: 'edge-strip',
          severity: 'error',
          layer: 'heating',
          title: 'Край стяжки упирается в стену без разрыва',
          detail:
            'Торцевой ЭППС кончается низом стяжки, а сама стяжка доходит до стены. ' +
            'Без ленты она, во-первых, отдаёт тепло в стену самой горячей своей частью, ' +
            'во-вторых, при нагреве упирается в стену и трескается: 5,5 м бетона ' +
            'от 10 до 28 °C удлиняются примерно на 1 мм.',
          fix: 'Демпферная лента 8–10 мм по периметру и вдоль перегородок, ' +
            'подрезать после укладки керамогранита.'
        });
      }
      if (levels.edgeInsulationDepth < 300) {
        out.push({
          id: 'edge-depth',
          severity: 'warn',
          layer: 'heating',
          title: `Торцевой утеплитель заглублён всего на ${levels.edgeInsulationDepth.toFixed(0)} мм`,
          detail:
            'Тепло обходит короткий утеплитель по фундаменту снизу. Рабочая глубина — ' +
            '400–600 мм от чистого пола вниз по внутренней грани.',
          fix: 'Увеличить заглубление до 400–600 мм — пока подполье открыто, это дёшево.'
        });
      }
    }
  }

  // --- 7. Пирог пола против порога входной двери ---
  const entry = openings.find((o) => o.entry);
  if (entry) {
    const aboveGround = screed.finishThickness + screed.screedTotal + screed.insulation +
      screed.waterproofing + screed.gravel;
    out.push({
      id: 'stackup-total',
      severity: 'info',
      layer: 'architecture',
      title: `Полная толщина пирога: ${aboveGround} мм`,
      detail:
        `Щебень ${screed.gravel} + ЭППС ${screed.insulation} + стяжка ${screed.screedTotal} + ` +
        `покрытие ${screed.finishThickness} мм. Отметка чистого пола поднимется на эту величину ` +
        'от верха вскрытого основания — сверить с порогом входной двери и низом окон.',
      fix: 'Внести фактическую отметку порога, чтобы правило стало проверяемым.'
    });
  }

  // --- 7a. Тёплый пол: хватает ли площади с учётом мебели ---
  if (project.climate && project.envelope) {
    const hlLoops = heatLoss({
      layout,
      openings,
      climate: project.climate,
      envelope: project.envelope,
      screed,
      clearHeight
    });
    const lp = layoutLoops({
      layout,
      heatLossByRoom: hlLoops.byRoom,
      manifold: nodes.find((n) => n.type === 'manifold'),
      coolant: project.coolant,
      spacings: project.loopSpacings,
      equipment,
      exclusionZones: project.floorExclusionZones,
      mode: project.loopMode,
      kitchenOnFrame: project.kitchenOnFrame
    });

    // --- Шаг петли против ячейки сетки ---
    //
    // Частый вопрос на объекте: как класть трубу шагом 150 по сетке 100 × 100.
    // Ответ: шаг трубы и ячейка сетки не связаны — труба вяжется
    // к ПОПЕРЕЧНЫМ прутьям, а они пересекают её каждые 100 мм при любом шаге.
    const spacings = [
      ...new Set(lp.byRoom.map((r) => Math.round((r.spacing ?? 0) * 1000)).filter(Boolean))
    ].sort((a, b) => a - b);
    if (spacings.length) {
      const offGrid = spacings.filter((s) => s % 100 !== 0);
      out.push({
        id: 'pitch-vs-mesh',
        severity: 'info',
        layer: 'heating',
        title: `Шаг трубы ${spacings.join(' / ')} мм по сетке 100 × 100`,
        detail:
          'Шаг — это расстояние между СОСЕДНИМИ трубами, а рядом всегда лежат ' +
          'подача и обратка встречной укладки. Отдельной «обратки посередине» нет: ' +
          'при шаге 200 прямой ход идёт через 400, обратный заполняет промежутки, ' +
          'и труба в итоге ложится через прут. Совпадать с ячейкой не обязано — ' +
          'вяжут к поперечным прутьям, они пересекают трубу каждые 100 мм ' +
          'при любом шаге.' +
          (offGrid.length
            ? ` Шаг ${offGrid.join(', ')} мм на прутья не попадает — это нормально, ` +
              'размечается рулеткой по демпферной ленте.'
            : ''),
        fix:
          'Разметить шаг маркером по ленте до раскатки трубы, вязать хомутом ' +
          'через каждый третий прут на прямой и через каждый — на повороте.'
      });
    }

    lp.byRoom.forEach((r) => {
      if (!r.deficit) return;
      const best = Math.max(...r.candidates.map((c) => c.capacity));
      const shortfall = (r.requiredWm2 - best) * r.effectiveArea;
      out.push({
        id: `floor-deficit-${r.id}`,
        severity: 'warn',
        layer: 'heating',
        title: `«${r.name}»: пола не хватает, нужен догрев ${shortfall.toFixed(0)} Вт`,
        detail:
          `Мебель и техника занимают ${r.excludedArea.toFixed(2)} из ${r.area.toFixed(2)} м². ` +
          `Нагрузку ${r.roomLoadW.toFixed(0)} Вт должны отдать оставшиеся ${r.effectiveArea.toFixed(2)} м², ` +
          `это ${r.requiredWm2.toFixed(0)} Вт/м². При ограничении поверхности ${r.maxFloorTemp} °C ` +
          `пол даёт максимум ${best.toFixed(0)} Вт/м².`,
        fix: r.id === 'bath'
          ? 'Полотенцесушитель закрывает разницу целиком — это штатное решение для санузла.'
          : 'Радиатор под окном, либо снять исключение с мебели на ножках, либо уточнить кратность воздухообмена.'
      });
    });

    // Предметы, под которыми идёт труба, да ещё и в краевой полосе.
    // Там шаг вдвое чаще и температура поверхности выше — зазор обязателен.
    equipment.forEach((item) => {
      const spec = getFixture(item.catalogId);
      if (!spec || excludesFloor(item)) return;
      // На полу не стоят — зазор под ними смысла не имеет:
      // розетка сидит в стене, навесной шкаф висит на отметке 1400
      if (spec.category === 'electrical' || spec.wallMounted) return;
      const bb = boundingBox(item);
      if (!overlapsEdgeZone(bb)) return;

      out.push({
        id: `edge-furniture-${item.id}`,
        severity: 'info',
        layer: 'heating',
        title: `«${spec.name}» стоит над краевой зоной`,
        detail:
          `Там шаг трубы ${(EDGE_ZONE.spacing * 1000).toFixed(0)} мм вместо ` +
          `${(lp.byRoom[0]?.spacing * 1000 || 150).toFixed(0)} и температура поверхности выше. ` +
          `Сама по себе она мебели не вредит — вредит запертое тепло: без продува ` +
          `под глухим предметом температура уходит к температуре теплоносителя. ` +
          `Нужен продуваемый зазор от ${(MIN_FURNITURE_GAP * 1000).toFixed(0)} мм.`,
        fix:
          'Кухонным шкафам — цоколь с вентиляционными решётками. Мягкой мебели — ' +
          'ножки и отступ от стены 100–150 мм, иначе краевая полоса греет под диван, ' +
          'а не перехватывает холод от окна.',
        at: { x: bb.cx, y: bb.cy }
      });
    });

    // Контур, который переваливает за предел на считанные метры.
    // Предел 71 м — упрощённое правило, а гидравлика показала запас 1,47 м
    // напора. Такое решение стоит принимать глазами, а не автоматом.
    lp.byRoom.forEach((r) => {
      if (r.loops < 2) return;
      const oneFewer = r.totalPipe / (r.loops - 1);
      if (oneFewer > r.limit * 1.06) return;
      out.push({
        id: `loop-borderline-${r.id}`,
        severity: 'info',
        layer: 'heating',
        title: `«${r.name}»: ${r.loops} контура вместо ${r.loops - 1} из-за ${(r.totalPipe - r.limit * (r.loops - 1)).toFixed(0)} м`,
        detail:
          `Трубы ${r.totalPipe.toFixed(0)} м при пределе ${r.limit.toFixed(0)} м на петлю. ` +
          `Разделив на ${r.loops - 1}, получим ${oneFewer.toFixed(0)} м — превышение всего ` +
          `${(oneFewer - r.limit).toFixed(0)} м. Предел ${r.limit.toFixed(0)} м — упрощённое ` +
          'правило по потерям давления, а расчёт гидравлики показал запас напора почти вдвое.',
        fix: `Проверить по графику насоса: ${r.loops - 1} контура по ${oneFewer.toFixed(0)} м, скорее всего, проходят.`,
        at: { x: r.exclusions[0]?.x ?? 2, y: 2 }
      });
    });

    if (lp.totalLoops > 0) {
      out.push({
        id: 'loops-summary',
        severity: 'info',
        layer: 'heating',
        title: `Раскладка: ${lp.totalLoops} контуров, ${lp.totalPipe.toFixed(0)} м трубы`,
        detail:
          lp.byRoom.map((r) => `${r.name}: ${r.loops} × ${r.perLoop.toFixed(0)} м, шаг ${(r.spacing * 1000).toFixed(0)}`).join('; ') +
          `. Разбаланс ${(lp.imbalance * 100).toFixed(0)} % — балансировочные клапаны на коллекторе обязательны.`
      });
    }
  }

  // --- 7b. Переиспользование старого утеплителя под стяжкой ---
  if (screed.insulationReused > 0) {
    const fresh = screed.insulation - screed.insulationReused;

    if (!screed.reusedStrengthConfirmed) {
      out.push({
        id: 'reused-strength',
        severity: 'warn',
        layer: 'heating',
        title: `Марка старого утеплителя ${screed.insulationReused} мм не подтверждена`,
        detail:
          'Он лежал на досках под линолеумом, то есть без нагрузки. Под стяжкой с трубой ТП ' +
          'на утеплитель давит около 155 кг/м² постоянно, и нужна прочность на сжатие ' +
          'от 250 кПа. Тонкие подложечные плиты часто слабее, а обычный пенопласт даёт ' +
          'ползучесть — стяжка просядет уже после заливки.',
        fix: 'Найти маркировку на плитах. Нет маркировки или следы вмятин — не закладывать под стяжку.'
      });
    }

    if (fresh > 0 && screed.insulationReused < 30) {
      out.push({
        id: 'reused-position',
        severity: 'info',
        layer: 'heating',
        title: `Старые ${screed.insulationReused} мм — вторым слоем, со смещением швов`,
        detail:
          `Новые ${fresh} мм кладутся первыми: плита такой толщины жёсткая и перекрывает ` +
          'мелкие неровности основания. Тонкие старые плиты сверху, швы вразбежку — ' +
          `так меньше мостиков по стыкам. Но ${screed.insulationReused} мм мало для ` +
          'гарпун-скоб, трубу крепить к сетке хомутами.',
        fix: 'Перед укладкой проверить старые плиты на вмятины и остатки клея от линолеума.'
      });
    }

    if (fresh <= 0) {
      out.push({
        id: 'reused-only',
        severity: 'error',
        layer: 'heating',
        title: 'Утепление пола — только из старых плит',
        detail: `Заложено ${screed.insulation} мм, из них ${screed.insulationReused} мм — бывшие в работе. Нового утеплителя нет.`,
        fix: 'Добавить новый слой: старые 25 мм сами по себе не утепление, а подложка.'
      });
    }
  }

  // --- 7c. Тактование котла ---
  // Двухконтурник подобран по ГВС, а не по отоплению. Решать надо ДО заливки:
  // буфер, если он понадобится, требует места в прихожей 4,6 м².
  if (project.boiler && project.climate && project.envelope) {
    const hl = heatLoss({
      layout,
      openings,
      climate: project.climate,
      envelope: project.envelope,
      screed,
      clearHeight
    });
    const bc = boilerCheck({
      boiler: project.boiler,
      loadKw: hl.totalKw,
      areaM2: hl.area,
      screed,
      pipeVolumeL: 40,
      coolantRatio: project.coolant ? volumetricRatio(project.coolant) : 1
    });

    if (bc.oversized) {
      const direct = bc.schemes.find((s) => s.id === 'direct');
      const separated = bc.schemes.find((s) => s.id === 'separated');
      out.push({
        id: 'boiler-cycling',
        severity: bc.best ? 'warn' : 'error',
        layer: 'heating',
        title: `Котёл на минимуме даёт ${bc.minPowerKw} кВт при нагрузке ${hl.totalKw.toFixed(2)} кВт`,
        detail:
          `Превышение в ${bc.ratio.toFixed(1)} раза: модулироваться ниже котёл не умеет, ` +
          `поэтому будет тактовать. Через смесительный узел цикл горелки ` +
          `${separated.cycleMinutes.toFixed(1)} мин — это износ и перерасход газа. ` +
          `При прямом низкотемпературном подключении котёл связан с массой стяжки ` +
          `(${bc.screedMass.massKg.toFixed(0)} кг бетона ≈ ${bc.screedMass.waterEquivalentL.toFixed(0)} л воды), ` +
          `и цикл растягивается до ${direct.cycleMinutes.toFixed(0)} мин.`,
        fix: bc.best
          ? `Схема «${bc.best.name}» решает задачу без буферной ёмкости — место в прихожей не тратится.`
          : `Нужен объём теплоносителя не менее ${bc.requiredVolumeL.toFixed(0)} л.`
      });
    }

    // --- Обвязка котельной ---
    //
    // Схема прямая: между котлом и стяжкой нет ни смесительного узла,
    // ни гидроразделителя. Это осознанный выбор ради буфера из бетона,
    // но у него есть три следствия, которые надо закрыть железом.
    const lpBoiler = layoutLoops({
      layout,
      heatLossByRoom: hl.byRoom,
      manifold: nodes.find((n) => n.type === 'manifold'),
      coolant: project.coolant,
      spacings: project.loopSpacings,
      equipment,
      exclusionZones: project.floorExclusionZones,
      mode: project.loopMode,
      kitchenOnFrame: project.kitchenOnFrame
    });
    const hyd = systemHydraulics({
      loops: lpBoiler.byRoom.flatMap((r) =>
        Array.from({ length: r.loops }, () => ({
          powerW: r.roomLoadW / r.loops,
          lengthM: r.perLoop
        }))
      ),
      coolant: project.coolant
    });
    const brPlan = boilerRoomPlan({
      boiler: project.boiler,
      coolant: project.coolant,
      loops: lpBoiler,
      flowLh: hyd.totalFlowLh,
      screedArea: hl.area
    });

    // 1. Единственная защита стяжки — параметр в прошивке котла
    out.push({
      id: 'screed-single-protection',
      severity: 'warn',
      layer: 'heating',
      title: 'Стяжку от перегрева защищает только настройка котла',
      detail:
        `Прямое подключение выбрано ради буфера из ${bc.screedMass.massKg.toFixed(0)} кг бетона, ` +
        'и это правильно. Но смесительного узла в схеме нет, значит между котлом ' +
        `и трубой в стяжке стоит один параметр ${project.boiler.lowTempParam.code} = ` +
        `${project.boiler.lowTempParam.value}. Сброс к заводским, замена платы или ошибка ` +
        `датчика — и в стяжку уйдёт до ${project.boiler.heatingRange[1]} °C.`,
      fix:
        'Накладной аварийный термостат на подаче, уставка 55 °C, в разрыв цепи ' +
        'запроса тепла. Стоит около 2 тыс и работает без электроники котла.'
    });

    // 2. Погодозависимая кривая требует уличного датчика
    if (project.boiler.weatherCurve) {
      const wc = project.boiler.weatherCurve;
      out.push({
        id: 'outdoor-sensor',
        severity: 'warn',
        layer: 'heating',
        title: `Кривая ${wc.param} ≈ ${wc.recommended} заложена в расчёт — нужен наружный датчик`,
        detail:
          'Без наружного датчика котёл держит фиксированную температуру подачи, ' +
          'а вся логика низкотемпературного режима строится на том, что подача ' +
          'падает вслед за потеплением. Именно погодозависимость и растягивает ' +
          'цикл горелки в межсезонье, когда тактование самое злое.',
        fix: 'Датчик наружной температуры на СЕВЕРНУЮ стену, вне потока от дымохода.'
      });
    }

    // 3. Подпитка ядовитым гликолем
    if (project.coolant?.toxic) {
      out.push({
        id: 'makeup-toxic',
        severity: 'error',
        layer: 'heating',
        title: 'Подпитка от водопровода при ядовитом теплоносителе недопустима',
        detail:
          'В котле есть встроенный кран подпитки от контура ГВС — одна арматура ' +
          'между питьевой водой и этиленгликолем. Плюс любая подпитка водой ' +
          'разбавляет состав: доливать нечем, кроме готовой смеси.',
        fix:
          'Встроенный кран подпитки заглушить и опломбировать. Подпитка — ручным ' +
          'опрессовочным насосом из бака с готовой смесью, физически отсоединяемым ' +
          'от системы. Давление контролировать по манометру котла.'
      });
    }

    // 4. Расширительный бак против гликоля
    const exp = brPlan.expansion;
    out.push({
      id: 'expansion-vessel',
      severity: exp.ok ? 'info' : 'error',
      layer: 'heating',
      title: exp.ok
        ? `Встроенного бака ${exp.vesselL} л хватает: нужно ${exp.requiredL.toFixed(1)} л, запас ×${exp.margin.toFixed(1)}`
        : `Бака ${exp.vesselL} л мало: нужно ${exp.requiredL.toFixed(1)} л`,
      detail:
        `Система первого этажа ${brPlan.volume.totalL.toFixed(0)} л ` +
        `(петли ${brPlan.volume.loopsL.toFixed(0)}, котёл ${brPlan.volume.boilerL}, ` +
        `коллектор ${brPlan.volume.manifoldL}). Гликоль расширяется на ` +
        `${(exp.ratio * 100).toFixed(1)} % против 1,2 % у воды — это единственное место, ` +
        'где антифриз играет против нас. Мансардный контур в объём НЕ ВХОДИТ ' +
        'и добавится сверху.',
      fix: `Предварительное давление бака выставить ${exp.prechargeBar} бар ДО заполнения, ` +
        'иначе паспортная ёмкость не работает.'
    });

    // --- Вентиляция кухни с газовой плитой ---
    const hasGasHob = equipment.some((e) => getFixture(e.catalogId)?.requiresGas);
    if (hasGasHob) {
      const vp = ventilationPlan({
        bathArea: 3.24,
        kitchenArea: 22.4,
        height: clearHeight,
        gasHob: true
      });
      const moisture = cookingMoisture({ hours: 2 });
      const windows = windowsCheck({
        openings,
        envelope: project.envelope,
        climate: project.climate,
        rh: 50,
        roomTemp: { living: project.climate.tInLiving }
      });
      const worst = windows.reduce((a, b) => (b.criticalRh < a.criticalRh ? b : a), windows[0]);

      const kitchenVent = nodes.find((n) => n.id === 'vent-kitchen');
      const hob = equipment.find((e) => getFixture(e.catalogId)?.requiresGas);

      if (!kitchenVent) {
        out.push({
          id: 'kitchen-extract',
          severity: 'warn',
          layer: 'plumbing',
          title: 'На кухне с газовой плитой нет вытяжного канала',
          detail:
            `При сгорании газа образуется около ${WATER_PER_M3_GAS} кг водяного пара на кубометр: ` +
            `два часа готовки дают примерно ${moisture.toFixed(1)} кг влаги в воздух. ` +
            `Конденсат на окнах начинается уже при ${worst?.criticalRh.toFixed(0)} % влажности, ` +
            'а проветривание форточкой работает урывками и выстуживает комнату. ' +
            'Для газифицированных кухонь вытяжной канал обычно обязателен — сверьте с СП 402.1325800.',
          fix: `Канал Ø${(vp.kitchen.diameter * 1000).toFixed(0)} на постоянную вытяжку ${vp.kitchen.flow} м³/ч.`
        });
      } else {
        // Общеобменный канал и зонт над плитой решают РАЗНЫЕ задачи
        const bb = hob ? boundingBox(hob) : null;
        const dist = bb
          ? Math.hypot(kitchenVent.x - bb.cx, kitchenVent.y - bb.cy)
          : 0;

        out.push({
          id: 'kitchen-vent-vs-hood',
          severity: 'info',
          layer: 'plumbing',
          title: `Канал кухни в ${dist.toFixed(1)} м от плиты — это нормально`,
          detail:
            'Общеобменный канал убирает воздух из объёма помещения, поэтому его место ' +
            'в плане свободно: угол за холодильником подходит. Критична высота — ' +
            `под потолком (заложено ${kitchenVent.mountHeight} м), продукты сгорания и влажный ` +
            'воздух поднимаются вверх. Но зонт над плитой он НЕ заменяет: зонт ловит ' +
            'плюм у источника, в углу он бесполезен.',
          fix:
            `Канал Ø${kitchenVent.duct} на ${kitchenVent.flow} м³/ч в углу — плюс отдельно решить ` +
            'по зонту: воздуховод в свой канал либо рециркуляция с угольным фильтром. ' +
            'Рециркуляция не убирает влагу и продукты сгорания, поэтому общеобменный канал нужен в любом случае.'
        });

        out.push({
          id: 'kitchen-vent-makeup',
          severity: 'warn',
          layer: 'plumbing',
          title: 'Вытяжке кухни нужен приток и защита от промерзания',
          detail:
            `${kitchenVent.flow} м³/ч не уйдут, если воздуху неоткуда взяться: в плотном доме ` +
            'канал просто не потянет. Плюс вывод идёт через наружную стену — при −27 °C ' +
            'влажный воздух конденсируется в канале и обмерзает.',
          fix:
            'Приточные клапаны в окнах или стене. Канал утеплить, поставить обратный клапан ' +
            'и дать уклон наружу. Кухонный канал НЕ объединять с каналом санузла.'
        });
      }
    }

    // --- Закладные под стойки столешницы ---
    const embeds = nodes.filter((n) => n.type === 'embed');
    if (embeds.length) {
      out.push({
        id: 'embeds-before-pour',
        severity: 'warn',
        layer: 'architecture',
        title: `${embeds.length} закладных под столешницу — ставить ДО заливки`,
        detail:
          'В стяжку с трубой тёплого пола потом не просверлить: анкер попадёт ' +
          'в трубу, а найти её без тепловизора нельзя. Пластина 100 × 100 × 5 ' +
          'кладётся заподлицо с чистовой стяжкой, анкеры вяжутся к армирующей ' +
          'сетке — они короткие и до трубы не достают. ' +
          'Стойка встаёт на стык двух секций, где и так идёт боковина шкафа, ' +
          'и прячется за фасадом. Закладные заложены С ИЗБЫТКОМ, через 600: ' +
          'лишняя под цоколем не видна, а недостающую потом не добавить.',
        fix:
          'Разметить по плану после укладки трубы, зафиксировать к сетке ' +
          'и СФОТОГРАФИРОВАТЬ С РУЛЕТКОЙ до бетона — иначе не найти.',
        at: { x: embeds[0].x, y: embeds[0].y }
      });
    }

    // --- Электроточки не должны попадать в проёмы ---
    // Коробка в проёме физически некуда встать: там четверть или косяк.
    // Плюс наличник съедает ещё 70–100 мм с каждой стороны.
    const TRIM = 0.1;
    equipment.forEach((item) => {
      const spec = getFixture(item.catalogId);
      if (spec?.category !== 'electrical') return;
      const bb = boundingBox(item);

      const h = item.mountHeight ?? spec.mountHeight ?? 0.3;

      openings.forEach((op) => {
        const wall = walls.find((w) => w.id === op.wallId);
        if (!wall) return;
        // Розетка НИЖЕ подоконника конфликтом не является: под окном стена есть.
        if (h + 0.08 < (op.sill ?? 0)) return;
        // И ВЫШЕ перемычки — тоже: над дверью 650 мм стены до потолка,
        // потолочный светильник там стоит на сплошном участке, а не в проёме.
        if (h - 0.08 > (op.sill ?? 0) + op.h) return;
        const r = openingRect(wall, op);
        // Расширяем проём на наличник и смотрим пересечение
        const ox = Math.min(bb.x + bb.w, r.x + r.w + TRIM) - Math.max(bb.x, r.x - TRIM);
        const oy = Math.min(bb.y + bb.d, r.y + r.h + TRIM) - Math.max(bb.y, r.y - TRIM);
        if (ox > 0 && oy > 0) {
          out.push({
            id: `el-in-opening-${item.id}-${op.id}`,
            severity: 'error',
            layer: 'electrical',
            title: `«${spec.name}» попадает в проём`,
            detail:
              `Точка стоит в проёме «${op.id}» или ближе ${(TRIM * 1000).toFixed(0)} мм к его краю. ` +
              'В проёме коробку ставить некуда — там четверть и косяк, а наличник ' +
              'съедает ещё 70–100 мм. Выключатель должен отстоять от края проёма ' +
              'минимум на ширину наличника плюс запас.',
            fix: 'Отодвинуть вдоль стены не менее чем на 150 мм от края проёма.',
            at: { x: bb.cx, y: bb.cy }
          });
        }
      });
    });

    // --- Дверь санузла против кладовой под лестницей ---
    const bathDoor = openings.find((o) => o.id === 'door-bath');
    const stairCfg = project.stair;
    if (bathDoor && stairCfg) {
      const bathX = INNER_W - 1.8;
      const leafX = bathDoor.hinge === 'b'
        ? bathX + bathDoor.start + bathDoor.len // петли справа — полотно уходит к лестнице
        : bathX + bathDoor.start;
      const boxingX = stairCfg.x;
      const gap = boxingX - leafX;

      if (bathDoor.hinge === 'b' && gap < 0.5) {
        out.push({
          id: 'bath-door-vs-understair',
          severity: 'warn',
          layer: 'architecture',
          title: `Открытая дверь санузла встаёт перед кладовой: зазор ${(gap * 1000).toFixed(0)} мм`,
          detail:
            `Петли справа, полотно уходит к лестнице и в открытом положении стоит ` +
            `на отметке x=${leafX.toFixed(2)}, а зашивка марша начинается на ` +
            `x=${boxingX.toFixed(2)}. Полотно перекрывает первые ${(bathDoor.len * 1000).toFixed(0)} мм ` +
            'фронта кладовой — и это самая высокая её часть, где стоит стиральная машина.',
          fix:
            'Перевесить петли на левый откос: полотно пойдёт в сторону кухни, ' +
            'где на этой высоте ничего нет, и фронт кладовой освободится целиком. ' +
            'Либо раздвижная дверь санузла — она заодно вернёт площадь в помещении 3,24 м².',
          at: { x: leafX, y: 1.8 + bathDoor.len / 2 }
        });
      }
    }

    // --- Проводка по деревянному перекрытию ---
    const ceil = project.ceiling;
    const lightPoints = equipment.filter(
      (e) => getFixture(e.catalogId)?.circuit === 'light'
    ).length;

    if (ceil && lightPoints > 0) {
      out.push({
        id: 'ceiling-wiring',
        severity: 'warn',
        layer: 'electrical',
        title: `Свет идёт по деревянному перекрытию — ${lightPoints} точек`,
        detail:
          'Перекрытие балочное, межбалочное пространство пустое, снизу ПВХ. ' +
          'Ключевое: СКРЫТАЯ проводка в сгораемых конструкциях требует ' +
          'металлической трубы или металлорукава — пластиковая гофра для этого ' +
          'не годится. ОТКРЫТАЯ проводка такого требования не имеет и вдобавок ' +
          'остаётся доступной для осмотра. Сверьтесь с действующей редакцией ПУЭ.',
        fix:
          ceil.cavityFilled
            ? 'Скрытая трасса — в металлорукаве.'
            : 'Если зашиваете листом — кабель в металлорукаве. Если оставляете ' +
              'балки открытыми — вести открыто по боковой грани балки в верхнем ' +
              'углу: снизу почти не видно, и требования проще.'
      });

      if (!ceil.cavityFilled) {
        out.push({
          id: 'ceiling-access-window',
          severity: 'info',
          layer: 'electrical',
          title: 'Пока ПВХ снят — доступ ко всему перекрытию открыт',
          detail:
            'Ни чернового пола, ни засыпки: сняв панели, вы получаете пустое ' +
            'межбалочное пространство по всей площади. Поднимать доски мансарды ' +
            'не нужно. Мансарда отапливается, поэтому утеплитель между этажами ' +
            'нужен НЕ для тепла, а только против шума шагов сверху.',
          fix:
            'Решить одновременно: трассы света, минвата для звука и щели между ' +
            'досками. Второй раз этот доступ откроется только с новым демонтажом.'
        });
      }
    }

    // --- Пучок кабеля в слое утеплителя ---
    //
    // Трассы идут параллельно вдоль стены с шагом ROUTE.pitch. Пока просвет
    // между соседними кабелями не меньше двух диаметров, каждый охлаждается
    // сам по себе. Если сдвинуть их плотнее, по ПУЭ включается снижающий
    // коэффициент, и 2,5 мм² перестаёт держать 16 А — то есть автомат
    // защищает уже не кабель, а ничего.
    const floorLanes = equipment.filter((e) => {
      const s = getFixture(e.catalogId);
      if (s?.category !== 'electrical') return false;
      return IN_FLOOR.has(e.circuit ?? s.circuit ?? 'sockets');
    }).length;

    if (floorLanes > 0) {
      const clearance = ROUTE.pitch * 1000 - CABLE_OD_MM;
      const lineCount = new Set(
        equipment
          .map((e) => {
            const s = getFixture(e.catalogId);
            if (s?.category !== 'electrical') return null;
            const c = e.circuit ?? s.circuit ?? 'sockets';
            return IN_FLOOR.has(c) ? c : null;
          })
          .filter(Boolean)
      ).size;

      if (clearance < 2 * CABLE_OD_MM) {
        out.push({
          id: 'cable-bundle',
          severity: 'warn',
          layer: 'electrical',
          title: `Кабели в стяжке идут через ${(ROUTE.pitch * 1000).toFixed(0)} мм — просвет ${clearance.toFixed(0)} мм`,
          detail:
            `Для ВВГнг-LS 3×2,5 (габарит ${CABLE_OD_MM} мм) свободного охлаждения ` +
            `требуется просвет не меньше ${2 * CABLE_OD_MM} мм. Плотнее — кабели ` +
            'греют друг друга, и допустимый ток падает примерно на треть.',
          fix: `Развести трассы шагом от ${(2 * CABLE_OD_MM + CABLE_OD_MM).toFixed(0)} мм ` +
            'либо пустить часть групп вдоль другой стены.'
        });
      } else {
        out.push({
          id: 'cable-bundle-ok',
          severity: 'info',
          layer: 'electrical',
          title: `${lineCount} силовых групп в полу, просвет между кабелями ${clearance.toFixed(0)} мм`,
          detail:
            `Шаг ${(ROUTE.pitch * 1000).toFixed(0)} мм даёт просвет больше двух диаметров, ` +
            'поэтому снижающий коэффициент по ПУЭ не применяется и 2,5 мм² честно ' +
            'держит свои 16 А. Число линий на плотность пучка при таком шаге не влияет — ' +
            'объединять группы имеет смысл ради простоты щита, а не ради нагрева.',
          fix: 'Сохранять шаг при разметке: кабели не собирать в жгут и не стягивать хомутами.'
        });
      }
    }

    // --- Просвет под столешницей ---
    //
    // Плита бетонная и толстая, поэтому низ у неё выше, чем у ЛДСП 38 мм.
    // Прибор, который вставал под обычную столешницу, под эту может не влезть.
    const wt = buildWorktop(layout, equipment);
    if (wt) {
      const tight = wt.beneath.filter((b) => !b.fits);
      if (tight.length) {
        const worst = tight.reduce((a, b) => (b.margin < a.margin ? b : a));
        out.push({
          id: 'worktop-clearance',
          severity: 'warn',
          layer: 'equipment',
          title: `Под столешницей ${((wt.top - wt.thickness) * 1000).toFixed(0)} мм — «${worst.name}» не проходит на ${(-worst.margin * 1000).toFixed(0)} мм`,
          detail:
            `Верх плиты ${(wt.top * 1000).toFixed(0)}, бетон ${(wt.thickness * 1000).toFixed(0)} мм, ` +
            `значит низ на ${((wt.top - wt.thickness) * 1000).toFixed(0)}. ` +
            `Прибор в модели ${(worst.height * 1000).toFixed(0)} мм. ` +
            'Встроенная техника обычно регулируется ножками в диапазоне 815–870, ' +
            'поэтому это скорее всего решается на месте — но проверять надо ' +
            'по паспорту конкретной модели, а не по модели в планировщике.',
          fix:
            `Поднять верх плиты до ${((worst.height + wt.thickness) * 1000).toFixed(0)} мм ` +
            'либо утоньшить бетон до 40 мм. Каркас на закладных позволяет и то и другое — ' +
            'но решать надо ДО заливки столешницы.',
          at: { x: wt.polygon[0].x + 0.3, y: wt.depth / 2 }
        });
      }

      out.push({
        id: 'worktop-front',
        severity: 'info',
        layer: 'equipment',
        title: `Столешница ${wt.runM.toFixed(2)} м фронта, ${wt.area.toFixed(2)} м² бетона`,
        detail:
          `Идёт от «${wt.tall[0]?.name ?? 'начала фронта'}» вдоль верхней стены ` +
          `и вниз по перегородке санузла. Врезаются в неё ${wt.cutouts.length} прибора: ` +
          `${wt.cutouts.map((c) => c.name.toLowerCase()).join(', ')}. ` +
          `Остальное стоит под ней. При толщине ${(wt.thickness * 1000).toFixed(0)} мм ` +
          `плита весит около ${(wt.area * wt.thickness * 2400).toFixed(0)} кг — ` +
          'это нагрузка на стойки и закладные, а не только на шкафы.',
        fix: 'Опоры ставятся по поперечным граням секций и зашиваются ЛДСП заподлицо с фасадом.'
      });
    }

    // --- Рабочий просвет перед кухонным фронтом ---
    //
    // Наложения тут нет: предметы не пересекаются, и проверка габаритов
    // молчит. Но стоять негде — а это ровно та ошибка, которую на плане
    // не видно и которую после заливки исправлять уже мебелью, а не стеной.
    if (wt) {
      const solidBoxes = equipment
        .map((e) => {
          const sp = getFixture(e.catalogId);
          if (!sp || sp.category === 'electrical' || sp.wallMounted) return null;
          return { id: e.id, name: sp.name, h: sp.h ?? 0.9, ...boundingBox(e) };
        })
        .filter((b) => b && b.h > 0.25);

      // Перед каждым прибором фронта смотрим, что стоит напротив.
      // Сама кухня препятствием не считается: боковая ветка буквы Г стоит
      // «напротив» верхней по координатам, но в углу человек стоит между
      // ними — это и есть угловая кухня, а не затор.
      const ownIds = new Set([
        ...wt.beneath, ...wt.cutouts, ...wt.carcasses, ...wt.tall
      ].map((x) => x.id));
      const fronts = [...wt.beneath, ...wt.cutouts]
        .map((x) => solidBoxes.find((b) => b.id === x.id))
        .filter(Boolean);

      let tight = null;
      fronts.forEach((b) => {
        const ahead = solidBoxes.filter(
          (o) => !ownIds.has(o.id) && o.x < b.x + b.w && o.x + o.w > b.x && o.y >= wt.depth - 0.01
        );
        if (!ahead.length) return;
        const near = ahead.reduce((a2, c) => (c.y < a2.y ? c : a2));
        const gap = near.y - wt.depth;
        if (!tight || gap < tight.gap) tight = { b, near, gap };
      });

      if (tight && tight.gap < WORK_AISLE.min) {
        out.push({
          id: 'kitchen-aisle',
          severity: 'error',
          layer: 'equipment',
          title: `Перед кухонным фронтом ${(tight.gap * 1000).toFixed(0)} мм — стоять негде`,
          detail:
            `Напротив «${tight.b.name}» стоит «${tight.near.name}», и между кромкой ` +
            `столешницы и ним остаётся ${(tight.gap * 1000).toFixed(0)} мм. ` +
            `Человеку у рабочей поверхности нужно ${WORK_AISLE.comfort * 1000} мм, ` +
            `в притирку — ${WORK_AISLE.min * 1000}. Наложения предметов при этом НЕТ, ` +
            'поэтому обычная проверка габаритов молчит.',
          fix:
            `Отодвинуть обеденную группу на ${((WORK_AISLE.comfort - tight.gap) * 1000).toFixed(0)} мм ` +
            'от кухни. Это расстановка, а не конструктив: правится мышкой и ни на что ' +
            'в стяжке не влияет.',
          at: { x: tight.b.cx, y: wt.depth + tight.gap / 2 }
        });
      } else if (tight) {
        out.push({
          id: 'kitchen-aisle-ok',
          severity: tight.gap < WORK_AISLE.comfort ? 'warn' : 'info',
          layer: 'equipment',
          title: `Рабочий проход у кухни ${(tight.gap * 1000).toFixed(0)} мм`,
          detail: `Самое узкое место — против «${tight.b.name}». ` +
            `Комфорт ${WORK_AISLE.comfort * 1000}, минимум ${WORK_AISLE.min * 1000}.`,
          fix: 'Держать этот габарит при расстановке мебели.'
        });
      }

      // Распахнутая дверца встроенной техники
      const SWING = { 'eq-oven': 0.55, 'eq-dishwasher': 0.6, 'eq-fridge': 0.65, 'eq-washer': 0.55 };
      Object.entries(SWING).forEach(([id, depth]) => {
        const b = solidBoxes.find((o) => o.id === id);
        if (!b) return;
        const front = b.y + b.d;
        const hit = solidBoxes.filter(
          (o) => o.id !== id && !ownIds.has(o.id) && o.x < b.x + b.w && o.x + o.w > b.x &&
            o.y < front + depth && o.y + o.d > front
        );
        if (!hit.length) return;
        out.push({
          id: `door-swing-${id}`,
          severity: 'warn',
          layer: 'equipment',
          title: `Дверца «${b.name}» упирается в «${hit[0].name}»`,
          detail:
            `Откинутая дверца выходит на ${(depth * 1000).toFixed(0)} мм вперёд, ` +
            `до отметки ${((front + depth) * 1000).toFixed(0)}, а «${hit[0].name}» ` +
            `начинается на ${(hit[0].y * 1000).toFixed(0)}. Прибор не откроется полностью, ` +
            'а у духовки это ещё и значит, что противень не вынуть.',
          fix: 'Отодвинуть мешающий предмет или перенести технику по фронту.',
          at: { x: b.cx, y: front + depth / 2 }
        });
      });
    }

    // --- Толщина плиты столешницы ---
    if (wt) {
      const opts = slabThicknessOptions({ worktop: wt });
      const cur = opts.find((o) => o.t === Math.round(wt.thickness * 1000)) ?? opts[1];
      const thin = opts.find((o) => !o.barOk);
      out.push({
        id: 'slab-thickness',
        severity: 'info',
        layer: 'equipment',
        title: `Плита ${cur.t} мм: ${cur.massKg.toFixed(0)} кг, просвет под ней ${cur.underMm} мм`,
        detail:
          `Поле плиты пролётом 500 между продольными уголками даёт ` +
          `${cur.fieldMPa.toFixed(2)} МПа при пределе ${cur.allowMPa.toFixed(2)} — ` +
          'толщину решает не оно. Решают перемычки у вырезов: полоса 75 мм ' +
          `без опоры дала бы ${cur.stripFreeMPa.toFixed(1)} МПа и сломалась бы, ` +
          'но продольный уголок идёт в 50 мм от кромки — прямо под ней, ' +
          `и остаётся ${cur.stripFramedMPa.toFixed(2)} МПа. ` +
          `На арматуру после защитного слоя остаётся ${cur.barMm} мм: Ø4 влезает, ` +
          `Ø6 нет. При ${thin ? thin.t : 30} мм не остаётся ничего.`,
        fix:
          'Уголки каркаса обязаны идти ПОД перемычками вырезов — если вырез ' +
          'делается больше расчётного, проверить заново. Заполнитель мелкий ' +
          '(до 5–8 мм), фибра против усадки, укрытие плёнкой на 7 суток. ' +
          'Во внутренний угол буквы Г — диагональный стержень: там концентратор.'
      });
    }

    // --- Мойка под окном ---
    //
    // Место у мойки — самое частое стоячее место в кухне, и окно там уместно.
    // Но столешница на 900, а подоконник замерен на 960: между ними 60 мм,
    // и это решает судьбу смесителя, а не украшательство.
    const sinkBox = equipment
      .map((e) => {
        const sp = getFixture(e.catalogId);
        if (!sp || !sp.builtInTop || !/мойк/i.test(sp.name)) return null;
        return { id: e.id, name: sp.name, ...boundingBox(e) };
      })
      .find(Boolean);

    if (sinkBox && wt) {
      const overWin = openings.find(
        (o) => o.kind === 'window' && o.wallId === 'w-n' && !o.blind &&
          o.start < sinkBox.x + sinkBox.w && o.start + o.len > sinkBox.x
      );
      if (overWin) {
        const gap = (overWin.sill - wt.top) * 1000;
        const centreOffset = (sinkBox.cx - (overWin.start + overWin.len / 2)) * 1000;
        // Какая створка над краном. Глухая — кран стоит спокойно перед стеклом,
        // открывающаяся — она его снесёт при первом же проветривании.
        const mid = overWin.start + overWin.len / 2;
        const opensRight = overWin.openingSash === 'right';
        const tapUnderBlind = overWin.sashes === 2
          ? (opensRight ? sinkBox.cx < mid : sinkBox.cx > mid)
          : null;
        out.push({
          id: 'sink-under-window',
          severity: tapUnderBlind === false ? 'warn' : 'info',
          layer: 'equipment',
          title: tapUnderBlind === false
            ? 'Кран мойки под ОТКРЫВАЮЩЕЙСЯ створкой — она его снесёт'
            : `Мойка под окном, кран под глухой створкой (до подоконника ${gap.toFixed(0)} мм)`,
          detail:
            `Мойка смещена от центра окна на ${Math.abs(centreOffset).toFixed(0)} мм. ` +
            `Подоконник ${(overWin.sill * 1000).toFixed(0)}, верх столешницы ` +
            `${(wt.top * 1000).toFixed(0)} — между ними ${gap.toFixed(0)} мм, ` +
            'фартука за мойкой фактически нет. ' +
            (tapUnderBlind === true
              ? 'Кран приходится на ГЛУХУЮ половину: сносить его нечем, ' +
                'обычный смеситель встаёт нормально и просто стоит перед стеклом. ' +
                'Складной не нужен.'
              : tapUnderBlind === false
                ? 'Створка поворотно-откидная и при полном открывании идёт внутрь ' +
                  'на всю свою ширину — сметёт и кран, и всё, что стоит на столешнице.'
                : 'Как открывается створка — не уточнено.'),
          fix: tapUnderBlind === false
            ? 'Сдвинуть мойку под глухую половину окна либо взять складной смеситель.'
            : 'Подоконник из влагостойкого материала, стык с фартуком на герметик. ' +
              'Под открывающейся створкой на столешнице ничего постоянного не держать: ' +
              'при полном открывании она пройдёт над ней.',
          at: { x: sinkBox.cx, y: 0.3 }
        });
      }
    }

    // --- Задняя опора столешницы ---
    //
    // Спереди стойки идут через 600 — там они совпадают со стыками секций.
    // Сзади нагрузка та же, но условия другие, и вопрос «а нужны ли там
    // стойки вообще» решается прогибом, а не привычкой.
    if (wt) {
      const bs = backSupportOptions(wt, screed);
      const sparse = bs.options.find((o) => o.id === 'sparse');
      const ledger = bs.options.find((o) => o.id === 'ledger');
      out.push({
        id: 'worktop-back-support',
        severity: 'info',
        layer: 'equipment',
        title: `Задняя опора: ${sparse.posts} стоек шагом ${sparse.pitch} против ${bs.frontPosts} спереди`,
        detail:
          `Считать надо не уголок, а СВЯЗКУ уголка с плитой. Сам по себе ` +
          `40 × 40 на пролёте ${sparse.pitch} прогнулся бы на ${sparse.deflAngleMm.toFixed(1)} мм, ` +
          `но вместе с бетоном 60 мм — на ${sparse.deflCombinedMm.toFixed(2)} мм: плита несёт себя сама, ` +
          `уголок ей направляющая. Напряжение ${sparse.sigmaMPa.toFixed(0)} МПа при пределе 160. ` +
          `Альтернатива — пристенный уголок вместо задних стоек: держит, запас ` +
          `×${ledger.ledger.safety.toFixed(1)} на дюбель шагом ${ledger.ledger.pitchMm}, ` +
          'но только по газобетону — вдоль перегородки санузла гипсокартон, ' +
          'и там стойки остаются в любом случае.',
        fix:
          'Закладные всё равно ставятся ДО ЗАЛИВКИ и стоят 275 ₽ — заложить 16 ' +
          'по обеим линиям, а чем именно держать заднюю кромку, решить потом.'
      });
    }

    // --- Подрозетники, утопленные в наружную стену ---
    //
    // Коронка 68 на глубину 45 снимает часть блока и всю штукатурку.
    // Стена в этом месте локально тоньше, поверхность холоднее — вопрос,
    // не окажется ли она ниже точки росы.
    if (project.envelope?.wall) {
      const NEAR = 0.16; // считаем «у наружной стены», м
      const onOuter = equipment.filter((e) => {
        const s = getFixture(e.catalogId);
        if (s?.category !== 'electrical' || s.circuit === 'light') return false;
        const bb = boundingBox(e);
        return (
          bb.cx <= NEAR || bb.cx >= INNER_W - NEAR || bb.cy <= NEAR || bb.cy >= INNER_D - NEAR
        );
      });

      if (onOuter.length) {
        const bx = backBoxCheck({
          envelope: project.envelope,
          tIn: project.climate.tInLiving,
          tOut: project.climate.tOutDesign,
          recessMm: BACK_BOX.depth
        });
        const wallMm = project.envelope.wall.thickness;

        out.push({
          id: 'back-box-outer-wall',
          severity: bx.condenses ? 'error' : 'info',
          layer: 'electrical',
          title: bx.condenses
            ? `За розетками в наружной стене выпадет конденсат: ${bx.tAtBox.toFixed(1)} °C при точке росы ${bx.dewPoint.toFixed(1)}`
            : `${onOuter.length} подрозетников в наружной стене — запас по конденсату ${bx.margin.toFixed(1)} K`,
          detail:
            `Коронка ${BACK_BOX.crown} мм на глубину ${BACK_BOX.depth} оставляет ` +
            `${bx.remainingMm.toFixed(0)} мм блока из ${wallMm}. Поверхность за коробкой ` +
            `${bx.tAtBox.toFixed(1)} °C против ${bx.tSolid.toFixed(1)} по целому сечению — ` +
            `утапливание стоит ${bx.penalty.toFixed(1)} K. Конденсат начнётся ` +
            `с ${bx.criticalRh.toFixed(0)} % влажности, то есть не начнётся. ` +
            'Настоящий риск здесь не тепловой, а воздушный: коробка — дыра ' +
            'в штукатурке, а именно штукатурка работает воздушным барьером.' +
            (bx.assumed
              ? ` Толщина блока ${wallMm} мм и наружный ЭППС НЕ ЗАМЕРЕНЫ — цифры ориентировочные.`
              : ''),
          fix:
            'Коронка БЕЗ удара — в ударном режиме газобетон вокруг отверстия ' +
            'крошится, и коробка не держится. Подрозетник для сплошных стен, ' +
            'сажать на гипсовую штукатурку, ею же заполнить пазуху вокруг: ' +
            'это и крепление, и восстановление воздушного барьера. ' +
            'Штробы вести вертикально от пола к коробке, глубина 20–25 мм.'
        });
      }
    }

    // --- Аварийная линия: щиток после ИБП ---
    {
      const inverterW = project.ups?.inverterW ?? 400;
      const ep = emergencyPanel({ inverterW });
      const onUps = project.equipment.filter((e) => e.circuit === 'boiler');
      const upsSockets = onUps.filter((e) => e.catalogId === 'socket_ups');
      const plainSockets = onUps.filter((e) =>
        ['socket2', 'socket4', 'socket_app', 'socket_ip44'].includes(e.catalogId) &&
        e.id !== 'el-boiler');

      out.push({
        id: 'ups-panel',
        severity: ep.socket.fits ? 'info' : 'error',
        layer: 'electrical',
        title: ep.socket.fits
          ? `Аварийный щиток: 4 ветки, розетка через автомат B${ep.socket.rating} А — пик ${ep.socket.peakW} Вт из ${inverterW}`
          : `Аварийная линия не влезает в инвертор: ${ep.socket.peakW} Вт из ${inverterW}`,
        detail:
          `Постоянные потребители ${ep.baseW} Вт, свободно ${ep.socket.spareW} Вт = ` +
          `${ep.socket.spareA.toFixed(2)} А. Линия котла перестала быть «только котёл», ` +
          'и исходное возражение — чужая авария не должна гасить отопление — ' +
          'снимается щитком, а не обещанием: у каждой ветки свой аппарат. ' +
          'КЗ в свете или розетке выбивает ЕЁ автомат, до котла не доходит. ' +
          'Светильник класса II заземляемых частей не имеет, поэтому утечку ' +
          'на землю создать не может в принципе. Розетка идёт через свой ' +
          `дифавтомат ${ep.panel.socketRcdMa} мА — он чувствительнее общих 30 и ближе к нагрузке. ` +
          `Модулей занято ${ep.modulesUsed} из ${ep.panel.modules}.`,
        fix:
          `Автомат розетки — характеристика B, номинал ${ep.socket.rating} А. ` +
          'Не C: чайник 2 кВт это 9 номиналов, на B это гарантированный ' +
          'мгновенный расцеп, а на C — нижний край магнитной зоны, ' +
          'то есть возможны секунды перегруза, за которые ИБП уйдёт в защиту ' +
          'и утащит за собой котёл.'
      });

      if (upsSockets.length > 1 || plainSockets.length) {
        out.push({
          id: 'ups-socket-count',
          severity: 'error',
          layer: 'electrical',
          title: `На аварийной линии ${upsSockets.length + plainSockets.length} розеток вместо одной`,
          detail:
            'Розетка — единственный элемент линии, содержимое которого заранее ' +
            'неизвестно. Каждая следующая умножает шанс, что в отключение ' +
            'в неё воткнут то, что уронит инвертор вместе с котлом.',
          fix: 'Оставить одну аварийную розетку, помеченную цветом и надписью.'
        });
      }

      // Светильники на ИБП обязаны быть класса II
      const upsLights = onUps.filter((e) => getFixture(e.catalogId)?.power > 0 &&
        getFixture(e.catalogId)?.category === 'electrical' &&
        e.catalogId.startsWith('light'));
      const notClassII = upsLights.filter((e) => e.catalogId !== 'light_ups');
      if (notClassII.length) {
        out.push({
          id: 'ups-light-class',
          severity: 'error',
          layer: 'electrical',
          title: 'Светильник на ИБП не класса II',
          detail:
            'Обычный светильник с заземляемым корпусом может дать утечку ' +
            'на землю, а УЗО у него общее с котлом. Класс II этот путь убирает: ' +
            'заземляемых частей просто нет.',
          fix: 'Заменить на светильник класса II (знак «квадрат в квадрате»).'
        });
      }
    }

    // --- Слаботочка: окно доступа закрывается вместе с перекрытием ---
    {
      const lvPlan = lowVoltagePlan();
      const routerItem = project.equipment.find((e) => e.catalogId === 'ont_router');
      out.push({
        id: 'low-voltage-route',
        severity: 'warn',
        layer: 'electrical',
        title:
          `Слаботочка — ${lvPlan.utpM.toFixed(0)} м витой пары на ${lvPlan.utpLinks} линии ` +
          `и ${lvPlan.conduitM.toFixed(0)} м гофры, ПО ПЕРЕКРЫТИЮ, а не в стяжке`,
        detail:
          'Силовой кабель кладём в пол потому, что он переживёт дом. Со слаботочкой ' +
          'наоборот: за срок жизни стяжки сменится два поколения стандартов, ' +
          'и замуровать витую пару в бетон значит закопать её насовсем. ' +
          'Перекрытие вскрыто прямо сейчас — это доступ ко всему этажу разом, ' +
          'и второй раз он откроется только с новым демонтажом. ' +
          lvPlan.routes
            .map((r) => `${r.name} — ${r.cableM.toFixed(1)} м`)
            .join('; ') + '.',
        fix:
          'Гофра Ø20 с протяжкой на КАЖДУЮ трассу — в отличие от света, ' +
          'который идёт открыто: свет менять не будут, а слаботочку будут. ' +
          'Кабель ТОЛЬКО медный: омеднённый алюминий не тянет PoE ' +
          'и ломается на изгибе в клемме. Обе пары к телевизору — в одну гофру.'
      });

      // Питание роутера идёт рядом с газовой трубой — это уже нормируется
      if (routerItem) {
        const rb = boundingBox(routerItem);
        const gas = nodes.find((n) => n.id === 'gas-boiler');
        if (gas) {
          const gapMm = Math.hypot(rb.cx - gas.x, rb.cy - gas.y) * 1000;
          const ok = gapMm >= LV.gasClearanceMm;
          out.push({
            id: 'router-vs-gas',
            severity: ok ? 'info' : 'error',
            layer: 'electrical',
            title: ok
              ? `Роутер в ${gapMm.toFixed(0)} мм от ввода газа — норматив ${LV.gasClearanceMm} выдержан`
              : `Роутер в ${gapMm.toFixed(0)} мм от ввода газа: ближе ${LV.gasClearanceMm} нельзя`,
            detail:
              'Оптика заходит в дом В ОДНОМ ПРОСТЕНКЕ с газовой трубой, ' +
              'в промежутке 700 мм между глухим окном и котлом. Сама оптика ' +
              'не проводник и под норму сближения не подпадает, а вот розетка ' +
              'питания роутера — подпадает: параллельно газопроводу электрику ' +
              `ведут не ближе ${LV.gasClearanceMm} мм.`,
            fix: ok
              ? 'Роутер прижат к верхнему краю простенка, у окна. Не сдвигать его вниз, к котлу.'
              : 'Сдвинуть роутер к окну, вверх простенка, или вынести розетку в зал.'
          });
        }
      }
    }

    // --- Подпол: неравномерный и неуплотнённый песок ---
    const lv = project.levels;
    if (lv?.crawlUneven || lv?.crawlCompacted === false) {
      const pie = screedStackup(project.screed).total;
      const available = lv.crawlDepth;
      out.push({
        id: 'crawl-profile',
        severity: 'warn',
        layer: 'architecture',
        title: `Подпол ${lv.crawlMeasuredToBoards ?? lv.crawlDepth} мм — это СРЕДНЕЕ, а пирог ${pie} мм должен влезть в самом мелком месте`,
        detail:
          `От песка до верха досок ≈${available} мм, пирог ${pie} мм — в среднем сходится ` +
          `с запасом ${available - pie} мм. Но песок неровный, и там, где он выше среднего, ` +
          'запаса не будет. Уровень пола задаётся САМОЙ ВЫСОКОЙ точкой грунта, ' +
          'а не средней: иначе в одном углу пирог не поместится, и придётся ' +
          'либо резать утеплитель, либо поднимать весь пол.',
        fix:
          'Снять профиль подпола по сетке 1 × 1 м от общей отметки — 36 точек на этаж. ' +
          'Высокие места срезать в низкие, а не досыпать поверх всего.'
      });

      out.push({
        id: 'crawl-compaction',
        severity: 'error',
        layer: 'architecture',
        title: 'Песок в подполе не уплотнён — стяжка ляжет на рыхлое основание',
        detail:
          'Досыпки почти нет, значит стяжка встанет прямо на существующий песок. ' +
          'Рыхлый песок под нагрузкой садится на 5–10 % своей толщины. Просадка ' +
          'под стяжкой с замурованной трубой — это трещина, которую не исправить.',
        fix:
          'Песок уплотняется хорошо, но только влажным и вибрацией: пролить водой ' +
          `и пройти виброплитой в несколько проходов слоями до ${lv.compactLayer} мм. ` +
          'Контроль простой: на уплотнённом песке не остаётся следа от каблука. ' +
          'Щебень сверху уплотнить отдельно — он же работает распределяющим слоем.'
      });
    }

    // --- Срок службы состава ---
    const age = coolantAge(project.coolant);
    if (age?.expired) {
      out.push({
        id: 'coolant-expired',
        severity: 'error',
        layer: 'heating',
        title: `Составу ${age.years.toFixed(0)} лет при сроке службы ${age.shelfLifeYears}`,
        detail:
          `«${project.coolant.brand}» изготовлен ${project.coolant.manufactured}, заявленный ` +
          `гарантийный срок эксплуатации ${age.shelfLifeYears} лет — просрочен на ` +
          `${age.overdueYears.toFixed(0)}. Ингибиторы коррозии выработались. Без них ` +
          'этиленгликоль при перегреве разлагается до гликолевой и щавелевой кислот: ' +
          'pH падает, начинается коррозия. Паспорт котла требует pH 6,5…8,5, а повреждения ' +
          'от накипи и коррозии из гарантии исключены.',
        fix:
          'Менять при заливке тёплого пола — систему всё равно вскрываете, и это ' +
          'единственный момент, когда замена ничего не стоит сверх самого состава. ' +
          'Промыть, залить свежий. Заодно уйдёт вопрос с неизвестной концентрацией.'
      });
    }

    // --- Концентрат разбавлен неизвестно как ---
    if (project.coolant?.dilution && !project.coolant.concentration) {
      const t = project.coolant.dilution
        .map((d) => `${d.freeze} °C → ${d.concentrate}/${d.water}`)
        .join(', ');
      out.push({
        id: 'coolant-dilution-unknown',
        severity: 'warn',
        layer: 'heating',
        title: 'Залит концентрат — фактическая концентрация не известна',
        detail:
          `На этикетке таблица разбавления по объёму: ${t}. Чем именно разбавляли ` +
          'при заливке — не зафиксировано, поэтому теплофизика взята для ~50 %. ' +
          'От концентрации зависят расход, потери давления и температура замерзания.',
        fix:
          'Померить ареометром (рефрактометром) перед заливкой ТП. Если всё равно ' +
          'меняете состав — просто развести по таблице под нужную защиту.'
      });
    }

    // --- Гарантия котла против антифриза ---
    const boiler = project.boiler;
    if (boiler?.antifreezeVoidsExchangerWarranty && project.coolant?.base !== 'water') {
      out.push({
        id: 'boiler-warranty-antifreeze',
        severity: 'warn',
        layer: 'heating',
        title: 'Антифриз выводит теплообменник из-под гарантии котла',
        detail:
          `Паспорт ${boiler.model}, раздел «Общие меры безопасности»: при работе на антифризе ` +
          'дефекты первичного теплообменника — шум, вибрация, выход из строя — ' +
          `НЕ покрываются гарантией производителя. Котёл выпуска ${boiler.made}, ` +
          `гарантия ${boiler.warrantyMonths} месяца с ввода в эксплуатацию, то есть живая. ` +
          'Это цена решения оставить антифриз, а не довод против него: ' +
          'труба тёплого пола замурована в стяжку, и её разрыв необратим.',
        fix:
          'Решение осознанное — зафиксируйте его. Снизить риск: держать концентрацию ' +
          'по этикетке, менять состав по выработке ингибиторов, не перегревать ' +
          `(режим ${boiler.lowTempParam.code}=${boiler.lowTempParam.value} держит ${boiler.lowTempParam.cap} °C).`
      });
    }

    // --- Встроенные средства котла, которые надо просто включить ---
    if (boiler?.lowTempParam) {
      out.push({
        id: 'boiler-lowtemp-param',
        severity: 'info',
        layer: 'heating',
        title: `${boiler.lowTempParam.code}=${boiler.lowTempParam.value}: низкотемпературный режим уже есть в котле`,
        detail:
          `Параметр ограничивает контур отопления ${boiler.lowTempParam.cap} °C с отсечкой горелки ` +
          `на ${boiler.lowTempParam.cutoff} °C. Это штатная защита стяжки, встроенная в котёл. ` +
          `Плюс ${boiler.antiCycleParam.code}: задержка розжига ${boiler.antiCycleParam.factory} минут — ` +
          'заводская защита от тактования, уже включена.',
        fix:
          `Выставить ${boiler.lowTempParam.code}=${boiler.lowTempParam.value}. Накладной аварийный термостат ` +
          'оставить как независимый дублёр: параметр платы защищает, пока плата исправна.'
      });
    }

    // --- Антифриз в контуре ---
    if (project.coolant && project.coolant.base !== 'water') {
      const c = project.coolant;
      const cool = houseCooldown({
        screedMassKg: bc.screedMass.massKg,
        uaWPerK: (hl.total) / (project.climate.tInLiving - project.climate.tOutDesign),
        tStart: project.climate.tInLiving + 2,
        tOut: project.climate.tOutDesign
      });

      out.push({
        id: 'coolant-hydraulics',
        severity: 'warn',
        layer: 'heating',
        title: `Антифриз: расход +${((c.flowFactor - 1) * 100).toFixed(0)} %, потери давления ×${c.pressureDropFactor}`,
        detail:
          `Теплоёмкость ${c.c} против 4,18 кДж/(кг·К) у воды, вязкость выше. ` +
          `Тот же теплосъём требует большего расхода, а потери давления растут — ` +
          `предельная длина петли ТП падает с 90 до ${maxLoopLength(c).toFixed(0)} м, ` +
          'и насос нужен мощнее. Котёл по паспорту тоже теряет около 10 % теплосъёма.',
        fix: 'Считать петли и подбирать насос по антифризу, а не по воде.'
      });

      out.push({
        id: 'coolant-scope',
        severity: 'info',
        layer: 'plumbing',
        title: `Без отопления дом остынет до 0 °C примерно за ${cool.hours.toFixed(0)} ч`,
        detail:
          `При наружных ${project.climate.tOutDesign} °C и массе стяжки ` +
          `${bc.screedMass.massKg.toFixed(0)} кг постоянная времени дома — ` +
          `${cool.tauHours.toFixed(0)} ч. Антифриз оправдан для отключений ДЛИННЕЕ этого срока. ` +
          'Но он защищает только контур отопления: водопровод, сифоны, унитаз и ' +
          'вторичный теплообменник ГВС остаются с водой и замёрзнут раньше.',
        fix: `Котёл потребляет ${project.boiler.electric} Вт — ИБП с аккумулятором закрывает причину, а не следствие.`
      });

      if (c.base === 'ethylene') {
        out.push({
          id: 'coolant-ethylene',
          severity: 'error',
          layer: 'plumbing',
          title: 'Этиленгликоль в системе с контуром ГВС',
          detail: 'Он токсичен, а вторичный теплообменник отделяет его от питьевой воды одной стенкой.',
          fix: 'В бытовых системах с ГВС применяется только пропиленгликоль.'
        });
      }

      // Дом зимой стоит пустым на минимальном отоплении — запас времени
      // считается не от комфортных 22 °C, а от температуры поддержания.
      if (c.houseEmptyInWinter) {
        const cold = houseCooldown({
          screedMassKg: bc.screedMass.massKg,
          uaWPerK: hl.total / (project.climate.tInLiving - project.climate.tOutDesign),
          tStart: c.minHoldTemp,
          tOut: project.climate.tOutDesign
        });
        const ups = upsSizing({ boilerW: project.boiler.electric, targetHours: cold.hours });
        const bank = ups.options.find((o) => o.id === 'agm100x2');

        out.push({
          id: 'coolant-justified',
          severity: 'warn',
          layer: 'heating',
          title: `Дом пустует на ${c.minHoldTemp} °C — до нуля остаётся ${cold.hours.toFixed(0)} ч, а не ${cool.hours.toFixed(0)}`,
          detail:
            'Остывать приходится не от комфортной температуры, а от температуры поддержания, ' +
            'и рядом никого нет, чтобы заметить отключение. Запас сокращается в разы. ' +
            'Труба ТП замурована в стяжку: разрыв там неустраним без вскрытия бетона. ' +
            'При таком режиме эксплуатации антифриз в тёплом полу оправдан.',
          fix:
            `Оставить антифриз и добавить ИБП: банк «${bank.label}» даёт ${bank.hours.toFixed(0)} ч — ` +
            `перекрывает ${cold.hours.toFixed(0)}-часовое окно. Петли считать по антифризу, предел ` +
            `${maxLoopLength(c).toFixed(0)} м.`
        });
      } else if (c.originalReasonResolved) {
        const ups = upsSizing({ boilerW: project.boiler.electric, targetHours: cool.hours });
        out.push({
          id: 'coolant-reconsider',
          severity: 'info',
          layer: 'heating',
          title: 'Причина, по которой залит антифриз, устранена',
          detail:
            `${c.originalReason}. Сейчас подведена центральная вода — давление держится, ` +
            'котёл стартует сам после возврата электричества.',
          fix:
            `ИБП с банком ${ups.options.find((o) => o.id === 'agm100x2').hours.toFixed(0)} ч ` +
            'закрывает типовые отключения. Петли считать по антифризу — тогда подойдёт любой теплоноситель.'
        });
      }

      if (!c.confirmed) {
        out.push({
          id: 'coolant-unconfirmed',
          severity: 'warn',
          layer: 'heating',
          title: 'Марка и концентрация антифриза не подтверждены',
          detail:
            `Расчёт идёт по типовым свойствам «${c.label}» с защитой до ${c.freezePoint} °C. ` +
            `Ингибиторы коррозии вырабатываются примерно за ${c.inhibitorYears} лет, после чего ` +
            'состав меняют. Гликоли несовместимы с оцинкованными трубами и фитингами.',
          fix: 'Посмотреть этикетку залитого состава и паспорт котла: производители ограничивают применение антифриза, а котёл новый и на гарантии.'
        });
      }
    }

    if (!project.climate.confirmed) {
      out.push({
        id: 'climate-unconfirmed',
        severity: 'info',
        layer: 'heating',
        title: 'Климатические параметры не сверены с СП',
        detail: `Расчёт идёт при ${project.climate.tOutDesign} °C (${project.climate.station}).`
      });
    }

    if (!project.envelope.wall.confirmed) {
      out.push({
        id: 'wall-unconfirmed',
        severity: 'warn',
        layer: 'heating',
        title: 'Толщина и марка газобетона не замерены',
        detail:
          `Расчёт идёт при ${project.envelope.wall.thickness} мм и λ = ${project.envelope.wall.lambda}. ` +
          `Это даёт R = ${hl.rWall.toFixed(2)} м²·К/Вт по стене. Разница между D400 и D600 ` +
          'почти двукратная, а от неё зависит вся нагрузка.',
        fix: 'Замерить толщину по оконному откосу, марку найти в документах или на блоках.'
      });
    }
  }

  // --- 8. Минимум бетона над трубой ТП ---
  const coverAvailable = screed.screedTotal - screed.pipeOd;
  if (coverAvailable < screed.pipeCoverMin) {
    out.push({
      id: 'screed-cover',
      severity: 'error',
      layer: 'heating',
      title: 'Мало бетона над трубой тёплого пола',
      detail: `Стяжка ${screed.screedTotal} мм при трубе Ø${screed.pipeOd} даёт ${coverAvailable} мм над трубой, минимум ${screed.pipeCoverMin} мм.`,
      fix: 'Увеличить стяжку или уменьшить диаметр трубы.'
    });
  }

  // --- 9. Коллектор ТП: зона обслуживания ---
  const manifold = nodes.find((n) => n.type === 'manifold');
  if (manifold) {
    const blocked = equipment.find((item) => {
      const fp = footprint(item);
      const zone = { x: manifold.x - 0.7, y: manifold.y - 0.1, w: 0.7, h: manifold.d + 0.2 };
      return (
        item.x < zone.x + zone.w &&
        item.x + fp.w > zone.x &&
        item.y < zone.y + zone.h &&
        item.y + fp.d > zone.y
      );
    });
    if (blocked) {
      const spec = getFixture(blocked.catalogId);
      out.push({
        id: 'manifold-access',
        severity: 'warn',
        layer: 'heating',
        title: 'Перекрыт доступ к коллектору',
        detail: `«${spec?.name}» стоит в зоне обслуживания коллектора (700 мм спереди).`,
        at: { x: manifold.x, y: manifold.y + manifold.d / 2 }
      });
    }
  }

  // --- 10. Неподтверждённые привязки ---
  const unconfirmed = [...nodes, ...openings].filter((n) => n.confirmed === false).length;
  if (unconfirmed > 0) {
    out.push({
      id: 'unconfirmed',
      severity: 'warn',
      layer: 'architecture',
      title: `${unconfirmed} привязок не подтверждено замером`,
      detail:
        'Узлы и проёмы стоят на черновых координатах. До заливки стяжки каждую привязку ' +
        'нужно заменить фактическим замером — иначе все проверки считают вымышленную геометрию.',
      fix: 'Внести замеры мышкой или в src/data/project.js.'
    });
  }

  return sortBySeverity(out);
}
