// Щиток аварийного питания — то, что стоит ПОСЛЕ ИБП.
//
// Исходно линия котла была выделенной по одной причине: чужое УЗО не имеет
// права гасить отопление. Как только на неё просятся свет и розетка,
// это возражение возвращается — и его надо снять инженерно, а не обещанием
// «мы туда ничего не воткнём».
//
// Снимается оно расщеплением выхода ИБП на ветки, у каждой свой аппарат:
//   КЗ или перегруз в ветке   → срабатывает ЕЁ автомат, котёл не замечает;
//   утечка у светильников     → невозможна, если светильники класса II
//                               (двойная изоляция, заземляемых частей нет);
//   утечка у розетки          → ловится ЕЁ дифавтоматом на 10 мА,
//                               а не общим на 30 в главном щите.
//
// Есть и практическая причина: у Штиль SW500L на выходе ОДНА розетка Schuko.
// Даже котёл с роутером в неё вдвоём не входят, так что расщепление нужно
// в любом случае.

// Номиналы модульных автоматов, которые реально продаются
export const MCB_RATINGS = [1, 2, 4, 6, 10, 16];

// Характеристика автомата. Для аварийной розетки она важнее номинала.
//
// B срабатывает магнитно (мгновенно) уже при 3…5 номиналов, C — только
// с 5…10. Чайник на 2 кВт берёт 9 А: на B1 это 9 номиналов, то есть
// мгновенный расцеп за доли секунды — инвертор такой всплеск переживает.
// На C1 те же 9 А попадают в НИЖНИЙ край магнитной зоны, срабатывание
// не гарантировано, и автомат может уйти в тепловую зону на секунды.
// Секунды перегруза вдвое — это уже защита инвертора, а с ним встанет котёл.
//
// Поэтому на аварийной розетке ставится B, и это не вкусовщина.
export const MCB_CURVES = {
  B: { id: 'B', magneticFrom: 3, magneticTo: 5 },
  C: { id: 'C', magneticFrom: 5, magneticTo: 10 }
};

// Сработает ли автомат МГНОВЕННО на такой нагрузке. Гарантия есть только
// когда ток выше верхней границы магнитной зоны: ниже неё расцеп
// зависит от экземпляра.
export function tripsInstantly({ loadW, rating, curve = MCB_CURVES.B, voltage = 220 }) {
  const loadA = loadW / voltage;
  const ratio = loadA / rating;
  return {
    loadA,
    ratio,
    guaranteed: ratio >= curve.magneticTo,
    possible: ratio >= curve.magneticFrom
  };
}

export const PANEL = {
  modules: 8, // DIN-бокс на 8 модулей: вход, четыре ветки и два в запас
  voltage: 220,
  // Дифавтомат на розетке — 10 мА, а не 30: ближе к нагрузке и чувствительнее
  // общего, поэтому при утечке срабатывает первым.
  socketRcdMa: 10,
  cable: '3×1,5'
};

// Ветки щитка. Порядок — по важности: котёл первым, чтобы при ревизии
// щитка было видно, что гасить нельзя.
export const BRANCHES = [
  {
    id: 'boiler', label: 'Котёл', watts: 110, breaker: 6, rcd: false,
    why: 'Ради него всё и построено. Автомат свой, чтобы авария в любой ' +
      'другой ветке до котла не дошла.'
  },
  {
    id: 'router', label: 'Роутер', watts: 15, breaker: 6, rcd: false,
    why: 'Без интернета в отключение не видно ни котла, ни дома.'
  },
  {
    id: 'light', label: 'Свет котельной', watts: 10, breaker: 6, rcd: false,
    classII: true,
    why: 'Котёл надо ВИДЕТЬ, чтобы им заняться. Светильник класса II: ' +
      'заземляемых частей нет, значит утечка на землю физически невозможна ' +
      'и общее УЗО он не потревожит.'
  },
  {
    id: 'socket', label: 'Аварийная розетка', watts: null, breaker: null,
    rcd: true, rcdMa: PANEL.socketRcdMa, sized: true, curve: 'B',
    why: 'Единственная ветка, содержимое которой заранее неизвестно. ' +
      'Поэтому у неё и свой дифавтомат, и номинал по остатку инвертора, ' +
      'и характеристика B: она отсекает чайник мгновенно, а не через секунды.'
  }
];

// Номинал автомата аварийной розетки считается НЕ по кабелю, а по инвертору.
//
// Кабель 3×1,5 держит 16 А и в защите на 1 А не нуждается. Защищать надо
// ИБП: 400 Вт минус постоянные потребители — вот и весь остаток. Автомат
// на 6 А (1320 Вт) бесполезен, инвертор уйдёт в защиту задолго до него,
// и вместе с инвертором встанет котёл. Автомат номиналом по остатку
// превращает правило «не включать чайник» из наклейки в физику.
export function socketBreaker({ inverterW, baseW, voltage = PANEL.voltage, ratings = MCB_RATINGS }) {
  const spareW = inverterW - baseW;
  const spareA = spareW / voltage;
  const rating = [...ratings].reverse().find((r) => r <= spareA) ?? null;
  return {
    spareW,
    spareA,
    rating,
    // Сколько ветка сможет взять при выбранном автомате
    allowedW: rating ? rating * voltage : 0,
    peakW: baseW + (rating ? rating * voltage : 0),
    fits: rating !== null && baseW + rating * voltage <= inverterW
  };
}

export function emergencyPanel({ inverterW, branches = BRANCHES, panel = PANEL }) {
  const fixed = branches.filter((b) => !b.sized);
  const baseW = fixed.reduce((s, b) => s + b.watts, 0);
  const socket = socketBreaker({ inverterW, baseW, voltage: panel.voltage });

  const rows = branches.map((b) =>
    b.sized
      ? { ...b, watts: socket.allowedW, breaker: socket.rating, sizedFrom: socket }
      : { ...b }
  );

  // Что будет, если в аварийную розетку всё же воткнут чайник
  const kettle = socket.rating
    ? tripsInstantly({ loadW: 2000, rating: socket.rating, curve: MCB_CURVES.B, voltage: panel.voltage })
    : null;

  return {
    baseW,
    inverterW,
    socket,
    kettle,
    branches: rows,
    // Модулей: по одному на автомат, два на дифавтомат, плюс вводной
    modulesUsed: rows.reduce((n, b) => n + (b.rcd ? 2 : 1), 0) + 1,
    modulesFree: panel.modules - (rows.reduce((n, b) => n + (b.rcd ? 2 : 1), 0) + 1),
    panel
  };
}

// Во что обходится каждый добавленный ватт. Считается от того же банка,
// что и автономия котла: ампер-часы одни на всех.
export function autonomyCost({ usableWh, idleW, loads }) {
  let running = idleW;
  return loads.map((l) => {
    running += l.watts;
    return { ...l, drawW: running, hours: usableWh / running };
  });
}
