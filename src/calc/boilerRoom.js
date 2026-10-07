// Обвязка котельной.
//
// Схема выбрана ПРЯМАЯ НИЗКОТЕМПЕРАТУРНАЯ: тёплый пол подключён к котлу
// без смесительного узла и без гидравлического разделителя. Это следствие
// трёх уже посчитанных вещей:
//
//   1) котёл умеет сам держать 45 °C с отсечкой на 50 — параметр F06 = 001;
//   2) насоса котла хватает с кратностью 3,5 — отдельный насос не нужен,
//      а паспорт разрешает второй насос только после гидроразделителя;
//   3) стяжка 4659 кг работает буфером бесплатно, но ТОЛЬКО при прямом
//      подключении: разделитель отрезал бы котёл от этой массы.
//
// Плата за простоту одна: между котлом и стяжкой не остаётся ничего,
// кроме настройки. Поэтому в схеме появляется аварийный термостат —
// вторая, независимая от прошивки, защита стяжки.

import { PIPE } from './hydraulics.js';

// Литров в погонном метре трубы
export function pipeVolumeLPerM(innerM = PIPE.inner) {
  return Math.PI * (innerM / 2) ** 2 * 1000;
}

// Подводка котёл — коллектор. У BAXI отопительные патрубки 3/4".
export const CONNECTION = { thread: '3/4"', dn: 20, innerMm: 20 };

// Объёмное расширение теплоносителя при нагреве от 10 до 50 °C.
// Гликоль расширяется заметно сильнее воды — это единственное место,
// где антифриз играет ПРОТИВ нас.
export const EXPANSION = { water: 0.012, ethylene: 0.018, propylene: 0.019 };

export function expansionRatio(coolant) {
  return EXPANSION[coolant?.base] ?? EXPANSION.propylene;
}

// Объём системы первого этажа.
// Мансардные радиаторы СЮДА НЕ ВХОДЯТ — они вне объёма работ.
export function systemVolume({
  pipeM,
  boilerL = 3, // heat exchanger and internal hydraulics of the boiler
  manifoldL = 1.2,
  connectionM = 1.4 // boiler — manifold connections, there and back
}) {
  const loopsL = pipeM * pipeVolumeLPerM();
  const connL = connectionM * (Math.PI * (CONNECTION.innerMm / 2000) ** 2 * 1000);
  return {
    loopsL,
    boilerL,
    manifoldL,
    connectionsL: connL,
    totalL: loopsL + boilerL + manifoldL + connL
  };
}

// Расширительный бак. Формула по абсолютным давлениям:
// V = ΔV · P_max / (P_max − P_min), где P — абсолютные.
// P_max берём на 10 % ниже уставки предохранительного клапана: клапан
// не должен открываться штатно.
export function expansionCheck({
  volumeL,
  coolant,
  vesselL,
  prechargeBar = 1.0, // vessel precharge = fill pressure
  reliefBar = 3.0
}) {
  const ratio = expansionRatio(coolant);
  const deltaV = volumeL * ratio;

  const pMaxAbs = reliefBar * 0.9 + 1;
  const pMinAbs = prechargeBar + 1;
  const requiredL = (deltaV * pMaxAbs) / (pMaxAbs - pMinAbs);

  return {
    ratio,
    deltaV,
    requiredL,
    vesselL,
    margin: vesselL / requiredL,
    ok: vesselL >= requiredL,
    prechargeBar,
    reliefBar
  };
}

// Скорость в подводке. Выше 0,7 м/с трубу слышно, выше 1,2 — гудит.
export function connectionVelocity(flowLh, innerMm = CONNECTION.innerMm) {
  const area = Math.PI * (innerMm / 2000) ** 2;
  return flowLh / 3600 / 1000 / area;
}

// Состав обвязки. Главная задача списка — отделить то, что УЖЕ ЕСТЬ
// внутри котла, от того, что надо купить: половина типовых схем из интернета
// дублирует встроенное.
export function boilerRoomParts({ loops, coolant, boiler }) {
  const toxic = !!coolant?.toxic;

  const builtIn = [
    { id: 'pump', name: 'Circulation pump', why: 'data sheet curve: 4.76 m at 368 l/h, margin ×3.5' },
    { id: 'vessel', name: `Expansion vessel ${boiler.expansionVesselL} l`, why: 'checked for glycol' },
    { id: 'relief', name: 'Pressure relief valve 3 bar', why: 'part of the boiler safety group' },
    { id: 'airvent', name: 'Automatic air vent', why: 'on the boiler pump' },
    { id: 'gauge', name: 'Pressure gauge', why: 'on the front panel' },
    { id: 'dhw', name: 'DHW three-way valve', why: 'dual-circuit boiler' },
    { id: 'ntc', name: 'NTC sensors on supply and return', why: 'F06 works on them' }
  ];

  const required = [
    {
      id: 'ball-supply', name: 'Ball valve 3/4" with union', qty: 2, unit: 'pcs',
      why: 'boiler supply and return — remove the boiler without draining the system'
    },
    {
      id: 'strainer', name: 'Y-strainer 3/4"', qty: 1, unit: 'pcs',
      why: 'on the RETURN before the boiler. The screed is new, there will be a lot of scale and debris'
    },
    {
      id: 'ball-manifold', name: 'Ball valve 3/4" for the manifold', qty: 2, unit: 'pcs',
      why: 'isolate the manifold separately from the boiler'
    },
    {
      id: 'thermo', name: 'Strap-on thermometer 0–80 °C', qty: 2, unit: 'pcs',
      why: 'manifold supply and return. The difference shows whether the loop works — this is the main commissioning instrument'
    },
    {
      id: 'safety-stat', name: 'Strap-on emergency thermostat, set to 55 °C', qty: 1, unit: 'pcs',
      why: 'the SECOND screed protection. With a direct connection there is nothing between the boiler and the concrete except the F06 parameter'
    },
    {
      id: 'outdoor', name: 'Outdoor temperature sensor', qty: 1, unit: 'pcs',
      why: 'without it the Kt curve does not work at all, and it is built into the calculation'
    },
    {
      id: 'eurocone', name: 'Euroconus 16 × 2.0 → 3/4"', qty: loops * 2, unit: 'pcs',
      why: 'supply and return of each loop'
    }
  ];

  // Подпитка: с ядовитым гликолем постоянная связь с водопроводом недопустима,
  // да и вода просто разбавит состав до потери морозостойкости.
  const makeup = toxic
    ? {
        id: 'makeup-manual',
        name: 'Manual test pump + tank of ready-mixed fluid',
        mode: 'broken-line, manual',
        why:
          'PLUG and seal the built-in DHW make-up valve. ' +
          'The coolant is toxic, and make-up with water also dilutes the mixture.'
      }
    : {
        id: 'makeup-auto',
        name: 'Make-up unit with a non-return valve',
        mode: 'from the mains',
        why: 'automatic make-up is acceptable on water'
      };

  return { builtIn, required, makeup, toxic };
}

// Всё вместе — то, что показывает схема и берёт смета.
export function boilerRoomPlan({ boiler, coolant, loops, flowLh, screedArea }) {
  const vol = systemVolume({ pipeM: loops.totalPipe });
  const exp = expansionCheck({
    volumeL: vol.totalL,
    coolant,
    vesselL: boiler.expansionVesselL
  });
  const velocity = connectionVelocity(flowLh);
  const parts = boilerRoomParts({ loops: loops.totalLoops, coolant, boiler });

  return {
    scheme: 'direct-low-temp',
    volume: vol,
    expansion: exp,
    connection: {
      ...CONNECTION,
      flowLh,
      velocity,
      quiet: velocity <= 0.7
    },
    screedArea,
    ...parts
  };
}
