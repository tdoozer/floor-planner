// Запотевание и обмерзание окон.
//
// Вопрос «будет ли индеветь окно, если под ним нет тёплого пола» решается
// не количеством тепла, а ТЕМПЕРАТУРОЙ ВНУТРЕННЕГО СТЕКЛА против точки росы
// воздуха в комнате. Конденсат выпадает, когда стекло холоднее точки росы.
//
// Тёплый пол под окном на это влияет косвенно: он поднимает температуру
// воздуха у стекла и разбивает холодный нисходящий поток. Но если стекло
// само по себе тёплое, ничего этого не требуется.

// Сопротивление тепловосприятию внутренней поверхности остекления, м²·К/Вт
export const R_SI_GLASS = 0.13;

// Температура внутренней поверхности стекла
export function glassTemp({ uWindow, tIn, tOut }) {
  return tIn - uWindow * (tIn - tOut) * R_SI_GLASS;
}

// Точка росы по формуле Магнуса
export function dewPoint(tAir, rhPercent) {
  const a = 17.27;
  const b = 237.7;
  const rh = Math.min(100, Math.max(1, rhPercent)) / 100;
  const gamma = (a * tAir) / (b + tAir) + Math.log(rh);
  return (b * gamma) / (a - gamma);
}

// Относительная влажность, при которой на стекле начинается конденсат
export function criticalHumidity({ uWindow, tIn, tOut }) {
  const tGlass = glassTemp({ uWindow, tIn, tOut });
  const a = 17.27;
  const b = 237.7;
  const es = Math.exp((a * tIn) / (b + tIn));
  const eg = Math.exp((a * tGlass) / (b + tGlass));
  return Math.min(100, (eg / es) * 100);
}

// Проверка одного окна
export function windowCheck({ opening, uWindow, tIn, tOut, rh }) {
  const tGlass = glassTemp({ uWindow, tIn, tOut });
  const dp = dewPoint(tIn, rh);
  const critical = criticalHumidity({ uWindow, tIn, tOut });

  return {
    id: opening.id,
    room: opening.room,
    tGlass,
    dewPoint: dp,
    criticalRh: critical,
    margin: tGlass - dp,
    // Конденсат при заданной влажности
    condenses: tGlass < dp,
    // Иней: стекло ниже нуля
    frost: tGlass < 0
  };
}

export function windowsCheck({ openings, envelope, climate, rh = 50, roomTemp }) {
  return openings
    .filter((o) => o.kind === 'window')
    .map((o) => {
      const tIn = roomTemp?.[o.room] ?? climate.tInLiving;
      return {
        ...windowCheck({ opening: o, uWindow: envelope.window.u, tIn, tOut: climate.tOutDesign, rh }),
        tIn,
        blind: !!o.blind
      };
    });
}

// ---------- Подрозетник, утопленный в наружную стену ----------
//
// Вопрос практический: газобетон 300 мм, коронка 68 мм на глубину 45 —
// не выпадет ли за розеткой конденсат? Локально стена в этом месте тоньше,
// значит внутренняя поверхность холоднее.
//
// Считаем послойно. Утопленный подрозетник съедает и штукатурку, и часть
// блока; воздух внутри коробки и её пластик в запас не берём — так честнее.
export const R_SI_WALL = 0.115; // heat transfer resistance of the inner wall surface
export const R_SE_WALL = 0.043; // of the outer one

export function wallLayersR(envelope, { recessMm = 0 } = {}) {
  const w = envelope.wall;
  const ins = envelope.wallInsulation;
  const blockMm = Math.max(0, w.thickness - recessMm);

  const rBlock = blockMm / 1000 / w.lambda;
  const rIns = ins && ins.thickness > 0 ? ins.thickness / 1000 / ins.lambda : 0;
  // Штукатурку подрозетник срезает вместе с блоком
  const rFinish = recessMm > 0 ? 0 : (envelope.wallFinish ?? 0);

  return {
    blockMm,
    rBlock,
    rIns,
    rFinish,
    total: R_SI_WALL + rFinish + rBlock + rIns + R_SE_WALL
  };
}

// Температура внутренней поверхности стены в конкретном сечении
export function wallSurfaceTemp({ envelope, tIn, tOut, recessMm = 0 }) {
  const r = wallLayersR(envelope, { recessMm });
  return tIn - (tIn - tOut) * (R_SI_WALL / r.total);
}

// Проверка утопленного подрозетника против точки росы.
// Возвращает и «чистое» сечение стены, чтобы было видно, сколько именно
// градусов стоит сам факт утапливания.
export function backBoxCheck({ envelope, tIn, tOut, rh = 55, recessMm = 45 }) {
  const solid = wallSurfaceTemp({ envelope, tIn, tOut });
  const atBox = wallSurfaceTemp({ envelope, tIn, tOut, recessMm });
  const dp = dewPoint(tIn, rh);
  const r = wallLayersR(envelope, { recessMm });

  return {
    recessMm,
    remainingMm: r.blockMm,
    tSolid: solid,
    tAtBox: atBox,
    penalty: solid - atBox, // how many degrees recessing costs
    dewPoint: dp,
    margin: atBox - dp,
    condenses: atBox < dp,
    // Влажность, при которой за розеткой начнётся конденсат
    criticalRh: (() => {
      const a = 17.27;
      const b = 237.7;
      const es = Math.exp((a * tIn) / (b + tIn));
      const eb = Math.exp((a * atBox) / (b + atBox));
      return Math.min(100, (eb / es) * 100);
    })(),
    // Подтверждены ли исходные данные — толщина блока и наружный утеплитель
    assumed: !envelope.wall.confirmed || !(envelope.wallInsulation?.confirmed)
  };
}
