// Подбор ИБП для газового котла.
//
// Котёл встаёт не от мороза, а от отсутствия электричества. По шильдику
// BAXI ECO Life 24F потребляет 110 Вт — это максимум с работающим насосом
// и вентилятором; средняя за час заметно ниже.
//
// Ограничивает время работы НЕ мощность инвертора, а ёмкость аккумуляторов:
// 110 Вт потянет любой инвертор, а вот часы даёт только банк батарей.

export const INVERTER_EFFICIENCY = 0.85;
export const INVERTER_IDLE_W = 12; // собственное потребление инвертора

// Топология ИБП. Разница не в качестве синуса — чистый синус даёт и то, и другое,
// — а в том, СКОЛЬКО ИБП съедает сам, пока держит нагрузку от батареи.
//
// line-interactive: в сети нагрузка идёт транзитом, инвертор просыпается
//   только в отключение. Дёшево и экономно, но каждая просадка сети —
//   переход на батарею, то есть лишний цикл AGM.
// online (двойное преобразование): инвертор работает ВСЕГДА, напряжение
//   регулируется непрерывно, перехода нет вовсе. Платим за это постоянным
//   собственным потреблением — на 500 ВА это порядка 30 Вт, то есть треть
//   от котла. В деревне с проседающей сетью размен оправдан, в сети
//   нормального качества — нет.
// Паспорт Штиль SW500L — СВЕРЕНО с карточкой производителя (shtyl.ru).
// Две цифры здесь опровергают мои прежние оценки, и обе в лучшую сторону.
export const SW500L = {
  model: 'Штиль SW500L',
  va: 500, watts: 400, // круглосуточно, заявлено производителем
  maxOutA: 2.3,
  topology: 'online', wave: 'чистая синусоида', accuracy: 2,
  inputRange: [90, 295], // очень широкий — ИБП сам работает стабилизатором
  outlets: 'EURO F-type с заземлением, 1 шт.', // отсюда и нужда в щитке после
  chargerA: 5,
  busV: 24, // подтверждается батарейными модулями BM-24-xx: две АКБ 12 В в серию
  // ПРОИЗВОДИТЕЛЬ РАЗРЕШАЕТ ДО 250 А·ч. Моя оценка «не больше 100 по правилу
  // C/20» была занижена: у SW500L интеллектуальный алгоритм заряда
  // и термокомпенсация, и Штиль прямо указывает предел 250.
  maxBankAh: 250,
  // И глубина разряда не 50 %, а 80–85 %: ИБП сам отсекает батарею на этом
  // уровне. Значит доступной энергии в полтора с лишним раза больше,
  // чем я считал по «свинец глубже половины не разряжать».
  dodCutoff: 0.8,
  sizeMm: { w: 357, h: 287, d: 112, dBracket: 116 }, massKg: 5,
  tempC: [5, 40], // ТОЛЬКО в помещении
  ip: 20
};

export const TOPOLOGY = {
  lineInteractive: { id: 'line', label: 'line-interactive', idleW: 12 },
  online: { id: 'online', label: 'online, двойное преобразование', idleW: 30 }
};

// Зарядное устройство — НЕДООЦЕНЁННОЕ ограничение. Оно, а не инвертор,
// задаёт предельный разумный размер СВИНЦОВОГО банка: AGM нельзя заряжать
// медленнее примерно C/20, иначе после каждого отключения батарея
// не успевает вернуться к полному заряду и сульфатируется за пару сезонов.
//
// На литий это НЕ распространяется: LiFePO4 не сульфатирует и спокойно
// живёт недозаряженным. Там медленное зарядное — просто долго, а не вредно.
export const MIN_CHARGE_RATE = 1 / 20;

export function maxBankAh(chargerA, rate = MIN_CHARGE_RATE) {
  return chargerA / rate;
}

// Часы заряда банка обратно из разряда до заданной глубины.
// У свинца хвост заряда идёт медленно: абсорбция добавляет примерно
// половину сверх основного этапа. У лития хвоста практически нет.
export function rechargeHours({ ah, dod = 0.5, chargerA, chemistry = 'agm' }) {
  const bulk = (ah * dod) / chargerA;
  return { bulk, total: chemistry === 'lfp' ? bulk * 1.05 : bulk * 1.5 };
}

// Типовые аккумуляторы. Глубина разряда 0,5 — РЕСУРСНАЯ: на ней свинец
// живёт максимально долго. Но ИБП отсекает батарею только на 80–85 %,
// и в настоящем длинном отключении вам достанется именно столько.
//
// Для котла это разумный размен: разрядов в сезон единицы, а не сотни,
// и 200 циклов до 80 % при двадцати разрядах в год — это десять лет.
// Поэтому считаем ОБА числа: dod для житейского режима, dodCutoff — предел.
export const BATTERIES = [
  // Батарея охранной серии на 40 А·ч: дёшево за ампер-час, но энергии
  // в паре меньше киловатт-часа — на котёл это единицы часов, не десятки.
  { id: 'agm40x2', label: 'AGM 12 В · 40 А·ч × 2', voltage: 12, ah: 40, dod: 0.5, count: 2, chemistry: 'agm' },
  { id: 'agm100', label: 'AGM 12 В · 100 А·ч', voltage: 12, ah: 100, dod: 0.5, count: 1, chemistry: 'agm' },
  { id: 'agm100x2', label: 'AGM 12 В · 100 А·ч × 2', voltage: 12, ah: 100, dod: 0.5, count: 2, chemistry: 'agm' },
  { id: 'agm140x2', label: 'AGM 12 В · 140 А·ч × 2', voltage: 12, ah: 140, dod: 0.5, count: 2, chemistry: 'agm' },
  { id: 'agm200x2', label: 'AGM 12 В · 200 А·ч × 2', voltage: 12, ah: 200, dod: 0.5, count: 2, chemistry: 'agm' },
  { id: 'lfp100', label: 'LiFePO4 12 В · 100 А·ч', voltage: 12, ah: 100, dod: 0.9, count: 1, chemistry: 'lfp' },
  { id: 'lfp200', label: 'LiFePO4 12 В · 200 А·ч', voltage: 12, ah: 200, dod: 0.9, count: 1, chemistry: 'lfp' }
];

export function usableWh(battery, depth = null) {
  return battery.voltage * battery.ah * (depth ?? battery.dod) * battery.count;
}

// Часы автономной работы. loadW — средняя мощность нагрузки.
export function runtimeHours(battery, loadW, efficiency = INVERTER_EFFICIENCY, idleW = INVERTER_IDLE_W, depth = null) {
  const draw = loadW + idleW;
  if (draw <= 0) return Infinity;
  return (usableWh(battery, depth) * efficiency) / draw;
}

// Ёмкость, нужная чтобы продержаться заданное время
export function requiredAh({ loadW, hours, voltage = 12, dod = 0.5, efficiency = INVERTER_EFFICIENCY }) {
  const wh = ((loadW + INVERTER_IDLE_W) * hours) / efficiency;
  return wh / (voltage * dod);
}

// Полный подбор: сравнение вариантов против целевого времени.
// targetHours обычно берут из времени остывания дома — дольше держать смысла нет.
export function upsSizing({
  boilerW, pumpW = 0, dutyFactor = 0.65, targetHours,
  // Роутер сидит на том же ИБП (см. calc/lowVoltage.js) и работает
  // НЕПРЕРЫВНО, в отличие от котла — поэтому в средних он идёт целиком.
  alwaysOnW = 0,
  topology = TOPOLOGY.lineInteractive,
  chargerA = null,
  deviceMaxBankAh = null,
  // Глубина разряда, на которую считаем автономию. null — ресурсная из батареи.
  depth = null
}) {
  const peakW = boilerW + pumpW + alwaysOnW;
  const avgW = (boilerW + pumpW) * dutyFactor + alwaysOnW;
  // Предел банка берём ПАСПОРТНЫЙ, если он задан: производитель знает
  // про свой алгоритм заряда больше, чем общее правило C/20.
  // Само правило остаётся — но как предупреждение о ДОЛГОМ заряде,
  // а не как запрет.
  const bankLimitAh = deviceMaxBankAh ?? (chargerA ? maxBankAh(chargerA) : null);
  const slowChargeAh = chargerA ? maxBankAh(chargerA) : null;

  const options = BATTERIES.map((b) => {
    const hours = runtimeHours(b, avgW, INVERTER_EFFICIENCY, topology.idleW, depth);
    // ВАЖНО: внешние батареи ИБП соединяются ПОСЛЕДОВАТЕЛЬНО — так набирается
    // напряжение шины (24 или 48 В). Энергия при этом складывается, а вот
    // ёмкость банка в ампер-часах остаётся ёмкостью ОДНОЙ батареи.
    // Отсюда и требование к зарядному: оно считается от 100 А·ч, а не от 200.
    const bankAh = b.series === false ? b.ah * b.count : b.ah;
    // Банк, который зарядное не тянет, «проходит» только на бумаге
    // Литию медленное зарядное не вредит — только долго
    const chargeable =
      bankLimitAh === null || b.chemistry === 'lfp' || bankAh <= bankLimitAh;
    return {
      ...b,
      bankAh,
      usableWh: usableWh(b, depth),
      // Заряд считается от той же глубины, из которой выбирались
      slowCharge: slowChargeAh !== null && bankAh > slowChargeAh,
      hours,
      chargeable,
      recharge: chargerA
        ? rechargeHours({ ah: bankAh, dod: depth ?? b.dod, chargerA, chemistry: b.chemistry })
        : null,
      ok: (targetHours ? hours >= targetHours : true) && chargeable
    };
  });

  return {
    peakW,
    avgW,
    topology,
    idleW: topology.idleW,
    chargerA,
    bankLimitAh,
    slowChargeAh,
    depth,
    // Мощность инвертора: пусковой ток насоса даёт кратковременный всплеск
    inverterVaMin: Math.ceil((peakW * 3) / 50) * 50,
    options,
    best: options.find((o) => o.ok) || null,
    // Лучшее, что вообще даёт это зарядное, даже если цели не достигает
    bestChargeable: [...options].filter((o) => o.chargeable).sort((a, b) => b.hours - a.hours)[0] ?? null
  };
}
