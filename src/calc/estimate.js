// Спецификация материалов по полу и тёплому полу.
//
// Всё выводится ИЗ ГЕОМЕТРИИ: поменяли толщину ЭППС или сдвинули перегородку —
// объёмы пересчитались. Никаких зашитых количеств.
//
// Отделка, электрика, лестница и сантехразводка сюда НЕ входят: по ним пока
// нет решений, а выдавать придуманные цифры за спецификацию нельзя.

import { INNER_D, INNER_W, buildRooms, buildWalls } from '../data/project.js';
import { polygonArea, wallVector } from './geometry.js';
import { PRICEBOOK_META, lineCost, packOf } from '../data/pricebook.ru.js';
import { buildWorktop } from '../data/worktop.js';
import { stairFabrication, worktopFabrication } from './fabrication.js';

// Коэффициенты запаса
export const WASTE = {
  insulation: 1.05, // подрезка плит
  waterproofing: 1.25, // перехлёсты и заворот на стены
  mesh: 1.1, // перехлёст карт
  pipe: 1.08, // запас на подводки и ошибки
  sandCompaction: 1.15, // насыпной объём против уплотнённого
  gravelCompaction: 1.2
};

// Плотности и нормы расхода
export const RATES = {
  screedDensity: 2000, // кг/м³ цементно-песчаной стяжки
  cementPerM3: 400, // кг цемента М500 на 1 м³ раствора М300
  sandPerM3: 1.1, // м³ песка на 1 м³ раствора
  fibrePerM3: 0.9, // кг полипропиленовой фибры
  plasticiserPerCement: 0.01, // л на кг цемента
  tiesPerMetre: 2, // хомутов на погонный метр трубы
  bagCement: 25, // кг в мешке
  meshSheet: 6, // м² в карте 2 × 3
  insulationSheet: 0.684 // м² в плите 1180 × 580
};

const up = (v) => Math.ceil(v);

// Позиции электрики. Кабель берётся из посчитанных трасс, приборы —
// из фактически расставленных точек, а не из головы.
function electricalItems(electrical) {
  if (!electrical?.points?.length) return [];

  const byId = electrical.points.reduce((acc, p) => {
    acc[p.catalogId] = (acc[p.catalogId] ?? 0) + 1;
    return acc;
  }, {});

  const cable = electrical.byCircuit.reduce(
    (acc, g) => {
      const key = g.cable === '3×1,5' ? 'light' : 'power';
      acc[key] += g.cableM;
      return acc;
    },
    { light: 0, power: 0 }
  );

  const socketCount =
    (byId.socket2 ?? 0) + (byId.socket4 ?? 0) + (byId.socket_app ?? 0);
  const switchCount = (byId.switch1 ?? 0) + (byId.switch2 ?? 0);
  const wayCount = byId.switch_way ?? 0;
  const way2Count = byId.switch2_way ?? 0;
  const boxes = socketCount + switchCount + wayCount + way2Count;

  return [
    {
      group: 'Электрика', name: 'Кабель ВВГнг-LS 3×2,5', price: 'cable_25',
      qty: cable.power * 1.1, unit: 'м', note: 'силовые группы, с запасом 10 %'
    },
    {
      group: 'Электрика', name: 'Кабель ВВГнг-LS 3×1,5', price: 'cable_15',
      qty: cable.light * 1.1, unit: 'м', note: 'освещение, с запасом 10 %'
    },
    {
      group: 'Электрика', name: 'Гофра', price: 'conduit',
      qty: electrical.inFloorM * 1.1, unit: 'м',
      note: 'ТОЛЬКО в стяжке. Свет идёт по перекрытию открыто, там гофры нет'
    },
    {
      group: 'Электрика', name: 'Подрозетник', price: 'back_box',
      qty: boxes, unit: 'шт', note: 'под каждую розетку и выключатель'
    },
    {
      group: 'Электрика', name: 'Коробка распределительная', price: 'junction_box',
      qty: Math.max(4, Math.ceil(boxes / 4)), unit: 'шт', note: 'по помещениям'
    },
    {
      group: 'Электрика', name: 'Розетка с рамкой', price: 'socket',
      qty: socketCount, unit: 'шт', note: `${byId.socket4 ?? 0} из них блоки на 4`
    },
    {
      group: 'Электрика', name: 'Розетка IP44', price: 'socket_ip44',
      qty: byId.socket_ip44 ?? 0, unit: 'шт', note: 'санузел'
    },
    {
      group: 'Электрика', name: 'Выключатель', price: 'switch',
      qty: switchCount, unit: 'шт', note: `${byId.switch2 ?? 0} двухклавишных`
    },
    {
      group: 'Электрика', name: 'Выключатель проходной', price: 'switch_way',
      qty: wayCount + 1, unit: 'шт', note: 'подсветка лестницы, плюс парный на мансарде'
    },
    {
      group: 'Электрика', name: 'Выключатель двухклавишный проходной', price: 'switch2_way',
      qty: way2Count, unit: 'шт',
      note: 'зал двумя группами из двух мест. Между самой парой нужны ЧЕТЫРЕ ' +
        'перекидные жилы плюс земля: либо 5×1,5, либо два кабеля 3×1,5'
    },
    {
      group: 'Электрика', name: 'Автомат модульный', price: 'breaker',
      qty: electrical.breakers, unit: 'шт',
      note: electrical.byCircuit
        .map((g) => `${g.label} ${g.breaker} А`)
        .join(', ')
    },
    {
      group: 'Электрика', name: 'УЗО / дифавтомат', price: 'rcd',
      qty: electrical.byCircuit.filter((g) => g.rcd).length, unit: 'шт',
      note: 'на все розеточные группы; санузел со стиральной — 10 мА, остальные 30'
    },
    {
      group: 'Электрика', name: 'Щиток внутренний', price: 'panel_box',
      qty: 1, unit: 'шт', note: 'основной щит снаружи, этот распределительный'
    },
    {
      group: 'Освещение', name: 'Светильник накладной с плафоном', price: 'light_plafond',
      qty: byId.light ?? 0, unit: 'шт', note: 'общий свет, угол 110°'
    },
    {
      group: 'Освещение', name: 'Спот поворотный', price: 'light_spot',
      qty: byId.light_work ?? 0, unit: 'шт', note: 'рабочий свет кухни, угол 30°'
    },
    {
      group: 'Освещение', name: 'Подвес над столом', price: 'light_pendant',
      qty: byId.light_pendant ?? 0, unit: 'шт', note: '750–800 над столешницей'
    }
  ].filter((i) => i.qty > 0);
}

// Лестница на двух стальных косоурах. Всё считается из геометрии марша:
// поменяли ширину или проекцию — пересчитался металл, крепёж и зашивка.
export const STAIR_STEEL = {
  // Профтруба 120×60×4 выбрана по ПРОГИБУ, а не по прочности.
  // Прочности хватало и 100×50×3 (W = 20,6 против нужных 14,1 см³),
  // но прогиб выходил 26 мм — лестница пружинила бы под ногой.
  // При I = 219 см⁴ прогиб 15,6 мм, то есть L/295. Это уже спокойно.
  stringer: { label: '120×60×4', Ix: 219, Wx: 41, kgPerM: 10.3 },
  // Площадки под ступени: два отрезка уголка на каждую ступень
  platformLen: 0.25,
  boltsPerTread: 4
};

export function stairItems(stair) {
  if (!stair) return [];

  const f = stairFabrication(stair);
  const run = stair.length; // проекция, м
  const rise = stair.totalRise; // подъём, м
  const steps = f.treads;
  const width = stair.width;
  const slope = f.stringers.cutLen / 1000; // длина марша по поручню

  // Зашивка сбоку: треугольник от нижней ступени до грани санузла
  const boxRun = Math.min(run, 2.6);
  const boxHeight = boxRun * (rise / run);
  const boxArea = (boxRun * boxHeight) / 2 + width * boxHeight * 0.5;

  return [
    {
      group: 'Лестница', name: `Профтруба ${f.stringers.label} — косоуры`,
      price: 'tube_120x60', qty: f.stockBars * 6, unit: 'м',
      note: `рез ${f.stringers.cutLen.toFixed(0)} мм × ${f.stringers.count} = ` +
        `${f.stringers.totalM.toFixed(2)} м из ${f.stockBars} хлыстов по 6 м. ` +
        'Сечение по ПРОГИБУ: L/295, а не по прочности'
    },
    {
      group: 'Лестница', name: `Уголок ${f.platforms.label} — площадки под ступени`,
      price: 'angle_63', qty: f.platforms.totalM * 1.1, unit: 'м',
      note: `${f.platforms.count} отрезков по ${f.platforms.len} мм, по два на ступень`
    },
    {
      group: 'Лестница', name: 'Лист 4 мм — треугольные косынки',
      price: 'steel_sheet4', qty: f.gusset.areaM2 * 1.25 + 0.11, unit: 'м²',
      note: `${f.gusset.count} треугольников ${f.gusset.base.toFixed(0)} × ` +
        `${f.gusset.height.toFixed(0)} (катеты = проступь и подступенок), ` +
        `${f.gusset.massKg.toFixed(0)} кг. Плюс пятки и верхние накладки`
    },
    {
      group: 'Лестница', name: 'Закладная под пятку косоура 250×120×6',
      price: 'embed_stair', qty: f.stringers.count, unit: 'шт',
      note: 'труба режется ГОРИЗОНТАЛЬНО и варится по всему периметру реза. ' +
        'СТАВИТЬ ДО ЗАЛИВКИ: в стяжку с трубой ТП сверлить нельзя'
    },
    {
      group: 'Лестница', name: 'Болт М12 сквозной — верхний узел',
      price: 'bolt_m12', qty: 6, unit: 'шт',
      note: 'перекрытие ДЕРЕВЯННОЕ — сквозной болт с широкой шайбой, а не анкер. ' +
        'Узел зависит от ригеля проёма: направление балок и опирание НЕ ЗАМЕРЕНЫ'
    },
    {
      group: 'Лестница', name: 'Грунт-эмаль по металлу',
      price: 'metal_paint', qty: 1.5, unit: 'л',
      note: 'два слоя по всему каркасу, включая скрытые грани'
    },
    {
      group: 'Лестница', name: 'Болт М8×60 с гайкой и шайбами',
      price: 'bolt_m8', qty: steps * STAIR_STEEL.boltsPerTread, unit: 'шт',
      note: `${STAIR_STEEL.boltsPerTread} на ступень, снизу через уголок в проступь`
    },
    {
      group: 'Лестница', name: 'Прокладка резиновая под ступень',
      price: 'rubber_pad', qty: steps * STAIR_STEEL.boltsPerTread, unit: 'шт',
      note: 'ГЛАВНОЕ против скрипа и ударного шума: дерево не касается стали'
    },
    {
      group: 'Лестница', name: 'Клей столярный D3 — склейка проступей',
      price: 'wood_glue', qty: 1.5, unit: 'кг',
      note: 'доска пола идёт в дело, но шпунт срезать и кромки отфуговать'
    },
    {
      group: 'Лестница', name: 'Фанера 3 мм на пласть проступей',
      price: 'ply3', qty: steps * width * 0.28 * 1.2, unit: 'м²',
      note: 'НЕ доводить до переднего канта: там она отслоится от ног'
    },
    {
      group: 'Лестница', name: 'Фанера 12 мм — подступенки',
      price: 'ply12', qty: steps * width * 0.2 * 1.15, unit: 'м²',
      note: 'закрывают кладовую от пыли и вида через ступени'
    },
    {
      group: 'Лестница', name: 'Масло или лак по дереву',
      price: 'wood_oil', qty: 1.5, unit: 'л',
      note: 'матовое с противоскользящей добавкой — лак скользит'
    },
    {
      group: 'Лестница', name: 'ГКЛ 12,5 — зашивка сбоку и кладовая',
      price: 'gkl', qty: boxArea * 1.2, unit: 'м²',
      note: 'боковая стенка марша и фронт кладовой'
    },
    {
      group: 'Лестница', name: 'Профиль каркаса зашивки',
      price: 'gkl_frame', qty: boxArea * 3, unit: 'м',
      note: 'обрешётка под ГКЛ по косоуру'
    },
    {
      group: 'Лестница', name: 'Дверца кладовой под маршем',
      price: 'cupboard_door', qty: 2, unit: 'шт',
      note: 'доступ к стиральной машине и хранению'
    },
    {
      group: 'Лестница', name: 'Поручень деревянный',
      price: 'handrail', qty: slope * 1.1, unit: 'м',
      note: 'марш закрыт с двух сторон, поэтому балясины не нужны — только поручень'
    },
    {
      group: 'Лестница', name: 'Кронштейн поручня',
      price: 'handrail_bracket', qty: 4, unit: 'шт',
      note: 'шаг не более 1,2 м'
    }
  ];
}

// Щиты: ввод, распределение и бесперебойник. Считается из calc/panel.js,
// поэтому состав не может разойтись со схемой.
function panelItems(plan) {
  if (!plan) return [];

  // Аппараты считаются ПО ФАКТУ состава щита, а не одной строкой «дифавтоматы»:
  // санузлу нужно 10 мА, и стоит он заметно дороже тридцати.
  const groups = plan.indoor.devices.filter((d) => d.circuit);
  const rcbo30 = groups.filter((d) => d.rcdMa === 30 && d.rating === 16);
  const rcbo10 = groups.filter((d) => d.rcdMa === 10);
  const rcboSmall = groups.filter((d) => d.rcdMa === 30 && d.rating < 16);
  const plain = groups.filter((d) => !d.rcdMa);

  const rows = [
    {
      group: 'Щиты', name: 'Щит на 24 модуля, внутренний', price: 'panel_24',
      qty: 1, unit: 'шт',
      note: `занято ${plan.indoor.used}, свободно ${plan.indoor.free}. Вся группировка ` +
        'уезжает с улицы внутрь: электронные дифавтоматы работают от −25 °C, ' +
        'а расчётная наружная −27'
    },
    {
      group: 'Щиты', name: 'Выключатель нагрузки 2P 40 А', price: 'isolator_2p',
      qty: 1, unit: 'шт', note: 'ввод щита: обесточить дом, не выходя на улицу'
    },
    {
      group: 'Щиты', name: 'Дифавтомат C16 / 30 мА', price: 'rcbo_30ma',
      qty: rcbo30.length, unit: 'шт',
      note: rcbo30.map((d) => d.label.split(' — ')[0]).join(', ') +
        '. По одному на группу, а не общее УЗО на всех: дом подолгу пустой, ' +
        'и «выбило одно — погасло всё» дороже разницы в цене'
    },
    {
      group: 'Щиты', name: 'Дифавтомат C16 / 10 мА', price: 'rcbo_10ma',
      qty: rcbo10.length, unit: 'шт',
      note: 'санузел и стиральная — мокрая зона, там 10 мА, а не общие 30'
    },
    {
      group: 'Щиты', name: 'Дифавтомат C6 / 30 мА', price: 'rcbo_30ma',
      qty: rcboSmall.length, unit: 'шт',
      note: 'котёл через ИБП. Номинал 6 А, потому что за ним всего 130 Вт'
    },
    {
      group: 'Щиты', name: 'Автомат C10 на свет', price: 'breaker',
      qty: plain.length, unit: 'шт',
      note: 'без УЗО намеренно: при аварии в розетках свет остаётся, ' +
        'а в пустом доме это важнее'
    },
    {
      group: 'Щиты', name: 'Реле напряжения с автовозвратом', price: 'voltage_relay',
      qty: 1, unit: 'шт',
      note: 'ЗАМЕНА РММ47 в уличном щите. Тот сбрасывает автомат и оставляет ' +
        'выключенным до ручного взвода. Менять НЕ срочно: делается тем же ' +
        'заходом, что и сборка щита'
    },
    {
      group: 'Щиты', name: 'УЗО 2P 63 А / 300 мА тип S', price: 'rcd_300s',
      qty: 1, unit: 'шт',
      note: 'ДОКУПИТЬ в уличный щит. Тип S обязателен: без выдержки времени ' +
        'выбивало бы вместе с групповыми 30 мА. Встаёт на три модуля, ' +
        'освободившиеся от снятых групповых аппаратов'
    },
    {
      group: 'Щиты', name: 'Кабель ВВГнг-LS 3×6 от уличного щита', price: 'cable_6',
      qty: 10, unit: 'м', note: 'ввод в дом, до щита в прихожей'
    },
    {
      group: 'Щиты', name: 'ИБП Штиль SW500L 500 ВА / 400 Вт', price: 'ups_sw500l',
      qty: 1, unit: 'шт',
      note: 'online, чистая синусоида, ЗУ 5 А, шина 24 В. Выход — ОДНА розетка ' +
        'Schuko, отсюда и щиток после него. Только в помещении: от +5 °C'
    },
    {
      group: 'Щиты', name: 'АКБ AGM 12 В 100 А·ч', price: 'agm_100',
      qty: 2, unit: 'шт',
      note: 'две в серию на шину 24 В. Ампер-часы при этом НЕ удваиваются: ' +
        'банк остаётся 100 А·ч. Автономия 12,9 ч, заряд обратно 24 ч'
    },
    {
      group: 'Щиты', name: 'Полка-стойка под АКБ на стяжку', price: 'battery_rack',
      qty: 1, unit: 'шт',
      note: 'ниша под окном прихожей 900 × 1100. Опирать на стяжку, а не вешать ' +
        'на газобетон: 60 кг. Зазор от пола — под батареями тёплый пол, ' +
        'а срок службы AGM на каждые +10 °C падает вдвое'
    }
  ];
  return rows.filter((r) => r.qty > 0);
}

// Аварийное питание. Всё, что стоит ПОСЛЕ ИБП, плюс автономный свет,
// который к ИБП вообще не относится. Сам ИБП и батареи сюда не входят:
// модель не выбрана, а придумывать цену за заказчика нельзя.
function emergencyItems(ep) {
  if (!ep) return [];
  return [
    {
      group: 'Аварийное питание', name: 'Бокс DIN на 8 модулей', price: 'panel_din8',
      qty: 1, unit: 'шт',
      note: `у ИБП на выходе ОДНА розетка Schuko, а веток ${ep.branches.length}. ` +
        `Занято ${ep.modulesUsed} модулей, ${ep.modulesFree} в запасе`
    },
    {
      group: 'Аварийное питание', name: 'Автомат 6 А на ветку', price: 'breaker',
      qty: ep.branches.filter((b) => !b.rcd).length, unit: 'шт',
      note: 'котёл, роутер, свет котельной — каждый свой, чтобы авария ' +
        'в одной ветке не доходила до остальных'
    },
    {
      group: 'Аварийное питание', name: `Автомат B${ep.socket.rating} А на розетку`,
      price: 'breaker_b1', qty: 1, unit: 'шт',
      note: `подобран НЕ по кабелю, а по остатку инвертора: ${ep.socket.spareW} Вт = ` +
        `${ep.socket.spareA.toFixed(2)} А. Пропускает зарядку и ноутбук, чайник ` +
        'отсекает мгновенно. Характеристика B, не C'
    },
    {
      group: 'Аварийное питание', name: 'Дифавтомат 10 мА на розетку', price: 'rcbo_10ma',
      qty: 1, unit: 'шт',
      note: 'единственная ветка с неизвестным содержимым — ловит утечку ' +
        'сама, не тревожа общее УЗО котла'
    },
    {
      group: 'Аварийное питание', name: 'Светильник класса II над котлом',
      price: 'light_classii', qty: 1, unit: 'шт',
      note: 'заземляемых частей нет — утечку на землю создать не может'
    },
    {
      group: 'Аварийное питание', name: 'Розетка аварийная с маркировкой',
      price: 'socket_marked', qty: 1, unit: 'шт',
      note: 'отдельный цвет и надпись: не чайник'
    },
    {
      group: 'Аварийное питание', name: 'Кабель ВВГнг-LS 3×1,5 на ветки',
      price: 'cable_15', qty: 18, unit: 'м',
      note: 'щиток → свет котельной, → аварийная розетка в зале, с запасом'
    },
    {
      group: 'Аварийное питание', name: 'Светильник с БАП', price: 'light_bap',
      qty: 3, unit: 'шт',
      note: 'лестница, зал и площадка мансарды. НЕ от ИБП: свой аккумулятор, ' +
        'обычная линия освещения, зажигается сам. Кабель через дом не нужен'
    }
  ];
}

// Слаботочка. Отдельной группой, потому что живёт по своим правилам:
// в стяжку не идёт, автоматов не занимает, и половина её — задел на будущее.
function lowVoltageItems(lv) {
  if (!lv) return [];
  const utp = lv.utpM * 1.05;
  return [
    {
      group: 'Слаботочка', name: 'Кабель UTP cat.6, медь', price: 'utp_cat6',
      qty: utp, unit: 'м',
      note: `${lv.utpLinks} линии: приставка, телевизор, точка доступа мансарды, ` +
        'входная дверь. ТОЛЬКО медь — омеднённый алюминий не тянет PoE и ломается'
    },
    {
      group: 'Слаботочка', name: 'Гофра Ø20 с протяжкой', price: 'conduit20',
      qty: lv.conduitM, unit: 'м',
      note: 'по перекрытию, НЕ в стяжке. Гофра тут не про огонь, а про то, ' +
        'чтобы через десять лет перетянуть кабель, не вскрывая дом'
    },
    {
      group: 'Слаботочка', name: 'Розетка RJ45 двойная', price: 'rj45_socket',
      qty: 1, unit: 'шт', note: 'за телевизором: приставка и сам телевизор'
    },
    {
      group: 'Слаботочка', name: 'Модуль RJ45 / коннектор', price: 'rj45_keystone',
      qty: lv.utpLinks * 2, unit: 'шт', note: 'по два на линию, с обоих концов'
    },
    {
      group: 'Слаботочка', name: 'Патч-корд', price: 'patch_cord',
      qty: 4, unit: 'шт', note: 'роутер — розетки, приставка — розетка'
    },
    {
      group: 'Слаботочка', name: 'Акустический кабель 2×2,5', price: 'speaker_cable',
      qty: 16, unit: 'м',
      note: 'ЗАДЕЛ под стерео: две колонки по бокам от телевизора, ' +
        'в гофре внутри зашивки марша. Тянуть до заделки ГКЛ'
    }
  ];
}

// Бетонная столешница на стальном каркасе по закладным.
// Объёмы выводятся из фронта, а не задаются руками: двинули посудомойку —
// пересчиталось всё, включая число стоек.
function worktopItems(worktop, screed) {
  if (!worktop) return [];
  const f = worktopFabrication(worktop, screed);
  const massKg = f.slabMassKg;

  return [
    {
      group: 'Столешница', name: 'Смесь и арматура для заливки', price: 'worktop_concrete',
      qty: worktop.area, unit: 'м²',
      note: `${f.slabT.toFixed(0)} мм по стальному каркасу, масса плиты ≈ ${massKg.toFixed(0)} кг, ` +
        `на стойку ${f.loadPerPostKg.toFixed(0)} кг`
    },
    {
      group: 'Столешница', name: `Уголок ${f.angle.label} — рама и стойки`,
      price: 'worktop_frame', qty: f.angleTotalM * 1.08, unit: 'м',
      note: `продольные ${f.longitudinalM.toFixed(1)} + поперечины ${f.crossM.toFixed(1)} + ` +
        `стойки ${f.postM.toFixed(1)}. ${f.frontPosts} спереди шагом ${f.framePitch} ` +
        `и ${f.backPosts} сзади шагом ${f.backPitch}, все по ${f.postLen.toFixed(0)} мм`
    },
    {
      group: 'Столешница', name: 'Закладная пластина под стойки столешницы',
      price: 'embed_plate', qty: 16, unit: 'шт',
      note: `нужно ${f.embed.count} (${f.frontPosts} спереди + ${f.backPosts} сзади), ` +
        'берём 16 С ИЗБЫТКОМ: закладная стоит 275 ₽, а выбор задней опоры ' +
        'можно отложить — она ставится ДО ЗАЛИВКИ, решение принимается потом'
    },
    {
      group: 'Столешница', name: 'Зашивка стойки ЛДСП', price: 'worktop_post',
      qty: f.posts, unit: 'шт',
      note: 'стойки встают на стык секций, где сходятся боковины шкафов'
    },
    {
      group: 'Столешница', name: 'Пропитка для бетона', price: 'worktop_seal',
      qty: Math.max(1, worktop.area / 8), unit: 'л',
      note: 'бетон на кухне без пропитки берёт пятна от вина и масла необратимо'
    }
  ];
}

// Обвязка котельной. Здесь только то, чего НЕТ внутри котла:
// насос, расширительный бак и группа безопасности встроены, и половина
// типовых схем из интернета дублирует их зря.
function boilerRoomItems(plan, coolant) {
  if (!plan) return [];

  const items = [
    {
      group: 'Котельная', name: 'Кран шаровой 3/4" с американкой', price: 'ball_valve_20',
      qty: 4, unit: 'шт',
      note: '2 на котёл + 2 на коллектор: снимается любой узел без слива системы'
    },
    {
      group: 'Котельная', name: 'Фильтр косой сетчатый 3/4"', price: 'strainer_20',
      qty: 1, unit: 'шт',
      note: 'на ОБРАТКЕ перед котлом. Стяжка новая — окалины и мусора будет много'
    },
    {
      group: 'Котельная', name: 'Термометр накладной 0–80 °C', price: 'thermometer',
      qty: 2, unit: 'шт',
      note: 'подача и обратка коллектора. По разнице видно, работает ли контур'
    },
    {
      group: 'Котельная', name: 'Термостат аварийный накладной, 55 °C', price: 'safety_stat',
      qty: 1, unit: 'шт',
      note: 'ВТОРАЯ защита стяжки: при прямом подключении между котлом и бетоном ' +
        'нет ничего, кроме параметра F06'
    },
    {
      group: 'Котельная', name: 'Датчик наружной температуры', price: 'outdoor_sensor',
      qty: 1, unit: 'шт',
      note: 'без него погодозависимая кривая Kt не работает вообще'
    },
    {
      group: 'Котельная', name: 'Труба подводки 3/4" с фитингами', price: 'pipe_20',
      qty: 3, unit: 'м',
      note: `котёл — коллектор, 700 мм по стене; скорость ${plan.connection.velocity.toFixed(2)} м/с`
    }
  ];

  // Подпитка. С ядовитым гликолем связь с водопроводом недопустима,
  // и вода вдобавок разбавляет состав — значит подпитка только ручная.
  if (plan.toxic) {
    items.push({
      group: 'Котельная', name: 'Насос опрессовочный ручной с баком', price: 'test_pump',
      qty: 1, unit: 'шт',
      note: 'разрывная подпитка ГОТОВОЙ смесью. Встроенный кран от ГВС заглушить'
    });
  }

  // Замена просроченного теплоносителя. Считаем только первый этаж —
  // объём мансардного контура неизвестен, он добавится сверху.
  const conc = coolant?.dilution?.find((d) => d.freeze <= -30) ?? coolant?.dilution?.[1];
  if (conc && coolant?.expired !== false) {
    const litres = plan.volume.totalL * (conc.concentrate / 100);
    items.push({
      group: 'Котельная', name: 'Антифриз-концентрат на замену', price: 'coolant_conc',
      qty: litres, unit: 'л',
      note: `${conc.concentrate} % концентрата на ${conc.water} % воды = ${conc.freeze} °C. ` +
        `Система первого этажа ${plan.volume.totalL.toFixed(0)} л; мансардный контур сверху`
    });
  }

  return items;
}

export function floorEstimate({
  layout, screed, levels, loops, coolant, electrical, stair, boilerRoom, equipment,
  lowVoltage, emergency, panel
}) {
  const rooms = buildRooms(layout);
  const area = rooms.reduce((s, r) => s + polygonArea(r.polygon), 0);

  // Периметр наружных стен изнутри + суммарная длина перегородок:
  // по ним идёт демпферная лента
  const walls = buildWalls(layout);
  const outerPerimeter = 2 * (INNER_W + INNER_D);
  const partitions = walls
    .filter((w) => w.kind === 'partition')
    .reduce((s, w) => s + wallVector(w).len, 0);
  const damperLength = outerPerimeter + partitions;

  // Засыпка и подготовка
  const sandInPlace = (levels.sandFill / 1000) * area;
  const gravelInPlace = (screed.gravel / 1000) * area;

  // Стяжка за вычетом объёма трубы
  const pipeMetres = loops.totalPipe * WASTE.pipe;
  const pipeVolume = loops.totalPipe * Math.PI * (screed.pipeOd / 2000) ** 2;
  const screedVolume = (screed.screedTotal / 1000) * area - pipeVolume;
  const cementKg = screedVolume * RATES.cementPerM3;

  // Утепление торца плиты по внутренней грани фундамента.
  // Профиль ступенчатый: толстый ЭППС только НИЖЕ стяжки, на её высоте —
  // демпферная лента. Поэтому площадь плиты считается не на всю глубину.
  const screedBandMm = screed.screedTotal + screed.finishThickness;
  const edgeArea = levels.edgeInsulation > 0
    ? ((levels.edgeInsulationDepth - screedBandMm) / 1000) * outerPerimeter
    : 0;

  const items = [
    {
      group: 'Основание',
      name: 'Песок для засыпки подполья',
      price: 'sand_fill',
      qty: sandInPlace * WASTE.sandCompaction,
      unit: 'м³',
      note: `${levels.sandFill} мм в уплотнённом виде, ${up(levels.sandFill / levels.compactLayer)} слоя`
    },
    {
      group: 'Основание',
      name: 'Щебень фракция 20–40',
      price: 'gravel',
      qty: gravelInPlace * WASTE.gravelCompaction,
      unit: 'м³',
      note: `${screed.gravel} мм подготовки`
    },
    {
      group: 'Основание',
      name: 'Песок мытый на выравнивающую подсыпку',
      price: 'sand_washed',
      qty: ((screed.sandBed ?? 0) / 1000) * area * WASTE.sandCompaction,
      unit: 'м³',
      note: `${screed.sandBed ?? 0} мм поверх щебня — защита плёнки от острых граней`
    },
    {
      group: 'Основание',
      name: 'Гидроизоляция плёночная 200 мкм',
      price: 'film',
      qty: area * WASTE.waterproofing,
      unit: 'м²',
      note: 'с перехлёстом и заворотом на стены'
    },
    {
      group: 'Утепление',
      name: `ЭППС ${screed.insulation - screed.insulationReused} мм плитами`,
      price: 'xps_field',
      qty: area * WASTE.insulation,
      unit: 'м²',
      note: `≈ ${up((area * WASTE.insulation) / RATES.insulationSheet)} плит 1180 × 580`
    },
    {
      group: 'Утепление',
      name: `ЭППС ${levels.edgeInsulation || 80} мм на торец плиты`,
      price: 'xps_edge',
      qty: edgeArea || (0.5 * outerPerimeter),
      unit: 'м²',
      note: `полоса ${(levels.edgeInsulationDepth - screedBandMm).toFixed(0)} мм ` +
        `от низа стяжки вниз, по внутренней грани фундамента, ДО засыпки. ` +
        `Выше — только лента: 100 мм плиты у чистого пола отняли бы полосу комнаты`
    },
    {
      group: 'Утепление',
      name: 'Клей-пена для ЭППС',
      price: 'foam_glue',
      qty: Math.max(3, (edgeArea || 11) / 4),
      unit: 'баллон',
      note: 'крепление торцевых плит к фундаменту'
    },
    {
      group: 'Утепление',
      name: `Демпферная лента ${levels.edgeStrip ?? 10} мм, высота 100`,
      price: 'damper_tape',
      qty: damperLength * 1.1,
      unit: 'м',
      note: 'по периметру и вдоль всех перегородок. Она же — верхняя ступень ' +
        'торцевого разрыва: подрезается ПОСЛЕ укладки керамогранита, уходит под плинтус'
    },
    {
      group: 'Тёплый пол',
      name: `Труба сшитый полиэтилен ${screed.pipeOd} × 2,0`,
      price: 'pex16',
      qty: pipeMetres,
      unit: 'м',
      note: 'каждая петля — ЦЕЛЬНЫЙ кусок без соединений в стяжке'
    },
    {
      group: 'Тёплый пол',
      name: 'Сетка сварная 100 × 100 × 4',
      price: 'mesh',
      qty: area * WASTE.mesh,
      unit: 'м²',
      note: `≈ ${up((area * WASTE.mesh) / RATES.meshSheet)} карт 2 × 3 м. ` +
        'Ячейка выбрана как армирование, а не под шаг трубы: труба вяжется ' +
        'к поперечным прутьям и ложится с любым шагом'
    },
    {
      group: 'Тёплый пол',
      name: 'Хомуты нейлоновые 200 мм',
      price: 'ties',
      qty: pipeMetres * RATES.tiesPerMetre,
      unit: 'шт',
      note: 'крепление трубы к сетке, а не гарпунами'
    },
    {
      group: 'Тёплый пол',
      name: `Коллектор на ${loops.totalLoops} контуров`,
      price: 'manifold',
      qty: 1,
      unit: 'компл.',
      note: 'с расходомерами и балансировочными клапанами — разбаланс длин велик'
    },
    {
      group: 'Тёплый пол',
      name: 'Евроконус 16 мм',
      price: 'eurocone',
      qty: loops.totalLoops * 2,
      unit: 'шт',
      note: 'подача и обратка на каждый контур'
    },
    {
      group: 'Тёплый пол',
      name: 'Шкаф коллекторный',
      price: 'manifold_box',
      qty: 1,
      unit: 'шт',
      note: 'встроенный, в прихожей'
    },
    // Циркуляционный насос ИСКЛЮЧЁН: паспортный график насоса котла дал
    // 4,81 м при 345 л/ч, располагаемый 4,21 против требуемых 1,19 —
    // кратность 3,5. Паспорт вдобавок требует ставить дополнительный насос
    // только после гидроразделителя, которого в схеме нет.
    // Аварийный термостат переехал в группу «Котельная» — он часть цепи
    // защиты котла, а не раскладки петель.
    {
      group: 'Стяжка',
      name: 'Цемент М500',
      price: 'cement',
      qty: cementKg,
      unit: 'кг',
      note: `≈ ${up(cementKg / RATES.bagCement)} мешков по ${RATES.bagCement} кг`
    },
    {
      group: 'Стяжка',
      name: 'Песок мытый для раствора',
      price: 'sand_washed',
      qty: screedVolume * RATES.sandPerM3,
      unit: 'м³',
      note: 'раствор М300'
    },
    {
      group: 'Стяжка',
      name: 'Фибра полипропиленовая 12 мм',
      price: 'fibre',
      qty: screedVolume * RATES.fibrePerM3,
      unit: 'кг',
      note: 'против усадочных трещин'
    },
    {
      group: 'Стяжка',
      name: 'Пластификатор для тёплого пола',
      price: 'plasticiser',
      qty: cementKg * RATES.plasticiserPerCement,
      unit: 'л',
      note: 'обязателен: стяжка над трубой'
    },
    {
      group: 'Стяжка',
      name: 'Профиль деформационного шва',
      price: 'joint_profile',
      qty: damperLength * 0.3,
      unit: 'м',
      note: 'в проёмах и по границам зон'
    }
  ];

  const all = [
    ...items,
    ...electricalItems(electrical),
    ...stairItems(stair),
    ...boilerRoomItems(boilerRoom, coolant),
    ...worktopItems(equipment ? buildWorktop(layout, equipment) : null, screed),
    ...lowVoltageItems(lowVoltage),
    ...emergencyItems(emergency),
    ...panelItems(panel)
  ];

  // Стоимость по трём границам. Позиция без цены в прайсе честно помечается
  // как непосчитанная, а не считается нулём в итоге.
  const priced = all.map((i) => ({
    ...i,
    cost: lineCost(i.qty, i.price),
    pack: packOf(i.price, i.qty)
  }));

  const totals = priced.reduce(
    (t, i) => {
      t.min += i.cost.min;
      t.avg += i.cost.avg;
      t.max += i.cost.max;
      if (!i.cost.priced) t.unpriced.push(i.name);
      return t;
    },
    { min: 0, avg: 0, max: 0, unpriced: [] }
  );

  const groups = [...new Set(priced.map((i) => i.group))];
  const byGroup = groups.map((g) => {
    const rows = priced.filter((i) => i.group === g);
    return {
      group: g,
      rows,
      min: rows.reduce((s, i) => s + i.cost.min, 0),
      avg: rows.reduce((s, i) => s + i.cost.avg, 0),
      max: rows.reduce((s, i) => s + i.cost.max, 0)
    };
  });

  return {
    area,
    outerPerimeter,
    damperLength,
    screedVolume,
    screedMassKg: screedVolume * RATES.screedDensity,
    pipeMetres,
    items: priced,
    groups,
    byGroup,
    totals,
    meta: PRICEBOOK_META
  };
}

// Как нарезать трубу из бухт, чтобы каждая петля была цельной.
// Жадный алгоритм: кладём самые длинные петли первыми.
export function pipeCutting(loopLengths, coilSizes = [200, 100, 50]) {
  const need = [...loopLengths].sort((a, b) => b - a);
  const coils = [];

  need.forEach((len) => {
    const fit = coils.find((c) => c.left >= len);
    if (fit) {
      fit.left -= len;
      fit.cuts.push(len);
    } else {
      const size = coilSizes.find((s) => s >= len) ?? coilSizes[0];
      coils.push({ size, left: size - len, cuts: [len] });
    }
  });

  // Ужимаем каждую бухту до наименьшего размера, в который влезли её куски:
  // раскладку вели по самой большой, но покупать столько не обязательно.
  const sizes = [...coilSizes].sort((a, b) => a - b);
  const fitted = coils.map((c) => {
    const used = c.cuts.reduce((s, v) => s + v, 0);
    const size = sizes.find((s) => s >= used) ?? c.size;
    return { size, cuts: c.cuts, left: size - used };
  });

  return {
    coils: fitted,
    totalOrdered: fitted.reduce((s, c) => s + c.size, 0),
    waste: fitted.reduce((s, c) => s + c.left, 0)
  };
}
