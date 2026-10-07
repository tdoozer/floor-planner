// Теплопотери по помещениям первого этажа.
//
//   Q = Σ(A · U · Δt) + 0,34 · V · n · Δt
//
// Чистые функции. Все исходные данные приходят параметрами и редактируются
// в интерфейсе — здесь нет ни одной зашитой климатической величины.

import { INNER_D, INNER_W, buildRooms } from '../data/project.js';
import { groundLoss, polygonArea } from './geometry.js';

const EPS = 1e-6;

// Сопротивление теплопередаче стены, м²·К/Вт
export function wallR(envelope) {
  const rBlock = envelope.wall.thickness / 1000 / envelope.wall.lambda;
  const rIns = envelope.wallInsulation.thickness / 1000 / envelope.wallInsulation.lambda;
  // 0,158 — сумма сопротивлений тепловосприятия и теплоотдачи
  return rBlock + rIns + envelope.wallFinish + 0.158;
}

// Длина наружных стен, приходящихся на помещение.
// Ребро полигона считается наружным, если лежит на габарите коробки.
export function externalWallLength(polygon) {
  let len = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];

    const onLeft = Math.abs(a.x) < EPS && Math.abs(b.x) < EPS;
    const onRight = Math.abs(a.x - INNER_W) < EPS && Math.abs(b.x - INNER_W) < EPS;
    const onTop = Math.abs(a.y) < EPS && Math.abs(b.y) < EPS;
    const onBottom = Math.abs(a.y - INNER_D) < EPS && Math.abs(b.y - INNER_D) < EPS;

    if (onLeft || onRight) len += Math.abs(b.y - a.y);
    else if (onTop || onBottom) len += Math.abs(b.x - a.x);
  }
  return len;
}

function roomTargetTemp(room, climate) {
  if (room.id === 'bath') return climate.tInBath;
  if (room.id === 'hall') return climate.tInHall;
  return climate.tInLiving;
}

// Теплопотери одного помещения, Вт
export function roomHeatLoss({ room, openings, climate, envelope, screed, clearHeight }) {
  const tIn = roomTargetTemp(room, climate);
  const dt = tIn - climate.tOutDesign;
  const area = polygonArea(room.polygon);
  const volume = area * clearHeight;

  const mine = openings.filter((o) => o.room === room.id);
  const windowArea = mine.filter((o) => o.kind === 'window').reduce((s, o) => s + o.len * o.h, 0);
  const doorArea = mine.filter((o) => o.kind === 'door' && o.entry).reduce((s, o) => s + o.len * o.h, 0);

  const wallGross = externalWallLength(room.polygon) * clearHeight;
  const wallNet = Math.max(0, wallGross - windowArea - doorArea);

  const uWall = 1 / wallR(envelope);
  const qWall = wallNet * uWall * dt;
  const qWindow = windowArea * envelope.window.u * dt;
  const qDoor = doorArea * envelope.door.u * dt;

  // Пол по грунту: перепад до грунта, а не до наружного воздуха.
  // Периметр здесь не учитывается — его закрывает торцевой утеплитель.
  const rFloor = groundLoss(screed, area).rTotal;
  const qGround = (area / rFloor) * (tIn - climate.tGround);

  const qVent = 0.34 * volume * envelope.ventilationAch * dt;

  const total = qWall + qWindow + qDoor + qGround + qVent;

  return {
    id: room.id,
    name: room.name,
    area,
    volume,
    tIn,
    dt,
    wallNet,
    windowArea,
    doorArea,
    uWall,
    qWall,
    qWindow,
    qDoor,
    qGround,
    qVent,
    total,
    // Удельные потери — удобно сравнивать со съёмом с пола
    perM2: total / area
  };
}

export function heatLoss({ layout, openings, climate, envelope, screed, clearHeight }) {
  const rooms = buildRooms(layout);
  const byRoom = rooms.map((room) =>
    roomHeatLoss({ room, openings, climate, envelope, screed, clearHeight })
  );
  const total = byRoom.reduce((s, r) => s + r.total, 0);
  const area = byRoom.reduce((s, r) => s + r.area, 0);

  return {
    byRoom,
    total,
    totalKw: total / 1000,
    area,
    perM2: total / area,
    rWall: wallR(envelope),
    uWall: 1 / wallR(envelope)
  };
}
