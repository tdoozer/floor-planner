// Промпт для фотореалистичного рендера — СОБИРАЕТСЯ ИЗ РАССТАНОВКИ.
//
// Смысл именно в этом. Просить у модели «уютную кухню-гостиную» умеет кто
// угодно, и получится чужая комната. Здесь описание строится из того, что
// реально стоит на плане: из выбранной точки съёмки берутся видимые предметы,
// сортируются по дальности и складываются во фразу. Двинули диван —
// промпт поменялся сам.
//
// Модуль ЧИСТЫЙ и покрыт тестами: это текст, а не картинка, и его можно
// проверить, не обращаясь ни к какому сервису.

import { INNER_D, INNER_W } from '../data/project.js';
import { boundingBox, getFixture } from '../data/fixtures.js';

// Точки съёмки. Глаз на 1,55 — рост стоящего человека, а не «вид сверху»:
// комната 5,5 × 5,5 с потолком 2,35 при взгляде сверху выглядит ангаром.
export const EYE_HEIGHT = 1.55;

export const VIEWPOINTS = [
  {
    id: 'from-hall',
    name: 'From the hall door',
    hint: 'the first thing a visitor sees',
    eye: { x: 2.15, y: 3.9 },
    look: { x: 2.6, y: 0.5 },
    en: 'standing in the doorway looking across the room towards the kitchen run along the far wall'
  },
  {
    id: 'from-sofa',
    name: 'From the sofa',
    hint: 'checking the view of the TV and the kitchen',
    eye: { x: 2.7, y: 4.2 },
    look: { x: 3.7, y: 1.6 },
    en: 'seated-height view from the sofa towards the wall-mounted TV and the kitchen beyond'
  },
  {
    id: 'from-dining',
    name: 'From the dining table',
    hint: 'the full width of the kitchen front',
    eye: { x: 1.3, y: 2.1 },
    look: { x: 2.0, y: 0.1 },
    en: 'close view of the kitchen run head-on, window above the hob'
  },
  {
    id: 'from-kitchen',
    name: 'From the kitchen corner into the room',
    hint: 'view of the living room and the stair',
    eye: { x: 3.3, y: 1.5 },
    look: { x: 1.4, y: 4.6 },
    en: 'from the kitchen corner looking back into the living area, a straight steel staircase boxed in along the right wall'
  }
];

// Сколько предметов называть. Перечислять всё, что попало в кадр, вредно:
// шестнадцать существительных превращают промпт в список покупок,
// и модель начинает расставлять мебель по кругу.
export const MAX_NAMED = 7;

export const STYLES = [
  {
    id: 'warm-minimal',
    name: 'Warm minimalism',
    text: 'warm minimalist interior, off-white walls, natural oak accents, muted palette'
  },
  {
    id: 'scandi',
    name: 'Scandi',
    text: 'scandinavian interior, white walls, pale wood, linen textiles, uncluttered'
  },
  {
    id: 'industrial',
    name: 'Loft',
    text: 'soft industrial interior, raw concrete and blackened steel, warm wood, matte black fittings'
  },
  {
    id: 'country',
    name: 'Country',
    text: 'modern country house interior, painted timber ceiling, natural textures, cosy'
  }
];

// Английские описания приборов: модели куда лучше понимают предметы
// по-английски, а UI при этом остаётся русским
const RENDER_NAMES = {
  fridge: 'a tall free-standing fridge',
  oven: 'a built-in oven under the counter',
  hob_gas: 'a gas hob set into the countertop under the window',
  sink_corner: 'a large corner sink set diagonally into the countertop',
  dishwasher60: 'an integrated dishwasher',
  worktop: 'base cabinets',
  wall_cabinet: 'wall cabinets',
  wall_cabinet_corner: 'a corner wall cabinet',
  dining_table: 'a wooden dining table',
  bench: 'wooden benches along the table',
  shelf_open: 'an open shelving unit in the corner',
  sofa: 'a fabric sofa',
  tv_wall: 'a wall-mounted TV on a swivel bracket',
  washer: 'a washing machine',
  light: 'flush ceiling lights with diffusers',
  light_work: 'adjustable spotlights aimed at the worktop',
  light_pendant: 'a pendant lamp low over the dining table'
};

// Отделка — из принятых решений, а не из вкусов генератора
export const FINISHES = [
  'walls in smooth gypsum plaster, painted matte',
  'large-format porcelain stoneware floor tiles',
  'exposed timber ceiling beams, painted light',
  'a cast concrete kitchen countertop on a slim steel frame'
];

function angleBetween(ax, ay, bx, by) {
  const dot = ax * bx + ay * by;
  const na = Math.hypot(ax, ay);
  const nb = Math.hypot(bx, by);
  if (na < 1e-9 || nb < 1e-9) return Math.PI;
  return Math.acos(Math.min(1, Math.max(-1, dot / (na * nb))));
}

// Что попадает в кадр из данной точки. Угол обзора 70° — это примерно
// объектив 28 мм, обычный для интерьерной съёмки.
export function visibleItems({ eye, look, equipment = [], fovDeg = 70, maxDist = 9 }) {
  const vx = look.x - eye.x;
  const vy = look.y - eye.y;
  const half = ((fovDeg / 2) * Math.PI) / 180;

  return equipment
    .map((item) => {
      const spec = getFixture(item.catalogId);
      if (!spec || spec.category === 'electrical') return null;
      const bb = boundingBox(item);
      const dx = bb.cx - eye.x;
      const dy = bb.cy - eye.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 0.05 || dist > maxDist) return null;
      const ang = angleBetween(vx, vy, dx, dy);
      // Крупный предмет виден и слегка за краем кадра — учитываем его габарит
      const halfWidth = Math.atan2(Math.max(bb.w, bb.d) / 2, dist);
      if (ang - halfWidth > half) return null;
      return { id: item.id, catalogId: item.catalogId, name: spec.name, dist, ang };
    })
    .filter(Boolean)
    .sort((a, b) => a.dist - b.dist);
}

// Свет описываем отдельно: он задаёт настроение кадра сильнее мебели
function lightingPhrase(equipment) {
  const kinds = new Set(
    equipment
      .map((e) => getFixture(e.catalogId)?.id)
      .filter((id) => id && id.startsWith('light'))
  );
  const parts = [...kinds].map((k) => RENDER_NAMES[k]).filter(Boolean);
  return parts.length ? parts.join(', ') : 'simple ceiling lighting';
}

export function buildRenderPrompt({
  project,
  viewpointId = VIEWPOINTS[0].id,
  styleId = STYLES[0].id,
  clearHeight = 2.35,
  daylight = true
}) {
  const vp = VIEWPOINTS.find((v) => v.id === viewpointId) ?? VIEWPOINTS[0];
  const style = STYLES.find((s) => s.id === styleId) ?? STYLES[0];

  const seen = visibleItems({ eye: vp.eye, look: vp.look, equipment: project.equipment });

  // Одинаковые предметы схлопываем: «benches, benches, benches» модель
  // понимает как три разных дивана
  const named = [];
  const used = new Set();
  seen.forEach((s) => {
    const phrase = RENDER_NAMES[s.catalogId];
    if (!phrase || used.has(phrase)) return;
    used.add(phrase);
    named.push(phrase);
  });

  const windows = project.openings.filter((o) => o.kind === 'window' && !o.blind).length;

  const parts = [
    'interior photograph of an open-plan kitchen and living room',
    `in a small country house, ${INNER_W.toFixed(1)} by ${INNER_D.toFixed(1)} metres, ` +
      `ceiling ${clearHeight.toFixed(2)} metres`,
    `camera at eye level ${EYE_HEIGHT} m, ${vp.en}`,
    named.length ? `in view: ${named.slice(0, MAX_NAMED).join(', ')}` : null,
    lightingPhrase(project.equipment),
    FINISHES.join(', '),
    `${windows} windows,` +
      (daylight
        ? ' soft overcast daylight from the side, no direct sun'
        : ' evening, warm artificial light only'),
    style.text,
    'wide angle 28mm, natural perspective, straight verticals, realistic proportions',
    'architectural photography, high detail, no people, no text, no watermark'
  ].filter(Boolean);

  return {
    viewpoint: vp,
    style,
    visible: seen,
    named: named.slice(0, MAX_NAMED),
    text: parts.join('. ')
  };
}

// Адрес картинки. Тот же путь в dev и prod: в проде его отдаёт nginx,
// в dev — прокси Vite. Ветвлений по окружению в коде нет.
export function renderUrl(prompt, { seed = 1, width = 1024, height = 768 } = {}) {
  const q = new URLSearchParams({
    width: String(width),
    height: String(height),
    nologo: 'true',
    seed: String(seed)
  });
  return `/prompt/${encodeURIComponent(prompt)}?${q.toString()}`;
}
