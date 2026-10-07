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
  wc: 1.3, // people sit over a toilet
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
              title: `Drain “${spec.name}” does not fit in the floor build-up`,
              detail:
                `A ${route.length.toFixed(2)} m run at a 2 cm/m slope raises the invert to ` +
                `${fit.invertMm.toFixed(0)} mm, the pipe crown Ø${c.dia} to ${fit.crownMm.toFixed(0)} mm ` +
                `above the finished floor. The screed bottom is at ${fit.underScreedMm.toFixed(0)} mm. ` +
                `Short by ${Math.abs(fit.marginMm).toFixed(0)} mm.`,
              fix: 'Move the fixture closer to the stack, reduce the XPS/screed, or lower the stack invert.',
              at: { x: c.x, y: c.y }
            });
          } else if (fit.marginMm < 20) {
            out.push({
              id: `drain-tight-${c.id}`,
              severity: 'warn',
              layer: 'plumbing',
              title: `Drain “${spec.name}” is a tight fit`,
              detail: `The margin to the screed bottom is only ${fit.marginMm.toFixed(0)} mm for a ${route.length.toFixed(2)} m run.`,
              fix: 'Keep a reserve — on site the levels always drift.',
              at: { x: c.x, y: c.y }
            });
          }

          if (c.critical && fit.ok && fit.belowInsulation) {
            out.push({
              id: `drain-deep-${c.id}`,
              severity: 'info',
              layer: 'plumbing',
              title: `“${spec.name}”: the pipe goes below the insulation`,
              detail: 'The invert sinks into the fill — this is acceptable, but needs a local solution for supporting and insulating the pipe.',
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
      title: 'Sewer stack not set',
      detail: 'Without a stack point the drain slopes cannot be checked.'
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
          title: `Not enough headroom under the flight for “${spec.name}”`,
          detail: `At the centre of the fixture the headroom under the stair is ${head.toFixed(2)} m, ${req.toFixed(2)} m is required.`,
          fix: 'Move the fixture towards the high part of the flight or move the stair.',
          at: { x: cx, y: cy }
        });
      } else if (spec.workstation && head < WORKSTATION_HEADROOM) {
        // Прибор влезает, но работать за ним под низким маршем неудобно.
        out.push({
          id: `work-${item.id}`,
          severity: 'info',
          layer: 'equipment',
          title: `It will be cramped behind “${spec.name}” under the flight`,
          detail: `Headroom above the fixture is ${head.toFixed(2)} m. It fits, but standing and working is comfortable from ${WORKSTATION_HEADROOM.toFixed(2)} m.`,
          fix: 'Put the work zone closer to the high part of the flight, and put blind cabinets under the low part.',
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
        title: 'The flight does not fit in the allotted length',
        detail: `${stair.risers} risers of ${sc.risePerStep.toFixed(3)} m need a projection of ${sc.requiredRun.toFixed(2)} m, ${sc.actualRun.toFixed(2)} m is allotted.`,
        fix: 'Lengthen the flight, add winders or a landing.',
        at: { x: stair.x + stair.width / 2, y: stair.y + stair.length / 2 }
      });
    }
    if (!sc.riseOk) {
      out.push({
        id: 'stair-rise',
        severity: 'warn',
        layer: 'architecture',
        title: 'Riser higher than 200 mm',
        detail: `Calculated rise ${(sc.risePerStep * 1000).toFixed(0)} mm.`,
        fix: 'Add steps.',
        at: { x: stair.x + stair.width / 2, y: stair.y + stair.length / 2 }
      });
    }
    if (!sc.treadOk) {
      out.push({
        id: 'stair-tread',
        severity: 'warn',
        layer: 'architecture',
        title: 'Tread less than 230 mm',
        detail: `Tread ${(sc.tread * 1000).toFixed(0)} mm — it is awkward to descend such a step.`,
        at: { x: stair.x + stair.width / 2, y: stair.y + stair.length / 2 }
      });
    }
    if (!sc.blondelOk) {
      out.push({
        id: 'stair-blondel',
        severity: 'info',
        layer: 'architecture',
        title: 'Comfort formula out of range',
        detail: `2h + b = ${sc.blondel.toFixed(3)} m, the comfortable range is 0.60–0.65 m.`,
        at: { x: stair.x + stair.width / 2, y: stair.y + stair.length / 2 }
      });
    }
    if (!sc.widthOk) {
      out.push({
        id: 'stair-width',
        severity: 'info',
        layer: 'architecture',
        title: `Step width ${(stair.width * 1000).toFixed(0)} mm — below the 900 guideline`,
        detail:
          `Now ${(stair.existingWidth * 1000).toFixed(0)} mm, designed ` +
          `${(stair.width * 1000).toFixed(0)} mm — noticeably better, but short of 900. ` +
          'The guideline is an assumption, check it against the current text of the code.',
        at: { x: stair.x + stair.width / 2, y: stair.y + stair.length / 2 }
      });
    }
    if (!sc.angleOk) {
      out.push({
        id: 'stair-angle',
        severity: 'warn',
        layer: 'architecture',
        title: `Slope angle ${sc.angleDeg.toFixed(1)}° — steeper than ${STAIR_NORMS.maxAngleDeg}°`,
        detail:
          `With a riser of ${(sc.risePerStep * 1000).toFixed(0)} and a tread of ` +
          `${(sc.tread * 1000).toFixed(0)} mm the flight turns out steep.`,
        fix: 'Increase the tread — possible only at the expense of the flight length, i.e. the opening.',
        at: { x: stair.x + stair.width / 2, y: stair.y + stair.length / 2 }
      });
    }
    if (!sc.comfortOk) {
      out.push({
        id: 'stair-comfort',
        severity: 'info',
        layer: 'architecture',
        title: `Comfort formula h + s = ${(sc.comfort * 1000).toFixed(0)} mm instead of ~450`,
        detail:
          `Riser ${(sc.risePerStep * 1000).toFixed(0)} + tread ` +
          `${(sc.tread * 1000).toFixed(0)} mm. Below 450 the stride becomes short and frequent.`,
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
        title: `Approach in front of the stair ${(approach * 1000).toFixed(0)} mm — less than a metre`,
        detail: `In front of the bottom step at least ${(stair.minApproach * 1000).toFixed(0)} mm is needed so that you can step onto it.`,
        fix: 'Raise the bottom of the flight back. The flight can only be lengthened upwards, by means of the opening.',
        at: { x: stair.x + stair.width / 2, y: stair.y + stair.length }
      });
    }
    if (stair.minLanding && stair.y < stair.minLanding - 0.02) {
      out.push({
        id: 'stair-landing',
        severity: 'error',
        layer: 'architecture',
        title: `Landing at the top ${(stair.y * 1000).toFixed(0)} mm — less than a metre`,
        detail:
          `Over the section 0…${stair.y.toFixed(2)} m on the second floor a landing of ` +
          `at least ${(stair.minLanding * 1000).toFixed(0)} mm must remain so that you can step off the flight. Right now it is short.`,
        fix: 'Lower the top of the flight or reduce the tread.',
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
          ? `There is an option that passes every criterion: ${best.risers} risers`
          : `${best.risers} risers fits best`,
        detail:
          `With an approach of ${(stair.minApproach * 1000).toFixed(0)} and a landing of ` +
          `${(stair.minLanding * 1000).toFixed(0)} mm, ${maxRun.toFixed(2)} m is left for the flight. ` +
          `${best.risers} risers give a riser height of ${(best.risePerStep * 1000).toFixed(0)}, ` +
          `a tread of ${(best.tread * 1000).toFixed(0)} mm, an angle of ${best.angleDeg.toFixed(1)}°, ` +
          `2h + s = ${(best.blondel * 1000).toFixed(0)}, h + s = ${(best.comfort * 1000).toFixed(0)} mm. ` +
          `Now ${stair.risers} risers: tread ${(sc.tread * 1000).toFixed(0)} mm, ` +
          `2h + s = ${(sc.blondel * 1000).toFixed(0)}.`,
        fix: `Set ${best.risers} risers and a projection of ${maxRun.toFixed(2)} m.`,
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
        title: `The opening must be moved by ${(shift * 1000).toFixed(0)} mm over the bathroom`,
        detail:
          `The existing opening ends at level ${stair.existingOpeningTopY.toFixed(2)} m: ` +
          `with ${stair.risers} risers that is a projection of ${existingRun.toFixed(2)} m and a tread of ` +
          `only ${(existingTread * 1000).toFixed(0)} mm — hence the steepness. The proposed flight of ` +
          `${stair.length.toFixed(2)} m gives a tread of ${(sc.tread * 1000).toFixed(0)} mm.`,
        fix: 'Remove a section of the slab over the bathroom. Check the direction and spacing of the joists, the bearing, the beam along the edge.',
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
        title: `“${spec.name}” is far from the gas inlet`,
        detail: `It is ${nearest.d.toFixed(2)} m to the nearest gas point. The inlet exists and moving it is a separate job with the gas service.`,
        fix: 'Keep the hob within ~1.5 m of the existing inlet.',
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
        title: `“${spec.name}” crosses a wall or a room boundary`,
        detail: 'The fixture partly extends beyond one room.',
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
          title: `“${sa?.name}” and “${sb?.name}” overlap`,
          detail: `Overlap of about ${(hit.depth * 1000).toFixed(0)} mm.`,
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
      title: `Opening “${o.id}” ended up in the wrong room`,
      detail:
        `By its reference it must be in the room “${room.name}”, but it landed ` +
        `${actual ? `in “${actual.name}”` : 'outside the rooms'}. The opening position is measured — ` +
        'so the partition has moved away from it.',
      fix: 'Put the partition back or recheck the opening measurement.',
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
      title: `Fill of ${levels.sandFill} mm — ${lv.compactLayers} compaction ${lv.compactLayers === 1 ? 'layer' : 'layers'}`,
      detail:
        `Sand is compacted in layers no thicker than ${levels.compactLayer} mm, each watered ` +
        'and vibrated. Dumping it all at once and tamping from the top is not an option: the bottom stays loose, ' +
        'and the screed with the heating pipe will settle and crack. This is irreversible — you cannot get a pipe out of concrete.',
      fix: 'Include layer-by-layer compaction and density control before the pour in the works.'
    });

    if (Math.abs(lv.floorDelta) > 5) {
      out.push({
        id: 'floor-delta',
        severity: 'info',
        layer: 'architecture',
        title: lv.floorDelta > 0
          ? `The floor will rise by ${lv.floorDelta.toFixed(0)} mm`
          : `The floor will drop by ${Math.abs(lv.floorDelta).toFixed(0)} mm`,
        detail:
          `The room height will be ${lv.clearHeight.toFixed(0)} mm, ` +
          `floor to attic floor — ${lv.floorToFloor.toFixed(0)} mm. ` +
          `For the floor to stay in place, ${lv.sandForNoChange.toFixed(0)} mm of sand is needed.`
      });
    }

    if (lv.clearHeight < 2500) {
      out.push({
        id: 'clear-height',
        severity: 'warn',
        layer: 'architecture',
        title: `Room height ${lv.clearHeight.toFixed(0)} mm`,
        detail: 'Raising the floor eats height. Below 2500 mm the room starts to feel oppressive.',
        fix: 'Reduce the fill or the thickness of the build-up.'
      });
    }

    // Торец плиты — главный путь потерь, и добраться до него можно
    // только пока подполье открыто
    if (!levels.edgeInsulation) {
      out.push({
        id: 'edge-insulation',
        severity: 'error',
        layer: 'heating',
        title: 'No insulation of the slab edge around the perimeter',
        detail:
          'The heated floor abuts the cold foundation: the temperature drop there is not 20 but 45–50 K, ' +
          'and per metre of perimeter more is lost than per square metre of the field. ' +
          'Outside, the plinth is covered by the blind area, but inside the sub-floor is still open — ' +
          'this is the only chance to glue XPS to the inner face of the foundation.',
        fix: 'Fit XPS 50–100 mm on the inner face of the foundation, 400–600 mm down, BEFORE the fill.'
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
          title: `The edge insulation stops ${levels.edgeTop.toFixed(0)} mm short of the finished floor`,
          detail:
            `${uncovered.toFixed(0)} mm of screed touch the foundation directly. The heating pipe lies ` +
            'precisely in the screed, so this is where the temperature is highest and the outward flux ' +
            'is largest — insulating only the lower layers makes no sense.',
          fix: 'Bring the break up to the finished floor level: XPS up to the screed bottom, damper strip above.'
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
          title: 'The screed edge butts against the wall without a gap',
          detail:
            'The edge XPS ends at the screed bottom, while the screed itself reaches the wall. ' +
            'Without a strip it, firstly, gives heat to the wall with its hottest part, ' +
            'and secondly, on heating it pushes against the wall and cracks: 5.5 m of concrete ' +
            'lengthens by about 1 mm from 10 to 28 °C.',
          fix: 'A damper strip of 8–10 mm along the perimeter and along the partitions, ' +
            'trimmed after laying the porcelain tile.'
        });
      }
      if (levels.edgeInsulationDepth < 300) {
        out.push({
          id: 'edge-depth',
          severity: 'warn',
          layer: 'heating',
          title: `The edge insulation goes down only ${levels.edgeInsulationDepth.toFixed(0)} mm`,
          detail:
            'Heat bypasses a short insulation under it along the foundation. The working depth is ' +
            '400–600 mm from the finished floor down the inner face.',
          fix: 'Increase the depth to 400–600 mm — while the sub-floor is open, this is cheap.'
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
      title: `Total build-up thickness: ${aboveGround} mm`,
      detail:
        `Crushed stone ${screed.gravel} + XPS ${screed.insulation} + screed ${screed.screedTotal} + ` +
        `finish ${screed.finishThickness} mm. The finished floor level will rise by this amount ` +
        'from the top of the exposed base — check against the entrance door threshold and the window sills.',
      fix: 'Enter the actual threshold level so that the rule becomes verifiable.'
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
        title: `Pipe pitch ${spacings.join(' / ')} mm on a 100 × 100 mesh`,
        detail:
          'Pitch is the distance between ADJACENT pipes, and the supply and return of ' +
          'counterflow laying always lie side by side. There is no separate “return in the middle”: ' +
          'at a pitch of 200 the forward run goes every 400, the return fills the gaps, ' +
          'and the pipe ends up lying on a bar. It need not coincide with the cell — ' +
          'it is tied to the cross bars, which cross the pipe every 100 mm ' +
          'at any pitch.' +
          (offGrid.length
            ? ` A pitch of ${offGrid.join(', ')} mm does not land on the bars — that is normal, ` +
              'it is marked out with a tape measure along the damper strip.'
            : ''),
        fix:
          'Mark the pitch with a marker on the strip before unrolling the pipe, tie it with clips ' +
          'to every third bar on the straight and to every bar on the bend.',
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
        title: `“${r.name}”: the floor is not enough, supplementary heating of ${shortfall.toFixed(0)} W needed`,
        detail:
          `Furniture and appliances occupy ${r.excludedArea.toFixed(2)} of ${r.area.toFixed(2)} m². ` +
          `The load of ${r.roomLoadW.toFixed(0)} W must be delivered by the remaining ${r.effectiveArea.toFixed(2)} m², ` +
          `that is ${r.requiredWm2.toFixed(0)} W/m². With the surface limited to ${r.maxFloorTemp} °C ` +
          `the floor gives at most ${best.toFixed(0)} W/m².`,
        fix: r.id === 'bath'
          ? 'The towel radiator covers the whole difference — this is the standard solution for a bathroom.'
          : 'A radiator under the window, or lift the exclusion for furniture on legs, or refine the air change rate.'
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
        title: `“${spec.name}” stands over the edge zone`,
        detail:
          `The pipe pitch there is ${(EDGE_ZONE.spacing * 1000).toFixed(0)} mm instead of ` +
          `${(lp.byRoom[0]?.spacing * 1000 || 150).toFixed(0)} and the surface temperature is higher. ` +
          `It does no harm to furniture by itself — trapped heat does: without ventilation ` +
          `under a solid object the temperature goes towards the coolant temperature. ` +
          `A ventilated gap of ${(MIN_FURNITURE_GAP * 1000).toFixed(0)} mm or more is needed.`,
        fix:
          'For kitchen cabinets — a plinth with ventilation grilles. For upholstered furniture — ' +
          'legs and a 100–150 mm offset from the wall, otherwise the edge strip heats under the sofa ' +
          'instead of intercepting the cold from the window.',
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
        title: `“${r.name}”: ${r.loops} loops instead of ${r.loops - 1} because of ${(r.totalPipe - r.limit * (r.loops - 1)).toFixed(0)} m`,
        detail:
          `${r.totalPipe.toFixed(0)} m of pipe with a limit of ${r.limit.toFixed(0)} m per loop. ` +
          `Divided into ${r.loops - 1}, that gives ${oneFewer.toFixed(0)} m — over by just ` +
          `${(oneFewer - r.limit).toFixed(0)} m. The ${r.limit.toFixed(0)} m limit is a simplified ` +
          'pressure-drop rule, and the hydraulic calculation showed a head margin of almost double.',
        fix: `Check against the pump curve: ${r.loops - 1} loops of ${oneFewer.toFixed(0)} m most likely pass.`,
        at: { x: r.exclusions[0]?.x ?? 2, y: 2 }
      });
    });

    if (lp.totalLoops > 0) {
      out.push({
        id: 'loops-summary',
        severity: 'info',
        layer: 'heating',
        title: `Layout: ${lp.totalLoops} loops, ${lp.totalPipe.toFixed(0)} m of pipe`,
        detail:
          lp.byRoom.map((r) => `${r.name}: ${r.loops} × ${r.perLoop.toFixed(0)} m, pitch ${(r.spacing * 1000).toFixed(0)}`).join('; ') +
          `. Imbalance ${(lp.imbalance * 100).toFixed(0)} % — balancing valves on the manifold are mandatory.`
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
        title: `Grade of the old insulation ${screed.insulationReused} mm not confirmed`,
        detail:
          'It lay on the boards under the linoleum, i.e. without load. Under a screed with a heating pipe ' +
          'the insulation carries about 155 kg/m² permanently, and a compressive strength ' +
          'of 250 kPa or more is needed. Thin underlay boards are often weaker, and ordinary polystyrene ' +
          'creeps — the screed will settle after the pour.',
        fix: 'Find the marking on the boards. No marking or dents — do not put it under the screed.'
      });
    }

    if (fresh > 0 && screed.insulationReused < 30) {
      out.push({
        id: 'reused-position',
        severity: 'info',
        layer: 'heating',
        title: `Old ${screed.insulationReused} mm — as the second layer, with staggered joints`,
        detail:
          `The new ${fresh} mm go first: a board of that thickness is rigid and bridges ` +
          'small irregularities of the base. Thin old boards on top, joints staggered — ' +
          `so there are fewer bridges at the joints. But ${screed.insulationReused} mm is too little for ` +
          'harpoon staples, so fix the pipe to the mesh with clips.',
        fix: 'Before laying, check the old boards for dents and linoleum glue residue.'
      });
    }

    if (fresh <= 0) {
      out.push({
        id: 'reused-only',
        severity: 'error',
        layer: 'heating',
        title: 'Floor insulation only from old boards',
        detail: `${screed.insulation} mm provided, of which ${screed.insulationReused} mm are used. There is no new insulation.`,
        fix: 'Add a new layer: the old 25 mm is not insulation by itself, but an underlay.'
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
        title: `At minimum the boiler gives ${bc.minPowerKw} kW against a load of ${hl.totalKw.toFixed(2)} kW`,
        detail:
          `An excess of ${bc.ratio.toFixed(1)} times: the boiler cannot modulate lower, ` +
          `so it will short-cycle. Through a mixing unit the burner cycle is ` +
          `${separated.cycleMinutes.toFixed(1)} min — that means wear and wasted gas. ` +
          `With a direct low-temperature connection the boiler is coupled to the screed mass ` +
          `(${bc.screedMass.massKg.toFixed(0)} kg of concrete ≈ ${bc.screedMass.waterEquivalentL.toFixed(0)} l of water), ` +
          `and the cycle stretches to ${direct.cycleMinutes.toFixed(0)} min.`,
        fix: bc.best
          ? `The “${bc.best.name}” scheme solves the problem without a buffer tank — no space is spent in the hall.`
          : `A coolant volume of at least ${bc.requiredVolumeL.toFixed(0)} l is needed.`
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
      title: 'The screed is protected from overheating only by the boiler setting',
      detail:
        `The direct connection was chosen for the sake of a ${bc.screedMass.massKg.toFixed(0)} kg concrete buffer, ` +
        'and that is right. But there is no mixing unit in the scheme, so between the boiler ' +
        `and the pipe in the screed there is one parameter ${project.boiler.lowTempParam.code} = ` +
        `${project.boiler.lowTempParam.value}. A factory reset, a board replacement or a sensor ` +
        `fault — and up to ${project.boiler.heatingRange[1]} °C goes into the screed.`,
      fix:
        'A strap-on emergency thermostat on the supply, set to 55 °C, in series with the ' +
        'heat demand circuit. Costs about 2 k and works without the boiler electronics.'
    });

    // 2. Погодозависимая кривая требует уличного датчика
    if (project.boiler.weatherCurve) {
      const wc = project.boiler.weatherCurve;
      out.push({
        id: 'outdoor-sensor',
        severity: 'warn',
        layer: 'heating',
        title: `The ${wc.param} ≈ ${wc.recommended} curve is built into the calculation — an outdoor sensor is needed`,
        detail:
          'Without an outdoor sensor the boiler holds a fixed supply temperature, ' +
          'while the whole logic of the low-temperature mode rests on the supply ' +
          'falling as the weather warms. It is weather compensation that stretches ' +
          'the burner cycle in the shoulder season, when short-cycling is at its worst.',
        fix: 'Outdoor temperature sensor on the NORTH wall, out of the flue plume.'
      });
    }

    // 3. Подпитка ядовитым гликолем
    if (project.coolant?.toxic) {
      out.push({
        id: 'makeup-toxic',
        severity: 'error',
        layer: 'heating',
        title: 'Make-up from the mains with a toxic coolant is unacceptable',
        detail:
          'The boiler has a built-in make-up valve from the DHW circuit — a single valve ' +
          'between drinking water and ethylene glycol. Besides, any make-up with water ' +
          'dilutes the mixture: there is nothing to top up with except ready-mixed fluid.',
        fix:
          'Plug and seal the built-in make-up valve. Make-up by a manual ' +
          'test pump from a tank of ready-mixed fluid, physically disconnectable ' +
          'from the system. Monitor the pressure on the boiler gauge.'
      });
    }

    // 4. Расширительный бак против гликоля
    const exp = brPlan.expansion;
    out.push({
      id: 'expansion-vessel',
      severity: exp.ok ? 'info' : 'error',
      layer: 'heating',
      title: exp.ok
        ? `The built-in ${exp.vesselL} l vessel is enough: ${exp.requiredL.toFixed(1)} l needed, margin ×${exp.margin.toFixed(1)}`
        : `A ${exp.vesselL} l vessel is too small: ${exp.requiredL.toFixed(1)} l needed`,
      detail:
        `The ground-floor system is ${brPlan.volume.totalL.toFixed(0)} l ` +
        `(loops ${brPlan.volume.loopsL.toFixed(0)}, boiler ${brPlan.volume.boilerL}, ` +
        `manifold ${brPlan.volume.manifoldL}). Glycol expands by ` +
        `${(exp.ratio * 100).toFixed(1)} % against 1.2 % for water — this is the only place ` +
        'where antifreeze works against us. The attic circuit is NOT included in the volume ' +
        'and will be added on top.',
      fix: `Set the vessel precharge to ${exp.prechargeBar} bar BEFORE filling, ` +
        'otherwise the rated capacity does not work.'
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
          title: 'There is no extract duct in the kitchen with a gas hob',
          detail:
            `Burning gas produces about ${WATER_PER_M3_GAS} kg of water vapour per cubic metre: ` +
            `two hours of cooking put about ${moisture.toFixed(1)} kg of moisture into the air. ` +
            `Condensation on the windows starts already at ${worst?.criticalRh.toFixed(0)} % humidity, ` +
            'while airing through a window works in fits and starts and chills the room. ' +
            'For gasified kitchens an extract duct is usually mandatory — check against SP 402.1325800.',
          fix: `A duct Ø${(vp.kitchen.diameter * 1000).toFixed(0)} for constant extraction of ${vp.kitchen.flow} m³/h.`
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
          title: `The kitchen duct is ${dist.toFixed(1)} m from the hob — this is fine`,
          detail:
            'The general-extract duct removes air from the room volume, so its position ' +
            'on the plan is free: the corner behind the fridge works. What matters is the height — ' +
            `under the ceiling (${kitchenVent.mountHeight} m assumed), combustion products and humid ` +
            'air rise. But it does NOT replace the hood over the hob: the hood catches ' +
            'the plume at its source, and in a corner it is useless.',
          fix:
            `A duct Ø${kitchenVent.duct} for ${kitchenVent.flow} m³/h in the corner — plus decide separately ` +
            'about the hood: ducting into its own channel or recirculation with a carbon filter. ' +
            'Recirculation does not remove moisture and combustion products, so the general-extract duct is needed in any case.'
        });

        out.push({
          id: 'kitchen-vent-makeup',
          severity: 'warn',
          layer: 'plumbing',
          title: 'The kitchen extract needs make-up air and frost protection',
          detail:
            `${kitchenVent.flow} m³/h will not go anywhere if there is nowhere for the air to come from: in a tight house ` +
            'the duct simply will not pull. Besides, the outlet goes through an outer wall — at −27 °C ' +
            'humid air condenses in the duct and ices up.',
          fix:
            'Supply vents in the windows or wall. Insulate the duct, fit a non-return valve ' +
            'and slope it outwards. Do NOT combine the kitchen duct with the bathroom one.'
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
        title: `${embeds.length} embeds for the worktop — fit BEFORE the pour`,
        detail:
          'You cannot drill into a screed with a heating pipe afterwards: the anchor will hit ' +
          'the pipe, and without a thermal imager you cannot find it. A 100 × 100 × 5 plate ' +
          'is laid flush with the finished screed, the anchors are tied to the reinforcing ' +
          'mesh — they are short and do not reach the pipe. ' +
          'A post stands on the joint of two sections, where the cabinet side panel runs anyway, ' +
          'and is hidden behind the front. The embeds are laid with a SURPLUS, every 600: ' +
          'a spare one under the plinth is not visible, but a missing one cannot be added later.',
        fix:
          'Mark out on the plan after laying the pipe, fix to the mesh ' +
          'and PHOTOGRAPH WITH A TAPE MEASURE before the concrete — otherwise you will not find them.',
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
            title: `“${spec.name}” falls in an opening`,
            detail:
              `The point is in the opening “${op.id}” or closer than ${(TRIM * 1000).toFixed(0)} mm to its edge. ` +
              'There is nowhere to put a box in an opening — there is the rebate and the jamb, and the casing ' +
              'takes another 70–100 mm. A switch must stand off the edge of the opening ' +
              'by at least the casing width plus a margin.',
            fix: 'Move it along the wall by at least 150 mm from the edge of the opening.',
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
        ? bathX + bathDoor.start + bathDoor.len // hinges on the right — the leaf swings towards the stair
        : bathX + bathDoor.start;
      const boxingX = stairCfg.x;
      const gap = boxingX - leafX;

      if (bathDoor.hinge === 'b' && gap < 0.5) {
        out.push({
          id: 'bath-door-vs-understair',
          severity: 'warn',
          layer: 'architecture',
          title: `The open bathroom door stands in front of the pantry: gap ${(gap * 1000).toFixed(0)} mm`,
          detail:
            `Hinges on the right, the leaf swings towards the stair and when open stands ` +
            `at x=${leafX.toFixed(2)}, while the flight boxing starts at ` +
            `x=${boxingX.toFixed(2)}. The leaf blocks the first ${(bathDoor.len * 1000).toFixed(0)} mm ` +
            'of the pantry front — and that is its tallest part, where the washing machine stands.',
          fix:
            'Re-hang the hinges to the left jamb: the leaf will swing towards the kitchen, ' +
            'where there is nothing at that height, and the pantry front is freed entirely. ' +
            'Or a sliding bathroom door — it will also give back 3.24 m² of area inside the room.',
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
        title: `Lighting runs along a wooden floor — ${lightPoints} points`,
        detail:
          'The floor is joisted, the space between the joists is empty, PVC below. ' +
          'The key point: CONCEALED wiring in combustible structures requires ' +
          'a metal pipe or metal hose — plastic corrugated conduit is not ' +
          'suitable. OPEN wiring has no such requirement and in addition ' +
          'remains accessible for inspection. Check against the current edition of the electrical code.',
        fix:
          ceil.cavityFilled
            ? 'A concealed route — in metal hose.'
            : 'If you cover it with a sheet — cable in metal hose. If you leave the ' +
              'joists open — run it openly along the side face of the joist in the upper ' +
              'corner: it is barely visible from below, and the requirements are simpler.'
      });

      if (!ceil.cavityFilled) {
        out.push({
          id: 'ceiling-access-window',
          severity: 'info',
          layer: 'electrical',
          title: 'While the PVC is off — access to the whole floor is open',
          detail:
            'No subfloor and no fill: once the panels are off you get an empty ' +
            'space between the joists over the whole area. There is no need to lift ' +
            'the attic boards. The attic is heated, so insulation between the floors ' +
            'is needed NOT for heat, only against the noise of footsteps from above.',
          fix:
            'Decide everything at once: lighting routes, mineral wool for sound and gaps between ' +
            'the boards. This access will open a second time only with a new demolition.'
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
          title: `Cables in the screed run every ${(ROUTE.pitch * 1000).toFixed(0)} mm — clearance ${clearance.toFixed(0)} mm`,
          detail:
            `For VVGng-LS 3×2.5 (diameter ${CABLE_OD_MM} mm) free cooling ` +
            `needs a clearance of at least ${2 * CABLE_OD_MM} mm. Closer — the cables ` +
            'heat each other, and the permissible current drops by about a third.',
          fix: `Space the routes at a pitch of at least ${(2 * CABLE_OD_MM + CABLE_OD_MM).toFixed(0)} mm ` +
            'or run some of the groups along another wall.'
        });
      } else {
        out.push({
          id: 'cable-bundle-ok',
          severity: 'info',
          layer: 'electrical',
          title: `${lineCount} power groups in the floor, clearance between cables ${clearance.toFixed(0)} mm`,
          detail:
            `A pitch of ${(ROUTE.pitch * 1000).toFixed(0)} mm gives a clearance of more than two diameters, ` +
            'so the derating factor of the electrical code does not apply and 2.5 mm² honestly ' +
            'carries its 16 A. The number of lines does not affect bundle density at this pitch — ' +
            'combining groups makes sense for the simplicity of the panel, not because of heating.',
          fix: 'Keep the pitch when marking out: do not gather the cables into a bundle or pull them together with clips.'
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
          title: `Under the worktop ${((wt.top - wt.thickness) * 1000).toFixed(0)} mm — “${worst.name}” does not fit by ${(-worst.margin * 1000).toFixed(0)} mm`,
          detail:
            `Top of the slab ${(wt.top * 1000).toFixed(0)}, concrete ${(wt.thickness * 1000).toFixed(0)} mm, ` +
            `so the underside is at ${((wt.top - wt.thickness) * 1000).toFixed(0)}. ` +
            `The fixture in the model is ${(worst.height * 1000).toFixed(0)} mm. ` +
            'Built-in appliances are usually adjustable on feet within 815–870, ' +
            'so this is most likely solved on site — but it must be checked ' +
            'against the data sheet of the specific model, not against the model in the planner.',
          fix:
            `Raise the top of the slab to ${((worst.height + wt.thickness) * 1000).toFixed(0)} mm ` +
            'or thin the concrete to 40 mm. The frame on embeds allows either — ' +
            'but it must be decided BEFORE pouring the worktop.',
          at: { x: wt.polygon[0].x + 0.3, y: wt.depth / 2 }
        });
      }

      out.push({
        id: 'worktop-front',
        severity: 'info',
        layer: 'equipment',
        title: `Worktop ${wt.runM.toFixed(2)} m of front, ${wt.area.toFixed(2)} m² of concrete`,
        detail:
          `It runs from “${wt.tall[0]?.name ?? 'the start of the front'}” along the top wall ` +
          `and down the bathroom partition. ${wt.cutouts.length} appliances are set into it: ` +
          `${wt.cutouts.map((c) => c.name.toLowerCase()).join(', ')}. ` +
          `The rest stands under it. At a thickness of ${(wt.thickness * 1000).toFixed(0)} mm ` +
          `the slab weighs about ${(wt.area * wt.thickness * 2400).toFixed(0)} kg — ` +
          'this is a load on the posts and embeds, not only on the cabinets.',
        fix: 'Supports are placed at the cross faces of the sections and clad in chipboard flush with the front.'
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
          title: `${(tight.gap * 1000).toFixed(0)} mm in front of the kitchen front — nowhere to stand`,
          detail:
            `Opposite “${tight.b.name}” stands “${tight.near.name}”, and between the worktop ` +
            `edge and it ${(tight.gap * 1000).toFixed(0)} mm remains. ` +
            `A person at the work surface needs ${WORK_AISLE.comfort * 1000} mm, ` +
            `squeezing past — ${WORK_AISLE.min * 1000}. There is NO overlap of objects, ` +
            'so the ordinary footprint check stays silent.',
          fix:
            `Move the dining group ${((WORK_AISLE.comfort - tight.gap) * 1000).toFixed(0)} mm ` +
            'away from the kitchen. This is placement, not structure: fixed with the mouse and affects nothing ' +
            'in the screed.',
          at: { x: tight.b.cx, y: wt.depth + tight.gap / 2 }
        });
      } else if (tight) {
        out.push({
          id: 'kitchen-aisle-ok',
          severity: tight.gap < WORK_AISLE.comfort ? 'warn' : 'info',
          layer: 'equipment',
          title: `Work aisle at the kitchen ${(tight.gap * 1000).toFixed(0)} mm`,
          detail: `The narrowest spot is opposite “${tight.b.name}”. ` +
            `Comfortable ${WORK_AISLE.comfort * 1000}, minimum ${WORK_AISLE.min * 1000}.`,
          fix: 'Keep this clearance when placing furniture.'
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
          title: `The door of “${b.name}” hits “${hit[0].name}”`,
          detail:
            `The open door extends ${(depth * 1000).toFixed(0)} mm forward, ` +
            `to the mark ${((front + depth) * 1000).toFixed(0)}, while “${hit[0].name}” ` +
            `starts at ${(hit[0].y * 1000).toFixed(0)}. The appliance will not open fully, ` +
            'and for an oven that also means the tray cannot be pulled out.',
          fix: 'Move the obstructing object or relocate the appliance along the front.',
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
        title: `Slab ${cur.t} mm: ${cur.massKg.toFixed(0)} kg, clearance under it ${cur.underMm} mm`,
        detail:
          `The slab field spanning 500 between the longitudinal angles gives ` +
          `${cur.fieldMPa.toFixed(2)} MPa against a limit of ${cur.allowMPa.toFixed(2)} — ` +
          'it does not decide the thickness. The bridges at the cut-outs decide: a 75 mm strip ' +
          `without support would give ${cur.stripFreeMPa.toFixed(1)} MPa and break, ` +
          'but the longitudinal angle runs 50 mm from the edge — right under it, ' +
          `leaving ${cur.stripFramedMPa.toFixed(2)} MPa. ` +
          `${cur.barMm} mm remains for the reinforcement after the cover: Ø4 fits, ` +
          `Ø6 does not. At ${thin ? thin.t : 30} mm nothing remains.`,
        fix:
          'The frame angles must run UNDER the cut-out bridges — if a cut-out ' +
          'is made larger than calculated, recheck. Fine aggregate ' +
          '(up to 5–8 mm), fibre against shrinkage, cover with film for 7 days. ' +
          'At the inside corner of the L — a diagonal bar: there is a stress concentrator.'
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
        if (!sp || !sp.builtInTop || !/sink/i.test(sp.name)) return null;
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
            ? 'The sink tap is under an OPENING sash — it will knock it off'
            : `Sink under the window, tap under the fixed sash (${gap.toFixed(0)} mm to the sill)`,
          detail:
            `The sink is offset from the window centre by ${Math.abs(centreOffset).toFixed(0)} mm. ` +
            `Sill ${(overWin.sill * 1000).toFixed(0)}, top of the worktop ` +
            `${(wt.top * 1000).toFixed(0)} — between them ${gap.toFixed(0)} mm, ` +
            'so effectively there is no backsplash behind the sink. ' +
            (tapUnderBlind === true
              ? 'The tap falls on the FIXED half: there is nothing to knock it off, ' +
                'an ordinary mixer sits fine and simply stands in front of the glass. ' +
                'A folding one is not needed.'
              : tapUnderBlind === false
                ? 'The sash is tilt-and-turn and, opened fully, swings inward ' +
                  'by its whole width — it will sweep away the tap and everything on the worktop.'
                : 'How the sash opens has not been specified.'),
          fix: tapUnderBlind === false
            ? 'Move the sink under the fixed half of the window or take a folding mixer.'
            : 'A moisture-resistant sill, sealant at the joint with the backsplash. ' +
              'Keep nothing permanent on the worktop under the opening sash: ' +
              'when fully open it will pass over it.',
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
        title: `Rear support: ${sparse.posts} posts at a pitch of ${sparse.pitch} against ${bs.frontPosts} at the front`,
        detail:
          `What has to be calculated is not the angle but the ASSEMBLY of angle and slab. By itself ` +
          `40 × 40 over a span of ${sparse.pitch} would deflect by ${sparse.deflAngleMm.toFixed(1)} mm, ` +
          `but together with 60 mm of concrete — by ${sparse.deflCombinedMm.toFixed(2)} mm: the slab carries itself, ` +
          `the angle is its guide. Stress ${sparse.sigmaMPa.toFixed(0)} MPa against a limit of 160. ` +
          `An alternative is a wall angle instead of the rear posts: it holds, margin ` +
          `×${ledger.ledger.safety.toFixed(1)} per dowel at a pitch of ${ledger.ledger.pitchMm}, ` +
          'but only on aerated concrete — along the bathroom partition there is plasterboard, ' +
          'and the posts stay there in any case.',
        fix:
          'The embeds are placed BEFORE THE POUR anyway and cost 275 ₽ — lay 16 ' +
          'on both lines, and decide later what holds the rear edge.'
      });
    }

    // --- Подрозетники, утопленные в наружную стену ---
    //
    // Коронка 68 на глубину 45 снимает часть блока и всю штукатурку.
    // Стена в этом месте локально тоньше, поверхность холоднее — вопрос,
    // не окажется ли она ниже точки росы.
    if (project.envelope?.wall) {
      const NEAR = 0.16; // counted as “at the outer wall”, m
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
            ? `Condensation will fall behind the sockets in the outer wall: ${bx.tAtBox.toFixed(1)} °C at a dew point of ${bx.dewPoint.toFixed(1)}`
            : `${onOuter.length} back boxes in the outer wall — condensation margin ${bx.margin.toFixed(1)} K`,
          detail:
            `A ${BACK_BOX.crown} mm crown cut to a depth of ${BACK_BOX.depth} leaves ` +
            `${bx.remainingMm.toFixed(0)} mm of block out of ${wallMm}. The surface behind the box is ` +
            `${bx.tAtBox.toFixed(1)} °C against ${bx.tSolid.toFixed(1)} through the whole section — ` +
            `recessing costs ${bx.penalty.toFixed(1)} K. Condensation starts ` +
            `at ${bx.criticalRh.toFixed(0)} % humidity, i.e. it will not start. ` +
            'The real risk here is not thermal but air: the box is a hole ' +
            'in the plaster, and it is the plaster that works as the air barrier.' +
            (bx.assumed
              ? ` The block thickness ${wallMm} mm and the outer XPS are NOT MEASURED — the figures are indicative.`
              : ''),
          fix:
            'Crown WITHOUT hammer action — in hammer mode the aerated concrete around the hole ' +
            'crumbles and the box does not hold. A back box for solid walls, ' +
            'set it into gypsum plaster and fill the gap around it with the same: ' +
            'this is both the fixing and the restoration of the air barrier. ' +
            'Run chases vertically from the floor to the box, 20–25 mm deep.'
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
          ? `Emergency board: 4 branches, socket through breaker B${ep.socket.rating} A — peak ${ep.socket.peakW} W of ${inverterW}`
          : `The emergency line does not fit the inverter: ${ep.socket.peakW} W of ${inverterW}`,
        detail:
          `Constant loads ${ep.baseW} W, ${ep.socket.spareW} W free = ` +
          `${ep.socket.spareA.toFixed(2)} A. The boiler line has stopped being “boiler only”, ` +
          'and the original objection — someone else’s fault must not shut down the heating — ' +
          'is removed by the board, not by a promise: each branch has its own device. ' +
          'A short circuit in the light or the socket trips ITS breaker and does not reach the boiler. ' +
          'A class II luminaire has no earthed parts, so it cannot produce ' +
          'an earth leakage in principle. The socket goes through its own ' +
          `RCBO ${ep.panel.socketRcdMa} mA — more sensitive than the common 30 and closer to the load. ` +
          `Modules used ${ep.modulesUsed} of ${ep.panel.modules}.`,
        fix:
          `The socket breaker — characteristic B, rating ${ep.socket.rating} A. ` +
          'Not C: a 2 kW kettle is 9 ratings, on B it is a guaranteed ' +
          'instantaneous trip, while on C it is the lower edge of the magnetic zone, ' +
          'i.e. seconds of overload are possible, during which the UPS goes into protection ' +
          'and takes the boiler down with it.'
      });

      if (upsSockets.length > 1 || plainSockets.length) {
        out.push({
          id: 'ups-socket-count',
          severity: 'error',
          layer: 'electrical',
          title: `${upsSockets.length + plainSockets.length} sockets on the emergency line instead of one`,
          detail:
            'The socket is the only element of the line whose content is unknown ' +
            'in advance. Each further one multiplies the chance that during an outage ' +
            'something will be plugged in that brings down the inverter together with the boiler.',
          fix: 'Keep one emergency socket, marked with colour and a label.'
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
          title: 'The luminaire on the UPS is not class II',
          detail:
            'An ordinary luminaire with an earthed body can produce an earth ' +
            'leakage, and its RCD is shared with the boiler. Class II removes this path: ' +
            'there are simply no earthed parts.',
          fix: 'Replace with a class II luminaire (the “square in a square” mark).'
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
          `Low-voltage — ${lvPlan.utpM.toFixed(0)} m of twisted pair for ${lvPlan.utpLinks} links ` +
          `and ${lvPlan.conduitM.toFixed(0)} m of conduit, ALONG THE FLOOR SLAB, not in the screed`,
        detail:
          'Power cable goes into the floor because it will outlive the house. With low-voltage ' +
          'it is the opposite: over the life of a screed two generations of standards will change, ' +
          'and embedding twisted pair in concrete means burying it for good. ' +
          'The slab is open right now — this is access to the whole floor at once, ' +
          'and it will open a second time only with a new demolition. ' +
          lvPlan.routes
            .map((r) => `${r.name} — ${r.cableM.toFixed(1)} m`)
            .join('; ') + '.',
        fix:
          'Conduit Ø20 with a pull cord on EVERY route — unlike lighting, ' +
          'which is run openly: lighting will not be changed, low-voltage will. ' +
          'ONLY copper cable: copper-clad aluminium does not carry PoE ' +
          'and breaks at a bend in the terminal. Both pairs to the TV go in one conduit.'
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
              ? `The router is ${gapMm.toFixed(0)} mm from the gas inlet — the ${LV.gasClearanceMm} clearance is met`
              : `The router is ${gapMm.toFixed(0)} mm from the gas inlet: closer than ${LV.gasClearanceMm} is not allowed`,
            detail:
              'The fibre enters the house IN THE SAME PIER as the gas pipe, ' +
              'in the 700 mm gap between the fixed window and the boiler. The fibre itself ' +
              'is not a conductor and is not subject to the proximity rule, but the router ' +
              'power socket is: electrics run parallel to a gas pipe ' +
              `no closer than ${LV.gasClearanceMm} mm.`,
            fix: ok
              ? 'The router is pushed to the top edge of the pier, by the window. Do not move it down, towards the boiler.'
              : 'Move the router towards the window, to the top of the pier, or take the socket out into the living room.'
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
        title: `Sub-floor ${lv.crawlMeasuredToBoards ?? lv.crawlDepth} mm is an AVERAGE, while the ${pie} mm build-up must fit at the shallowest point`,
        detail:
          `From the sand to the top of the boards ≈${available} mm, build-up ${pie} mm — on average it works ` +
          `with a margin of ${available - pie} mm. But the sand is uneven, and where it is above average ` +
          'there will be no margin. The floor level is set by the HIGHEST point of the ground, ' +
          'not the average: otherwise in one corner the build-up will not fit, and you will have to ' +
          'either cut the insulation or raise the whole floor.',
        fix:
          'Survey the sub-floor profile on a 1 × 1 m grid from a common datum — 36 points per floor. ' +
          'Cut the high spots down to the low ones, do not add fill on top of everything.'
      });

      out.push({
        id: 'crawl-compaction',
        severity: 'error',
        layer: 'architecture',
        title: 'The sand in the sub-floor is not compacted — the screed will lie on a loose base',
        detail:
          'There is almost no extra fill, so the screed will sit directly on the existing sand. ' +
          'Loose sand under load settles by 5–10 % of its thickness. Settlement ' +
          'under a screed with an embedded pipe is a crack that cannot be fixed.',
        fix:
          'Sand compacts well, but only when wet and with vibration: water it ' +
          `and go over it with a plate compactor in several passes in layers of up to ${lv.compactLayer} mm. ` +
          'A simple check: compacted sand does not keep a heel print. ' +
          'Compact the crushed stone on top separately — it also works as a distribution layer.'
      });
    }

    // --- Срок службы состава ---
    const age = coolantAge(project.coolant);
    if (age?.expired) {
      out.push({
        id: 'coolant-expired',
        severity: 'error',
        layer: 'heating',
        title: `The fluid is ${age.years.toFixed(0)} years old with a service life of ${age.shelfLifeYears}`,
        detail:
          `“${project.coolant.brand}” was manufactured ${project.coolant.manufactured}, the declared ` +
          `warranty service life is ${age.shelfLifeYears} years — expired by ` +
          `${age.overdueYears.toFixed(0)}. The corrosion inhibitors are used up. Without them ` +
          'ethylene glycol decomposes on overheating into glycolic and oxalic acids: ' +
          'the pH falls and corrosion begins. The boiler data sheet requires pH 6.5…8.5, and damage ' +
          'from scale and corrosion is excluded from the warranty.',
        fix:
          'Replace it when filling the underfloor heating — you are opening the system anyway, and this ' +
          'is the only moment when replacement costs nothing beyond the fluid itself. ' +
          'Flush, fill with fresh. It also settles the question of the unknown concentration.'
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
        title: 'A concentrate was filled — the actual concentration is not known',
        detail:
          `The label has a dilution table by volume: ${t}. What it was diluted with ` +
          'at filling is not recorded, so the thermophysics is taken for ~50 %. ' +
          'Flow, pressure drop and freezing point depend on the concentration.',
        fix:
          'Measure with a hydrometer (refractometer) before filling the heating. If you are replacing ' +
          'the fluid anyway — just dilute it by the table for the protection you need.'
      });
    }

    // --- Гарантия котла против антифриза ---
    const boiler = project.boiler;
    if (boiler?.antifreezeVoidsExchangerWarranty && project.coolant?.base !== 'water') {
      out.push({
        id: 'boiler-warranty-antifreeze',
        severity: 'warn',
        layer: 'heating',
        title: 'Antifreeze voids the boiler heat exchanger warranty',
        detail:
          `Data sheet ${boiler.model}, section “General safety measures”: when running on antifreeze ` +
          'defects of the primary heat exchanger — noise, vibration, failure — ' +
          `are NOT covered by the manufacturer warranty. The boiler was made ${boiler.made}, ` +
          `the warranty is ${boiler.warrantyMonths} months from commissioning, i.e. still alive. ` +
          'This is the price of the decision to keep the antifreeze, not an argument against it: ' +
          'the underfloor heating pipe is embedded in the screed, and its rupture is irreversible.',
        fix:
          'The decision is deliberate — record it. To lower the risk: hold the concentration ' +
          'per the label, replace the fluid when the inhibitors are used up, do not overheat ' +
          `(mode ${boiler.lowTempParam.code}=${boiler.lowTempParam.value} holds ${boiler.lowTempParam.cap} °C).`
      });
    }

    // --- Встроенные средства котла, которые надо просто включить ---
    if (boiler?.lowTempParam) {
      out.push({
        id: 'boiler-lowtemp-param',
        severity: 'info',
        layer: 'heating',
        title: `${boiler.lowTempParam.code}=${boiler.lowTempParam.value}: the boiler already has a low-temperature mode`,
        detail:
          `The parameter limits the heating circuit to ${boiler.lowTempParam.cap} °C with a burner cut-off ` +
          `at ${boiler.lowTempParam.cutoff} °C. This is a standard screed protection built into the boiler. ` +
          `Plus ${boiler.antiCycleParam.code}: ignition delay ${boiler.antiCycleParam.factory} minutes — ` +
          'a factory anti-short-cycling protection, already on.',
        fix:
          `Set ${boiler.lowTempParam.code}=${boiler.lowTempParam.value}. Keep the strap-on emergency thermostat ` +
          'as an independent backup: a board parameter protects only while the board is healthy.'
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
        title: `Antifreeze: flow +${((c.flowFactor - 1) * 100).toFixed(0)} %, pressure drop ×${c.pressureDropFactor}`,
        detail:
          `Heat capacity ${c.c} against 4.18 kJ/(kg·K) for water, higher viscosity. ` +
          `The same heat output needs a larger flow, and the pressure drop grows — ` +
          `the maximum heating loop length falls from 90 to ${maxLoopLength(c).toFixed(0)} m, ` +
          'and a stronger pump is needed. Per the data sheet the boiler also loses about 10 % of its heat output.',
        fix: 'Calculate the loops and select the pump for antifreeze, not for water.'
      });

      out.push({
        id: 'coolant-scope',
        severity: 'info',
        layer: 'plumbing',
        title: `Without heating the house will cool to 0 °C in about ${cool.hours.toFixed(0)} h`,
        detail:
          `At an outdoor ${project.climate.tOutDesign} °C and a screed mass of ` +
          `${bc.screedMass.massKg.toFixed(0)} kg the time constant of the house is ` +
          `${cool.tauHours.toFixed(0)} h. Antifreeze is justified for outages LONGER than this. ` +
          'But it protects only the heating circuit: the water supply, traps, toilet and ' +
          'the secondary DHW heat exchanger stay on water and will freeze sooner.',
        fix: `The boiler draws ${project.boiler.electric} W — a UPS with a battery removes the cause, not the consequence.`
      });

      if (c.base === 'ethylene') {
        out.push({
          id: 'coolant-ethylene',
          severity: 'error',
          layer: 'plumbing',
          title: 'Ethylene glycol in a system with a DHW circuit',
          detail: 'It is toxic, and the secondary heat exchanger separates it from drinking water by a single wall.',
          fix: 'In domestic systems with DHW only propylene glycol is used.'
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
          title: `The house stands empty at ${c.minHoldTemp} °C — ${cold.hours.toFixed(0)} h to zero, not ${cool.hours.toFixed(0)}`,
          detail:
            'It has to cool not from a comfortable temperature but from the holding temperature, ' +
            'and nobody is around to notice the outage. The margin shrinks several times over. ' +
            'The heating pipe is embedded in the screed: a rupture there cannot be fixed without breaking the concrete. ' +
            'In this mode of use antifreeze in the underfloor heating is justified.',
          fix:
            `Keep the antifreeze and add a UPS: the bank “${bank.label}” gives ${bank.hours.toFixed(0)} h — ` +
            `it covers the ${cold.hours.toFixed(0)}-hour window. Calculate the loops for antifreeze, limit ` +
            `${maxLoopLength(c).toFixed(0)} m.`
        });
      } else if (c.originalReasonResolved) {
        const ups = upsSizing({ boilerW: project.boiler.electric, targetHours: cool.hours });
        out.push({
          id: 'coolant-reconsider',
          severity: 'info',
          layer: 'heating',
          title: 'The reason antifreeze was filled has been eliminated',
          detail:
            `${c.originalReason}. Mains water is now connected — the pressure holds, ` +
            'and the boiler starts by itself after the power returns.',
          fix:
            `A UPS with a ${ups.options.find((o) => o.id === 'agm100x2').hours.toFixed(0)} h bank ` +
            'covers typical outages. Calculate the loops for antifreeze — then any coolant will do.'
        });
      }

      if (!c.confirmed) {
        out.push({
          id: 'coolant-unconfirmed',
          severity: 'warn',
          layer: 'heating',
          title: 'The brand and concentration of the antifreeze are not confirmed',
          detail:
            `The calculation uses typical properties of “${c.label}” with protection down to ${c.freezePoint} °C. ` +
            `Corrosion inhibitors are used up in about ${c.inhibitorYears} years, after which ` +
            'the fluid is replaced. Glycols are incompatible with galvanised pipes and fittings.',
          fix: 'Look at the label of the filled fluid and the boiler data sheet: manufacturers restrict the use of antifreeze, and the boiler is new and under warranty.'
        });
      }
    }

    if (!project.climate.confirmed) {
      out.push({
        id: 'climate-unconfirmed',
        severity: 'info',
        layer: 'heating',
        title: 'Climate parameters not checked against the code',
        detail: `The calculation uses ${project.climate.tOutDesign} °C (${project.climate.station}).`
      });
    }

    if (!project.envelope.wall.confirmed) {
      out.push({
        id: 'wall-unconfirmed',
        severity: 'warn',
        layer: 'heating',
        title: 'Aerated concrete thickness and grade not measured',
        detail:
          `The calculation uses ${project.envelope.wall.thickness} mm and λ = ${project.envelope.wall.lambda}. ` +
          `This gives R = ${hl.rWall.toFixed(2)} m²·K/W for the wall. The difference between D400 and D600 is ` +
          'almost twofold, and the whole load depends on it.',
        fix: 'Measure the thickness at the window reveal, find the grade in the documents or on the blocks.'
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
      title: 'Not enough concrete over the heating pipe',
      detail: `A ${screed.screedTotal} mm screed with a pipe Ø${screed.pipeOd} gives ${coverAvailable} mm over the pipe, minimum ${screed.pipeCoverMin} mm.`,
      fix: 'Increase the screed or reduce the pipe diameter.'
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
        title: 'Access to the manifold is blocked',
        detail: `“${spec?.name}” stands in the manifold service zone (700 mm in front).`,
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
      title: `${unconfirmed} reference points not confirmed by measurement`,
      detail:
        'Nodes and openings stand on rough coordinates. Before the screed pour every reference ' +
        'must be replaced with an actual measurement — otherwise all the checks work on invented geometry.',
      fix: 'Enter the measurements with the mouse or in src/data/project.js.'
    });
  }

  return sortBySeverity(out);
}
