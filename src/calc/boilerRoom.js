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
  boilerL = 3, // теплообменник и внутренняя гидравлика котла
  manifoldL = 1.2,
  connectionM = 1.4 // подводки котёл — коллектор, туда и обратно
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
  prechargeBar = 1.0, // предварительное давление бака = давлению заполнения
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
    { id: 'pump', name: 'Циркуляционный насос', why: 'график из паспорта: 4,76 м при 368 л/ч, запас ×3,5' },
    { id: 'vessel', name: `Расширительный бак ${boiler.expansionVesselL} л`, why: 'проверен на гликоль' },
    { id: 'relief', name: 'Предохранительный клапан 3 бар', why: 'входит в группу безопасности котла' },
    { id: 'airvent', name: 'Автоматический воздухоотводчик', why: 'на насосе котла' },
    { id: 'gauge', name: 'Манометр', why: 'на лицевой панели' },
    { id: 'dhw', name: 'Трёхходовой клапан ГВС', why: 'двухконтурный котёл' },
    { id: 'ntc', name: 'Датчики NTC подачи и обратки', why: 'на них и работает F06' }
  ];

  const required = [
    {
      id: 'ball-supply', name: 'Кран шаровой 3/4" с американкой', qty: 2, unit: 'шт',
      why: 'подача и обратка котла — снять котёл, не сливая систему'
    },
    {
      id: 'strainer', name: 'Фильтр косой сетчатый 3/4"', qty: 1, unit: 'шт',
      why: 'на ОБРАТКЕ перед котлом. Стяжка новая, окалины и мусора будет много'
    },
    {
      id: 'ball-manifold', name: 'Кран шаровой 3/4" на коллектор', qty: 2, unit: 'шт',
      why: 'отсечь коллектор отдельно от котла'
    },
    {
      id: 'thermo', name: 'Термометр накладной 0–80 °C', qty: 2, unit: 'шт',
      why: 'подача и обратка коллектора. По разнице видно, работает ли контур — это главный прибор наладки'
    },
    {
      id: 'safety-stat', name: 'Термостат аварийный накладной, уставка 55 °C', qty: 1, unit: 'шт',
      why: 'ВТОРАЯ защита стяжки. При прямом подключении между котлом и бетоном нет ничего, кроме параметра F06'
    },
    {
      id: 'outdoor', name: 'Датчик наружной температуры', qty: 1, unit: 'шт',
      why: 'без него кривая Kt не работает вообще, а она заложена в расчёт'
    },
    {
      id: 'eurocone', name: 'Евроконус 16 × 2,0 → 3/4"', qty: loops * 2, unit: 'шт',
      why: 'подача и обратка каждого контура'
    }
  ];

  // Подпитка: с ядовитым гликолем постоянная связь с водопроводом недопустима,
  // да и вода просто разбавит состав до потери морозостойкости.
  const makeup = toxic
    ? {
        id: 'makeup-manual',
        name: 'Ручной насос опрессовщик + бак готовой смеси',
        mode: 'разрывная, ручная',
        why:
          'Встроенный кран подпитки от ГВС ЗАГЛУШИТЬ и опломбировать. ' +
          'Теплоноситель ядовит, а подпитка водой ещё и разбавляет состав.'
      }
    : {
        id: 'makeup-auto',
        name: 'Узел подпитки с обратным клапаном',
        mode: 'от водопровода',
        why: 'на воде допустима автоматическая подпитка'
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
