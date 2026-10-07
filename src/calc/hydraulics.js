// Гидравлика контуров тёплого пола.
//
// Отвечает на вопрос «хватит ли насоса котла или нужен свой на коллекторе».
// Считаем расход по каждому контуру, скорость, режим течения и потери давления.
//
// С антифризом вязкость выше в разы, поэтому течение уходит в ЛАМИНАРНОЕ —
// это важно: в ламинаре и теплоотдача хуже, и потери считаются иначе.

export const PIPE = {
  outer: 0.016, // м
  wall: 0.002,
  get inner() {
    return this.outer - 2 * this.wall;
  }
};

// Кинематическая вязкость при рабочих 40 °C, м²/с.
// Этиленгликоль заметно жиже пропиленгликоля — это в его пользу.
export const VISCOSITY = { water: 0.66e-6, ethylene50: 1.6e-6, glycol40: 2.5e-6 };

export function coolantViscosity(coolant) {
  if (coolant?.base === 'water') return VISCOSITY.water;
  if (coolant?.base === 'ethylene') return VISCOSITY.ethylene50;
  return VISCOSITY.glycol40;
}

export function loopFlow({ powerW, coolant, deltaT = 5 }) {
  const massKgS = powerW / (coolant.c * 1000 * deltaT);
  const volumeM3S = massKgS / coolant.density;
  return {
    massKgS,
    volumeM3S,
    lPerMin: volumeM3S * 60000,
    lPerHour: volumeM3S * 3600000
  };
}

export function loopHydraulics({ powerW, lengthM, coolant, deltaT = 5, viscosity }) {
  const flow = loopFlow({ powerW, coolant, deltaT });
  const d = PIPE.inner;
  const area = (Math.PI * d * d) / 4;
  const velocity = flow.volumeM3S / area;

  const nu = viscosity ?? coolantViscosity(coolant);
  const re = (velocity * d) / nu;
  const laminar = re < 2300;

  // Ламинар: f = 64/Re. Турбулент: Блазиус f = 0,316·Re^(−0,25)
  const f = laminar ? 64 / Math.max(1, re) : 0.316 * re ** -0.25;
  const dropPa = f * (lengthM / d) * ((coolant.density * velocity * velocity) / 2);

  return {
    ...flow,
    velocity,
    reynolds: re,
    laminar,
    friction: f,
    dropPa,
    dropKPa: dropPa / 1000,
    dropM: dropPa / (coolant.density * 9.81)
  };
}

// Запас по местным сопротивлениям: коллектор, клапаны, отводы
export const FITTINGS_FACTOR = 1.5;

// ГРАФИК НАСОСА ИЗ ПАСПОРТА — BAXI ECO Life, приложение Е, кривая 18F/24F/1.24F.
// Снято с графика по точкам: расход л/ч → напор м вод. ст.
// Раньше здесь стояла осторожная оценка 2,5 м; паспорт даёт вдвое больше.
export const BOILER_PUMP_CURVE = [
  [0, 5.3], [100, 5.2], [200, 5.05], [300, 4.9], [400, 4.7], [500, 4.5],
  [600, 4.3], [700, 4.05], [800, 3.8], [900, 3.5], [1000, 3.15],
  [1100, 2.85], [1200, 2.35]
];

// Внутреннее сопротивление самого котла (теплообменник, трёхходовой, обвязка).
// В паспорте не приведено — берём консервативную оценку для этого класса
// и вычитаем из графика, чтобы получить РАСПОЛАГАЕМЫЙ напор на систему.
export const BOILER_INTERNAL_LOSS_M = 0.6;

// Линейная интерполяция по графику
export function boilerPumpHead(flowLh, curve = BOILER_PUMP_CURVE) {
  if (flowLh <= curve[0][0]) return curve[0][1];
  const last = curve[curve.length - 1];
  if (flowLh >= last[0]) return last[1];

  for (let i = 1; i < curve.length; i++) {
    const [q0, h0] = curve[i - 1];
    const [q1, h1] = curve[i];
    if (flowLh <= q1) {
      return h0 + ((h1 - h0) * (flowLh - q0)) / (q1 - q0);
    }
  }
  return last[1];
}

export function systemHydraulics({ loops, coolant, deltaT = 5, boilerHeadM }) {
  const perLoop = loops.map((l) =>
    loopHydraulics({ powerW: l.powerW, lengthM: l.lengthM, coolant, deltaT })
  );

  // Насос должен продавить САМЫЙ ТЯЖЁЛЫЙ контур, а не сумму
  const worst = perLoop.reduce((a, b) => (b.dropM > a.dropM ? b : a), perLoop[0]);
  const requiredHeadM = worst.dropM * FITTINGS_FACTOR;
  const totalFlowLh = perLoop.reduce((s, p) => s + p.lPerHour, 0);

  // Напор берём с паспортного графика в рабочей точке, за вычетом
  // внутреннего сопротивления котла
  const curveHeadM = boilerPumpHead(totalFlowLh);
  const availableM = boilerHeadM ?? curveHeadM - BOILER_INTERNAL_LOSS_M;

  return {
    perLoop,
    worst,
    requiredHeadM,
    totalFlowLh,
    curveHeadM,
    boilerHeadM: availableM,
    margin: availableM - requiredHeadM,
    marginRatio: requiredHeadM > 0 ? availableM / requiredHeadM : Infinity,
    boilerPumpEnough: requiredHeadM <= availableM,
    anyLaminar: perLoop.some((p) => p.laminar)
  };
}
