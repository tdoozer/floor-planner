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
  meter: { model: 'Меркурий 203.1', rating: '5(80) А', year: 2012, serial: '12567771',
    // Межповерочный интервал 16 лет: до 2028-го счётчик легитимен.
    // Менять его теперь обязанность сетевой организации, не ваша.
    calibrationYears: 16 },
  input: { device: 'ВА47-29', curve: 'C', rating: 32, poles: 2 },
  voltageRelay: { model: 'РММ47', uMin: 165, uMax: 265, autoReset: false },
  spd: { model: 'ОПС', class: 2, up: 1.8 },
  groups: [
    { device: 'ВА47-29', curve: 'C', rating: 25, rcd: null },
    { device: 'АВДТ 32', curve: 'C', rating: 25, rcd: 30 }
  ],
  socket: true
};

export const OUTDOOR_MIN_C = -25; // нижняя граница электронных АВДТ
export const DESIGN_OUTDOOR_C = -27; // расчётная наружная для объекта

// Мощности по группам, в двух колонках. Одна цифра тут врёт:
// у чайника и ТЭНа посудомойки пик держится минуты, а не часы, и тепловой
// расцепитель на такие всплески не реагирует вовсе.
//
//   peak      — всё включено разом, единицы минут
//   sustained — средняя за полчаса и дольше, то есть то, что реально греет автомат
export const GROUP_LOADS = {
  light: { peak: 300, sustained: 300 },
  sockets: { peak: 1500, sustained: 300 }, // телевизор и зарядки
  kitchen: { peak: 3000, sustained: 200 }, // чайник кипит три минуты
  kitchenApp: { peak: 2500, sustained: 1000 }, // ТЭН посудомойки + холодильник
  appliance: { peak: 3500, sustained: 1500 }, // духовка после разогрева модулирует
  bath: { peak: 3700, sustained: 1200 }, // стиралка греет воду минут пятнадцать
  boiler: { peak: 130, sustained: 130 }
};

// Сочетания, которые реально случаются одновременно. Коэффициент
// одновременности по справочнику — усреднение по многим домам;
// для одного дома честнее перебрать конкретные сценарии.
export const SCENARIOS = [
  { id: 'idle', label: 'Дом пустой, поддержание', groups: ['boiler'] },
  { id: 'evening', label: 'Обычный вечер', groups: ['light', 'sockets', 'kitchenApp', 'boiler'] },
  { id: 'cooking', label: 'Готовка с посудомойкой', groups: ['light', 'kitchen', 'kitchenApp', 'appliance', 'boiler'] },
  { id: 'worst', label: 'Праздник: духовка, ПММ, стиралка и чайник',
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
  if (ratio <= TRIP.hold) return { band: 'hold', label: 'держит сколько угодно' };
  if (ratio <= TRIP.hour) return { band: 'slow', label: 'выбьет за десятки минут' };
  if (ratio < TRIP.magnetic) return { band: 'minutes', label: 'выбьет за минуты' };
  return { band: 'instant', label: 'мгновенно' };
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
  id: 'vsch', label: 'ВЩ — ввод и учёт, снаружи', modules: 12,
  devices: [
    { id: 'QF1', label: 'Вводной автомат 2P C32', width: WIDTH.mcb2, keep: true,
      why: 'Номинал задан договором, а не выбором. Оставляем как есть.' },
    { id: 'KV1', label: 'Реле напряжения с АВТОВОЗВРАТОМ', width: WIDTH.relay, replace: 'РММ47',
      why: 'ГЛАВНАЯ ЗАМЕНА. РММ47 сбрасывает автомат и оставляет его выключенным ' +
        'до ручного взвода. В пустом доме это значит: одна просадка сети в январе — ' +
        'и дом без отопления до вашего приезда. ИБП держит около 13 часов, дальше мороз. ' +
        'Реле С АВТОВОЗВРАТОМ само включает питание, когда напряжение вернулось.' },
    { id: 'FV1', label: 'УЗИП класс II', width: WIDTH.spd, keep: true,
      why: 'Уже стоит. Воздушный ввод в деревне — грозовые импульсы реальны.' },
    { id: 'QD1', label: 'УЗО 2P 63 А / 300 мА, тип S', width: WIDTH.rcd, add: true,
      why: 'Противопожарное. Тип S обязателен: без выдержки времени оно будет ' +
        'выбивать вместе с групповыми 30 мА, и селективности не получится.' },
    { id: 'XS1', label: 'Сервисная розетка', width: WIDTH.socket, keep: true,
      why: 'Есть, полезна при работах у ящика.' }
  ],
  // Отсюда уезжает внутрь: два групповых аппарата, которые сейчас стоят
  // на улице. Они и освобождают три модуля под противопожарное УЗО.
  moveIndoors: [
    { label: 'ВА47-29 C25', why: 'групповой аппарат на улице — не место' },
    { label: 'АВДТ 32 C25 / 30 мА', why: 'электронный дифавтомат при −27 °C за пределом диапазона' }
  ]
};

// Групповые аппараты. По дифавтомату на группу, а не общее УЗО на всех:
// дом подолгу стоит пустым, и «выбило одно — погасло всё» здесь дороже,
// чем разница в цене аппаратов.
export const INDOOR = {
  id: 'shchr', label: 'ЩР — распределительный, в прихожей', modules: 24,
  devices: [
    { id: 'QF0', label: 'Вводной выключатель нагрузки 2P 40 А', width: WIDTH.mcb2,
      why: 'Чтобы обесточить дом, не выходя на улицу.' },
    { id: 'QF1', label: 'Освещение — C10, 3×1,5', width: WIDTH.mcb1, circuit: 'light',
      rating: 10, rcdMa: null,
      why: 'Без УЗО: светильники класса II и потолочная разводка. Зато при ' +
        'аварии в розетках свет остаётся — в пустом доме это важнее.' },
    { id: 'QFD2', label: 'Розетки общие — C16 / 30 мА', width: WIDTH.rcbo, circuit: 'sockets',
      rating: 16, rcdMa: 30 },
    { id: 'QFD3', label: 'Розетки кухни — C16 / 30 мА', width: WIDTH.rcbo, circuit: 'kitchen',
      rating: 16, rcdMa: 30 },
    { id: 'QFD4', label: 'Холодильник и посудомойка — C16 / 30 мА', width: WIDTH.rcbo, circuit: 'kitchenApp',
      rating: 16, rcdMa: 30,
      why: 'Отдельно от розеток кухни: холодильник не должен гаснуть из-за ' +
        'утечки в чайнике, пока дом пустой.' },
    { id: 'QFD5', label: 'Духовой шкаф — C16 / 30 мА', width: WIDTH.rcbo, circuit: 'appliance',
      rating: 16, rcdMa: 30,
      why: '3,5 кВт выбирают линию целиком — делить не с кем.' },
    { id: 'QFD6', label: 'Санузел и стиральная — C16 / 10 мА', width: WIDTH.rcbo, circuit: 'bath',
      rating: 16, rcdMa: 10,
      why: 'Мокрая зона: 10 мА, а не общие 30.' },
    { id: 'QFD7', label: 'Котёл через ИБП — C6 / 30 мА', width: WIDTH.rcbo, circuit: 'boiler',
      rating: 6, rcdMa: 30,
      why: 'Питает ИБП, а от него аварийный щиток. Свой аппарат — чтобы ' +
        'чужая авария не гасила отопление.' }
  ]
};

// Что делать с аппаратами, которые сейчас стоят на улице.
//
// Соблазн переставить их в новый щит и сэкономить — но C25 на кабеле 3×2,5
// это защита, которая не защищает: провод раньше нагреется, чем автомат
// сработает. Все наши группы идут на 3×2,5 под C16, поэтому оба аппарата
// в дело не идут и остаются запасом.
export function salvage(existing = EXISTING, groups = INDOOR.devices) {
  const cableA = 16; // предел для 3×2,5 в нашей раскладке
  return existing.groups.map((g) => {
    const fits = groups.some((d) => d.rating === g.rating && (d.rcdMa ?? null) === (g.rcd ?? null));
    return {
      ...g,
      reusable: fits,
      why: fits
        ? 'подходит под группу как есть'
        : `номинал ${g.rating} А выше допустимого ${cableA} А для кабеля 3×2,5 — ` +
          'в дело не идёт, остаётся запасом'
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
    { at: 'ВЩ', ma: 300, type: 'S', role: 'противопожарное, с выдержкой' },
    { at: 'ЩР', ma: 30, type: 'AC/A', role: 'групповые, мгновенные' },
    { at: 'ЩР, санузел', ma: 10, type: 'A', role: 'мокрая зона' },
    { at: 'ЩАП, после ИБП', ma: 10, type: 'A', role: 'аварийная розетка' }
  ];
}

export function panelPlan({ inputRating = EXISTING.input.rating, outdoorC = DESIGN_OUTDOOR_C } = {}) {
  const outdoor = panelFill(OUTDOOR);
  const indoor = panelFill(INDOOR);
  const input = inputCheck({ rating: inputRating });
  const freedModules = OUTDOOR.moveIndoors.length + 1; // C25 (1) + АВДТ32 (2)
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
