// Щиты: что снаружи, что внутри и почему именно так.
//
// Сейчас всё живёт в ОДНОМ уличном ящике: счётчик, ввод, реле напряжения,
// УЗИП, два групповых аппарата и розетка. Для дома, где групп семь,
// этого мало по трём причинам, и только одна из них про место.
//
// 1. ТЕМПЕРАТУРА. Электронные дифавтоматы работают от −25 °C. Расчётная
//    наружная для объекта −27 °C (СП 131.13330.2020, метеостанция «Липецк»).
//    То есть в мороз защита дома оказывается ЗА пределом своего диапазона —
//    ровно тогда, когда отказ отопления опаснее всего.
// 2. ДОСТУПНОСТЬ. Выбитый автомат посреди января означает выход на улицу
//    к ящику. Групповые аппараты должны быть там, где вы стоите.
// 3. МЕСТО. Семь групп на дифавтоматах — это 15 модулей плюс запас.
//
// Отсюда деление: снаружи остаётся ВВОД И УЧЁТ, внутрь уезжает ВСЯ группировка.

// Что стоит в уличном ящике сейчас — прочитано с фотографии.
export const EXISTING = {
  meter: { model: 'Mercury 203.1', rating: '5(80) A', year: 2012, serial: null,
    // Межповерочный интервал 16 лет: до 2028-го счётчик легитимен.
    // Менять его теперь обязанность сетевой организации, не ваша.
    calibrationYears: 16 },
  input: { device: 'VA47-29', curve: 'C', rating: 32, poles: 2 },
  voltageRelay: { model: 'RMM47', uMin: 165, uMax: 265, autoReset: false },
  spd: { model: 'SPD', class: 2, up: 1.8 },
  groups: [
    { device: 'VA47-29', curve: 'C', rating: 25, rcd: null },
    { device: 'AVDT 32', curve: 'C', rating: 25, rcd: 30 }
  ],
  socket: true
};

export const OUTDOOR_MIN_C = -25; // lower limit of electronic RCBOs
export const DESIGN_OUTDOOR_C = -27; // design outdoor temperature for the site

// Мощности по группам, в двух колонках. Одна цифра тут врёт:
// у чайника и ТЭНа посудомойки пик держится минуты, а не часы, и тепловой
// расцепитель на такие всплески не реагирует вовсе.
//
//   peak      — всё включено разом, единицы минут
//   sustained — средняя за полчаса и дольше, то есть то, что реально греет автомат
export const GROUP_LOADS = {
  light: { peak: 300, sustained: 300 },
  sockets: { peak: 1500, sustained: 300 }, // TV and chargers
  kitchen: { peak: 3000, sustained: 200 }, // the kettle boils for three minutes
  kitchenApp: { peak: 2500, sustained: 1000 }, // dishwasher heater + refrigerator
  appliance: { peak: 3500, sustained: 1500 }, // the oven modulates after warming up
  bath: { peak: 3700, sustained: 1200 }, // the washing machine heats water for about fifteen minutes
  boiler: { peak: 130, sustained: 130 }
};

// Сочетания, которые реально случаются одновременно. Коэффициент
// одновременности по справочнику — усреднение по многим домам;
// для одного дома честнее перебрать конкретные сценарии.
export const SCENARIOS = [
  { id: 'idle', label: 'House empty, holding temperature', groups: ['boiler'] },
  { id: 'evening', label: 'Ordinary evening', groups: ['light', 'sockets', 'kitchenApp', 'boiler'] },
  { id: 'cooking', label: 'Cooking with the dishwasher on', groups: ['light', 'kitchen', 'kitchenApp', 'appliance', 'boiler'] },
  { id: 'worst', label: 'Party: oven, dishwasher, washing machine and kettle',
    groups: ['light', 'kitchen', 'kitchenApp', 'appliance', 'bath', 'boiler'] }
];

export function scenarioLoad(groups, kind = 'sustained', loads = GROUP_LOADS) {
  return groups.reduce((s, g) => s + (loads[g]?.[kind] ?? 0), 0);
}

// Время-токовая характеристика автомата, качественно.
//
// До 1,13 номинала тепловой расцепитель не трогается ВООБЩЕ — это условный
// ток нерасцепления. От 1,45 срабатывает в пределах часа. Между ними —
// зона, где всё зависит от того, сколько нагрузка продержится. Поэтому
// «выбьет / не выбьет» без длительности — бессмысленный вердикт.
export const TRIP = { hold: 1.13, hour: 1.45, magnetic: 5 };

export function tripBand(ratio) {
  if (ratio <= TRIP.hold) return { band: 'hold', label: 'holds indefinitely' };
  if (ratio <= TRIP.hour) return { band: 'slow', label: 'trips in tens of minutes' };
  if (ratio < TRIP.magnetic) return { band: 'minutes', label: 'trips in minutes' };
  return { band: 'instant', label: 'instantly' };
}

// Проверка ввода: считаем ОБА тока и смотрим, что делает автомат с каждым.
export function inputCheck({ rating = 32, voltage = 230, scenarios = SCENARIOS, loads = GROUP_LOADS }) {
  const rows = scenarios.map((sc) => {
    const peakW = scenarioLoad(sc.groups, 'peak', loads);
    const sustW = scenarioLoad(sc.groups, 'sustained', loads);
    const peakA = peakW / voltage;
    const sustA = sustW / voltage;
    return {
      ...sc,
      peakW, sustW, peakA, sustA,
      peakRatio: peakA / rating,
      sustRatio: sustA / rating,
      peak: tripBand(peakA / rating),
      sustained: tripBand(sustA / rating),
      // Опасен именно длительный ток: кратковременный пик автомат переживёт
      ok: sustA <= rating * TRIP.hold
    };
  });
  const installed = Object.values(loads).reduce((s, v) => s + v.peak, 0);
  return {
    rating, voltage, limitW: rating * voltage, installedW: installed,
    rows,
    worst: rows[rows.length - 1],
    // Ввод достаточен, если ни один сценарий не даёт ДЛИТЕЛЬНОГО перегруза
    sufficient: rows.every((r) => r.ok),
    // Но запас на будущее считается по пику: обогреватель или сауна сюда уже не влезут
    headroomW: rating * voltage - rows[rows.length - 1].sustW
  };
}

// --- Состав нового щита ---

// Модульность аппаратов: обычный автомат 1 модуль, дифавтомат 2,
// двухполюсный автомат 2, УЗО 2.
const WIDTH = { mcb1: 1, mcb2: 2, rcbo: 2, rcd: 2, relay: 2, spd: 2, socket: 3, meter: 6 };

// Счётчик сидит на СВОЕЙ панели над рейкой и модулей на ней не занимает —
// на фотографии это хорошо видно. Считаем только то, что стоит на DIN.
export const OUTDOOR = {
  id: 'vsch', label: 'Outdoor board — feed and metering', modules: 12,
  devices: [
    { id: 'QF1', label: 'Main breaker 2P C32', width: WIDTH.mcb2, keep: true,
      why: 'The rating is set by the contract, not by choice. Keep as is.' },
    { id: 'KV1', label: 'Voltage relay with AUTO-RESET', width: WIDTH.relay, replace: 'RMM47',
      why: 'THE MAIN REPLACEMENT. The RMM47 trips the breaker and leaves it off ' +
        'until it is re-armed by hand. In an empty house this means: one mains dip in January — ' +
        'and the house is without heating until you arrive. The UPS holds about 13 hours, then frost. ' +
        'A relay WITH AUTO-RESET switches the power back on by itself when the voltage returns.' },
    { id: 'FV1', label: 'SPD class II', width: WIDTH.spd, keep: true,
      why: 'Already there. An overhead feed in a village — lightning surges are real.' },
    { id: 'QD1', label: 'RCD 2P 63 A / 300 mA, type S', width: WIDTH.rcd, add: true,
      why: 'Fire protection. Type S is mandatory: without a time delay it will ' +
        'trip together with the group 30 mA devices, and there will be no selectivity.' },
    { id: 'XS1', label: 'Service socket', width: WIDTH.socket, keep: true,
      why: 'It is there, useful when working at the box.' }
  ],
  // Отсюда уезжает внутрь: два групповых аппарата, которые сейчас стоят
  // на улице. Они и освобождают три модуля под противопожарное УЗО.
  moveIndoors: [
    { label: 'VA47-29 C25', why: 'a group device outdoors is the wrong place' },
    { label: 'AVDT 32 C25 / 30 mA', why: 'an electronic RCBO at −27 °C is outside its range' }
  ]
};

// Групповые аппараты. По дифавтомату на группу, а не общее УЗО на всех:
// дом подолгу стоит пустым, и «выбило одно — погасло всё» здесь дороже,
// чем разница в цене аппаратов.
export const INDOOR = {
  id: 'shchr', label: 'Distribution board, in the hall', modules: 24,
  devices: [
    { id: 'QF0', label: 'Main load switch 2P 40 A', width: WIDTH.mcb2,
      why: 'To de-energise the house without going outside.' },
    { id: 'QF1', label: 'Lighting — C10, 3×1.5', width: WIDTH.mcb1, circuit: 'light',
      rating: 10, rcdMa: null,
      why: 'No RCD: class II luminaires and ceiling wiring. In return, when ' +
        'the sockets fault the light stays on — in an empty house that matters more.' },
    { id: 'QFD2', label: 'General sockets — C16 / 30 mA', width: WIDTH.rcbo, circuit: 'sockets',
      rating: 16, rcdMa: 30 },
    { id: 'QFD3', label: 'Kitchen sockets — C16 / 30 mA', width: WIDTH.rcbo, circuit: 'kitchen',
      rating: 16, rcdMa: 30 },
    { id: 'QFD4', label: 'Refrigerator and dishwasher — C16 / 30 mA', width: WIDTH.rcbo, circuit: 'kitchenApp',
      rating: 16, rcdMa: 30,
      why: 'Separate from the kitchen sockets: the refrigerator must not go dark because of ' +
        'a leakage in the kettle while the house is empty.' },
    { id: 'QFD5', label: 'Oven — C16 / 30 mA', width: WIDTH.rcbo, circuit: 'appliance',
      rating: 16, rcdMa: 30,
      why: '3.5 kW takes the whole line — there is nobody to share it with.' },
    { id: 'QFD6', label: 'Bathroom and washing machine — C16 / 10 mA', width: WIDTH.rcbo, circuit: 'bath',
      rating: 16, rcdMa: 10,
      why: 'A wet zone: 10 mA, not the common 30.' },
    { id: 'QFD7', label: 'Boiler through the UPS — C6 / 30 mA', width: WIDTH.rcbo, circuit: 'boiler',
      rating: 6, rcdMa: 30,
      why: 'Feeds the UPS, and from it the emergency board. Its own device — so that ' +
        'someone else’s fault does not shut down the heating.' }
  ]
};

// Что делать с аппаратами, которые сейчас стоят на улице.
//
// Соблазн переставить их в новый щит и сэкономить — но C25 на кабеле 3×2,5
// это защита, которая не защищает: провод раньше нагреется, чем автомат
// сработает. Все наши группы идут на 3×2,5 под C16, поэтому оба аппарата
// в дело не идут и остаются запасом.
export function salvage(existing = EXISTING, groups = INDOOR.devices) {
  const cableA = 16; // limit for 3×2.5 in our layout
  return existing.groups.map((g) => {
    const fits = groups.some((d) => d.rating === g.rating && (d.rcdMa ?? null) === (g.rcd ?? null));
    return {
      ...g,
      reusable: fits,
      why: fits
        ? 'fits the group as is'
        : `rating ${g.rating} A is above the permissible ${cableA} A for a 3×2.5 cable — ` +
          'not used, stays in reserve'
    };
  });
}

export function panelFill(panel) {
  const used = panel.devices.reduce((n, d) => n + d.width, 0);
  return {
    ...panel,
    used,
    free: panel.modules - used,
    fits: used <= panel.modules,
    // Меньше четверти запаса — щит собран впритык и добавить будет некуда
    roomy: panel.modules - used >= Math.ceil(panel.modules * 0.15)
  };
}

// Цепочка селективности по току утечки. Каждая ступень должна быть
// чувствительнее вышестоящей, а вышестоящая — с выдержкой времени.
export function rcdChain() {
  return [
    { at: 'Outdoor board', ma: 300, type: 'S', role: 'fire protection, time-delayed' },
    { at: 'Distribution board', ma: 30, type: 'AC/A', role: 'group, instantaneous' },
    { at: 'Distribution board, bathroom', ma: 10, type: 'A', role: 'wet zone' },
    { at: 'Emergency board, after the UPS', ma: 10, type: 'A', role: 'emergency socket' }
  ];
}

export function panelPlan({ inputRating = EXISTING.input.rating, outdoorC = DESIGN_OUTDOOR_C } = {}) {
  const outdoor = panelFill(OUTDOOR);
  const indoor = panelFill(INDOOR);
  const input = inputCheck({ rating: inputRating });
  const freedModules = OUTDOOR.moveIndoors.length + 1; // C25 (1) + AVDT32 (2)
  return {
    existing: EXISTING,
    outdoor,
    indoor,
    input,
    chain: rcdChain(),
    // Почему группировка уезжает в дом
    coldOutside: outdoorC < OUTDOOR_MIN_C,
    coldMarginK: OUTDOOR_MIN_C - outdoorC,
    freedModules,
    salvage: salvage(),
    totalRcbo: indoor.devices.filter((d) => d.width === WIDTH.rcbo).length
  };
}
