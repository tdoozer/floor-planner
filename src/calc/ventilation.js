// Вентиляция: расходы и диаметры каналов.
//
// Нормативные расходы приведены как ОРИЕНТИРЫ и требуют сверки
// с актуальными СП (в частности СП 402.1325800 по газифицированным
// помещениям и СП 54.13330 по жилым зданиям).

// Расчётные расходы вытяжки, м³/ч
export const EXTRACT_FLOW = {
  bathCombined: 50, // combined bathroom
  wc: 25,
  bathroom: 25,
  kitchenElectric: 60,
  kitchenGas: 90, // more is required with a gas hob
  hoodBoost: 400 // kitchen hood at maximum
};

// Рекомендуемая скорость в воздуховоде, м/с.
// Выше — растёт шум, ниже — канал получается неоправданно толстым.
export const DUCT_VELOCITY = { quiet: 3, normal: 4, max: 5 };

// Диаметр круглого канала под заданный расход
export function ductDiameter(flowM3h, velocity = DUCT_VELOCITY.normal) {
  const area = flowM3h / 3600 / velocity; // m²
  return Math.sqrt((4 * area) / Math.PI); // m
}

// Ближайший стандартный диаметр из ряда
export const STANDARD_DUCTS = [0.1, 0.125, 0.15, 0.16, 0.2];

export function pickDuct(flowM3h, velocity = DUCT_VELOCITY.normal) {
  const need = ductDiameter(flowM3h, velocity);
  const pick = STANDARD_DUCTS.find((d) => d >= need) ?? STANDARD_DUCTS[STANDARD_DUCTS.length - 1];
  const area = (Math.PI * pick * pick) / 4;
  return {
    required: need,
    diameter: pick,
    actualVelocity: flowM3h / 3600 / area
  };
}

// Кратность воздухообмена, которую даёт вытяжка в помещении
export function airChanges(flowM3h, areaM2, heightM) {
  return flowM3h / (areaM2 * heightM);
}

export function ventilationPlan({ bathArea, kitchenArea, height, gasHob }) {
  const bathFlow = EXTRACT_FLOW.bathCombined;
  const kitchenFlow = gasHob ? EXTRACT_FLOW.kitchenGas : EXTRACT_FLOW.kitchenElectric;

  return {
    bath: {
      flow: bathFlow,
      ...pickDuct(bathFlow),
      ach: airChanges(bathFlow, bathArea, height)
    },
    kitchen: {
      flow: kitchenFlow,
      ...pickDuct(kitchenFlow),
      ach: airChanges(kitchenFlow, kitchenArea, height),
      gasHob
    },
    hood: {
      flow: EXTRACT_FLOW.hoodBoost,
      ...pickDuct(EXTRACT_FLOW.hoodBoost, DUCT_VELOCITY.max)
    }
  };
}

// Сколько влаги даёт сгорание газа.
// При сгорании 1 м³ природного газа образуется около 1,6 кг водяного пара —
// именно поэтому газовая плита без вытяжки резко поднимает влажность.
export const WATER_PER_M3_GAS = 1.6; // kg

export function cookingMoisture({ gasM3PerHour = 0.35, hours = 1 }) {
  return gasM3PerHour * hours * WATER_PER_M3_GAS;
}
