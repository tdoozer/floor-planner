// Слаботочка: интернет, ТВ и то, что стоит заложить на будущее.
//
// ГЛАВНОЕ РЕШЕНИЕ — трасса идёт ПО ПЕРЕКРЫТИЮ, а не в стяжке.
//
// Силовой кабель мы кладём в пол, в слой утеплителя: он служит столько же,
// сколько дом, и менять его не придётся. Со слаботочкой ровно наоборот —
// за время жизни стяжки сменится два поколения стандартов. Замуровать её
// в бетон вместе с трубой тёплого пола значит согласиться, что переделки
// не будет никогда.
//
// Перекрытие сейчас вскрыто: ПВХ снимается, межбалочное пространство пустое.
// Это окно доступа ко всему этажу разом, и второй раз оно откроется только
// с новым демонтажом. Поэтому слаботочка идёт туда и ОБЯЗАТЕЛЬНО в гофре
// с протяжкой — в отличие от света, который ведём открыто.

import { CLEAR_HEIGHT } from '../data/project.js';

export const LV = {
  // Оптика заходит В ОДНОЙ ТОЧКЕ С ГАЗОВОЙ ТРУБОЙ, под потолком,
  // в промежутке 700 мм между глухим окном и котлом.
  entry: { x: 0.12, y: 4.45, height: 2.4, note: 'fibre and gas in the same pier' },
  routerHeight: 2.3,
  // Параллельно газовой трубе электрику ведут не ближе 400 мм.
  // Оптика не проводник и под это не подпадает, а вот питание роутера — да.
  gasClearanceMm: 400,
  cable: 'UTP cat.6 U/UTP 4×2×0,52',
  conduit: 20, // Ø20 conduit: two UTP cables fit in it at once
  waste: 1.15,
  termination: 2.0 // allowance for entering, patch panel and termination at both ends
};

// Ортогональная трасса роутер → точка, поднятая на перекрытие.
// Диагоналей нет: по балкам ведут вдоль и поперёк, а не наискось.
export function lvRoute({ from, to, height = CLEAR_HEIGHT, dropTo, cfg = LV }) {
  const rise = Math.max(0, height - cfg.routerHeight);
  const drop = Math.max(0, height - (dropTo ?? 0.3));
  const alongY = Math.abs(to.y - from.y);
  const alongX = Math.abs(to.x - from.x);
  const run = rise + alongY + alongX + drop;
  return {
    rise,
    alongY,
    alongX,
    drop,
    runM: run,
    cableM: run * cfg.waste + cfg.termination
  };
}

// Что тянем и зачем. Каждая строка — отдельное решение, а не «на всякий случай».
export const LV_LINKS = [
  {
    id: 'tv-box',
    name: 'Router → TV set-top box',
    to: { x: 4.4, y: 2.36 },
    dropTo: 0.8,
    kind: 'utp',
    why: 'The set-top box works over twisted pair and must hang by the TV, ' +
      'not by the router. This is the only link without which the TV will not turn on.'
  },
  {
    id: 'tv-lan',
    name: 'Router → TV (second pair)',
    to: { x: 4.4, y: 2.36 },
    dropTo: 0.8,
    kind: 'utp',
    why: 'The TV on a cable instead of Wi-Fi. Pulled in the same conduit — ' +
      'the second cable here costs only its own price.'
  },
  {
    id: 'mansard-ap',
    name: 'Router → attic, access point',
    to: { x: 2.75, y: 2.75 },
    dropTo: 2.4,
    kind: 'utp',
    why: 'The router stands in the far corner of the ground floor, between it and the bedrooms there is ' +
      'a wooden floor and the future insulation. One access point upstairs ' +
      'settles the question for good, but the cable to it can ONLY be pulled NOW.'
  },
  {
    id: 'entrance',
    name: 'Router → front door',
    to: { x: 4.2, y: 5.42 },
    dropTo: 1.5,
    kind: 'utp',
    why: 'A video doorbell or a camera at the entrance. The house stands empty for long periods in winter — ' +
      'being able to see what is at the door is worth one cable.'
  },
  {
    id: 'reserve-living',
    name: 'Spare: empty conduit to the living room',
    to: { x: 2.02, y: 4.3 },
    dropTo: 0.3,
    kind: 'reserve',
    why: 'An empty conduit with a pull cord to the hall partition. The cheapest thing ' +
      'you can lay: standards change, and you will not want to open the walls.'
  }
];

export function lowVoltagePlan({ router = LV.entry, links = LV_LINKS, cfg = LV } = {}) {
  const routes = links.map((l) => ({
    ...l,
    ...lvRoute({ from: router, to: l.to, dropTo: l.dropTo, cfg })
  }));

  const utpM = routes.filter((r) => r.kind === 'utp').reduce((s, r) => s + r.cableM, 0);
  // Гофра считается по УНИКАЛЬНЫМ трассам: две пары к телевизору идут в одной
  const uniq = new Map();
  routes.forEach((r) => {
    const key = `${r.to.x},${r.to.y}`;
    if (!uniq.has(key) || uniq.get(key).runM < r.runM) uniq.set(key, r);
  });
  const conduitM = [...uniq.values()].reduce((s, r) => s + r.runM * cfg.waste, 0);

  return {
    router,
    routes,
    utpM,
    conduitM,
    utpLinks: routes.filter((r) => r.kind === 'utp').length,
    reserveLinks: routes.filter((r) => r.kind === 'reserve').length,
    cfg
  };
}
