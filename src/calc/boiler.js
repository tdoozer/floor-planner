// Проверка котла на тактование.
//
// Двухконтурный настенный котёл подбирается по ГОРЯЧЕЙ ВОДЕ, а не по отоплению:
// чтобы дать 13,7 л/мин, нужны 24 кВт. Дому столько никогда не требуется,
// поэтому минимальная мощность модуляции почти всегда оказывается выше
// реальной нагрузки — котёл начинает включаться-выключаться короткими циклами.
//
// Лечится не заменой котла (иначе просядет ГВС), а объёмом теплоносителя,
// с которым котёл гидравлически связан, и погодозависимой автоматикой.

export const WATER_C = 4.18; // кДж/(кг·К)
export const CONCRETE_C = 0.84; // кДж/(кг·К)
export const CONCRETE_DENSITY = 2200; // кг/м³

// Цикл короче 10 минут считается тактованием
export const MIN_CYCLE_MINUTES = 10;

// Тепловая масса стяжки, приведённая к литрам воды.
// Если контур тёплого пола подключён к котлу НАПРЯМУЮ, без гидравлического
// разделения, котёл «видит» всю эту массу — она работает буфером бесплатно.
export function screedThermalMass(areaM2, screed) {
  const volumeM3 = (areaM2 * screed.screedTotal) / 1000;
  const massKg = volumeM3 * CONCRETE_DENSITY;
  return {
    volumeM3,
    massKg,
    // Эквивалент в литрах воды по теплоёмкости
    waterEquivalentL: (massKg * CONCRETE_C) / WATER_C
  };
}

// Время работы горелки от включения до отключения, минуты.
// Избыточная мощность разгоняет объём системы на гистерезис термостата.
// coolantRatio — объёмная теплоёмкость теплоносителя относительно воды:
// у антифриза она ниже, значит инерция жидкой части системы меньше.
export function burnerCycleMinutes({
  minPowerKw,
  loadKw,
  systemVolumeL,
  hysteresisK = 5,
  coolantRatio = 1
}) {
  const excessW = (minPowerKw - loadKw) * 1000;
  if (excessW <= 0) return Infinity; // котёл модулируется ниже нагрузки — тактования нет
  const energyKj = systemVolumeL * WATER_C * coolantRatio * hysteresisK;
  return (energyKj * 1000) / excessW / 60;
}

// Сколько дом остывает без отопления.
// Экспоненциальное остывание: T(t) = Tout + (T0 − Tout)·e^(−t/τ), τ = C / UA.
// Это и есть ответ на вопрос «зачем антифриз» — он нужен только там,
// где отключение длиннее полученного времени.
export function houseCooldown({
  screedMassKg,
  structureFactor = 1.6, // стены, перегородки, мебель сверх массы стяжки
  uaWPerK,
  tStart = 22,
  tOut = -27,
  tTarget = 0
}) {
  const capacityJPerK = screedMassKg * CONCRETE_C * 1000 * structureFactor;
  const tauSeconds = capacityJPerK / uaWPerK;

  if (tStart <= tTarget || tOut >= tTarget) return { tauHours: tauSeconds / 3600, hours: Infinity };

  const hours = (tauSeconds * Math.log((tStart - tOut) / (tTarget - tOut))) / 3600;
  return { tauHours: tauSeconds / 3600, capacityJPerK, hours };
}

// Объём системы, при котором цикл достигает целевой длительности
export function requiredVolumeL({ minPowerKw, loadKw, targetMinutes = MIN_CYCLE_MINUTES, hysteresisK = 5 }) {
  const excessW = (minPowerKw - loadKw) * 1000;
  if (excessW <= 0) return 0;
  return (excessW * targetMinutes * 60) / (WATER_C * hysteresisK * 1000);
}

// Полная проверка котла против расчётной нагрузки.
// schemes — варианты гидравлики с их объёмом теплоносителя.
export function boilerCheck({ boiler, loadKw, areaM2, screed, pipeVolumeL = 0, coolantRatio = 1 }) {
  const mass = screedThermalMass(areaM2, screed);

  // Собственный объём котла и обвязки — оценка
  const boilerLoopL = 12;

  const schemes = [
    {
      id: 'separated',
      name: 'ТП через смесительный узел',
      note: 'Котёл отделён от стяжки: видит только свой контур',
      volumeL: boilerLoopL + pipeVolumeL * 0.3
    },
    {
      id: 'buffer100',
      name: 'То же плюс буфер 100 л',
      note: 'Буферу нужно место в прихожей',
      volumeL: boilerLoopL + pipeVolumeL * 0.3 + 100
    },
    {
      id: 'direct',
      name: 'Прямое низкотемпературное подключение',
      note: 'Котёл связан со всей массой стяжки',
      volumeL: boilerLoopL + pipeVolumeL + mass.waterEquivalentL
    }
  ].map((s) => ({
    ...s,
    cycleMinutes: burnerCycleMinutes({
      minPowerKw: boiler.powerMin,
      loadKw,
      // Масса стяжки — бетон, теплоноситель на неё поправку не вносит.
      // Поправка применяется только к жидкой части объёма.
      systemVolumeL: s.id === 'direct'
        ? mass.waterEquivalentL + (s.volumeL - mass.waterEquivalentL) * coolantRatio
        : s.volumeL * coolantRatio
    })
  })).map((s) => ({ ...s, ok: s.cycleMinutes >= MIN_CYCLE_MINUTES }));

  const ratio = boiler.powerMin / Math.max(0.001, loadKw);

  return {
    minPowerKw: boiler.powerMin,
    loadKw,
    ratio,
    // Котёл не может опуститься до нагрузки — тактование неизбежно
    oversized: boiler.powerMin > loadKw,
    excessKw: boiler.powerMin - loadKw,
    screedMass: mass,
    requiredVolumeL: requiredVolumeL({ minPowerKw: boiler.powerMin, loadKw }),
    schemes,
    best: schemes.filter((s) => s.ok).sort((a, b) => a.volumeL - b.volumeL)[0] || null
  };
}
