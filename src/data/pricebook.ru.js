// Прайс материалов, ₽ за единицу. Средняя полоса России.
//
// ЭТО ШАБЛОН, А НЕ АКТУАЛЬНЫЕ РЫНОЧНЫЕ ЦЕНЫ.
// Диапазоны взяты как ориентир порядка величины: нижняя граница — эконом
// и самовывоз, верхняя — известный бренд с доставкой. Реальная цена зависит
// от региона, объёма, сезона и поставщика.
//
// Считать по ним можно бюджет, но НЕ договор. Перед закупкой заменить
// на свои котировки: цифры правятся здесь одним файлом.
//
// Работы сюда НЕ входят — только материалы.

export const PRICEBOOK_META = {
  currency: '₽',
  region: 'Средняя полоса РФ',
  updated: '2026-08',
  verified: false,
  source: 'Часть позиций сверена с каталогом Лемана ПРО (август 2026)',
  disclaimer:
    'Ориентировочные диапазоны, не котировки. Позиции с пометкой checked ' +
    'сверены по каталогу, остальные — оценка порядка величины. ' +
    'Заменить на цены своих поставщиков перед закупкой.'
};

export const PRICES = {
  // --- Основание ---
  sand_fill: { min: 800, max: 1800, unit: 'м³', label: 'Песок карьерный с доставкой' },
  sand_washed: { min: 1200, max: 2500, unit: 'м³', label: 'Песок мытый' },
  gravel: { min: 2000, max: 3800, unit: 'м³', label: 'Щебень 20–40' },
  film: { min: 25, max: 60, unit: 'м²', label: 'Плёнка 200 мкм' },

  // --- Утепление ---
  // СВЕРЕНО: Лемана ПРО, плита 585×1185 = 0,69 м².
  // Укна Т-15 — 758 ₽/плита → 1099 ₽/м². Пеноплэкс Фундамент — 858 → 1243 ₽/м².
  // Прежняя оценка 450–900 была ЗАНИЖЕНА вдвое.
  xps_field: { min: 1050, max: 1300, unit: 'м²', label: 'ЭППС 100 мм', checked: true },
  // Цоколь — ТОТ ЖЕ материал 100 мм. В рознице ходовые толщины 50 и 100,
  // 80 мм почти не встречается. Цоколь ниже стяжки, площади не отнимает,
  // поэтому берём 100: одна позиция вместо двух, один завоз.
  xps_edge: { min: 1050, max: 1300, unit: 'м²', label: 'ЭППС 100 мм (цоколь)', checked: true },
  // Для справки, если решите тоньше: СВЕРЕНО, Лемана ПРО, 50 мм —
  // 244 ₽/плита 0,72 м² (Полимерпласт) … 357 ₽/плита 0,69 м² (Укна Прочный)
  xps_50: { min: 340, max: 520, unit: 'м²', label: 'ЭППС 50 мм', checked: true },
  foam_glue: { min: 500, max: 900, unit: 'баллон', label: 'Клей-пена' },
  damper_tape: { min: 25, max: 70, unit: 'м', label: 'Демпферная лента' },

  // --- Тёплый пол ---
  // СВЕРЕНО: Лемана ПРО, трубы для тёплого пола 16 мм — «от 77 ₽».
  // Нижняя граница подтвердилась, верхняя — Rehau и PE-Xa с кислородным барьером.
  pex16: { min: 77, max: 170, unit: 'м', label: 'Труба PEX 16×2,0', checked: true },
  mesh: { min: 180, max: 350, unit: 'м²', label: 'Сетка 100×100×4' },
  ties: { min: 1, max: 3, unit: 'шт', label: 'Хомут нейлоновый' },
  manifold: { min: 9000, max: 22000, unit: 'компл.', label: 'Коллектор с расходомерами' },
  eurocone: { min: 250, max: 600, unit: 'шт', label: 'Евроконус 16' },
  manifold_box: { min: 3500, max: 9000, unit: 'шт', label: 'Шкаф коллекторный' },
  safety_stat: { min: 1200, max: 3500, unit: 'шт', label: 'Термостат аварийный' },

  // --- Стяжка ---
  cement: { min: 8, max: 14, unit: 'кг', label: 'Цемент М500' },
  fibre: { min: 150, max: 400, unit: 'кг', label: 'Фибра полипропиленовая' },
  plasticiser: { min: 120, max: 350, unit: 'л', label: 'Пластификатор для ТП' },
  joint_profile: { min: 150, max: 400, unit: 'м', label: 'Профиль деформационного шва' },

  // --- Электрика ---
  // СВЕРЕНО: Лемана ПРО, ВВГ 3×2,5 ГОСТ — «от 127 ₽/м».
  // Прежняя оценка 60–130 была занижена: 127 это НИЖНЯЯ граница.
  cable_25: { min: 127, max: 210, unit: 'м', label: 'Кабель ВВГнг-LS 3×2,5', checked: true },
  cable_15: { min: 80, max: 140, unit: 'м', label: 'Кабель ВВГнг-LS 3×1,5' },
  conduit: { min: 25, max: 90, unit: 'м', label: 'Гофра / металлорукав' },
  back_box: { min: 15, max: 45, unit: 'шт', label: 'Подрозетник' },
  junction_box: { min: 40, max: 120, unit: 'шт', label: 'Коробка распределительная' },
  socket: { min: 200, max: 800, unit: 'шт', label: 'Розетка с рамкой' },
  socket_ip44: { min: 350, max: 1200, unit: 'шт', label: 'Розетка IP44' },
  switch: { min: 200, max: 900, unit: 'шт', label: 'Выключатель' },
  switch_way: { min: 350, max: 1400, unit: 'шт', label: 'Выключатель проходной' },
  switch2_way: { min: 600, max: 2200, unit: 'шт', label: 'Выключатель двухклавишный проходной' },
  breaker: { min: 250, max: 700, unit: 'шт', label: 'Автомат 16 А' },
  rcd: { min: 900, max: 3000, unit: 'шт', label: 'УЗО / дифавтомат' },
  panel_box: { min: 1200, max: 4000, unit: 'шт', label: 'Щиток внутренний' },

  // --- Щиты ---
  // СВЕРЕНО: ИБП по каталогу производителя (shtyl.ru) и по ЭТМ.
  ups_sw500l: { min: 24800, max: 30000, unit: 'шт', label: 'ИБП Штиль SW500L 500 ВА', checked: true },
  agm_100: { min: 12000, max: 20000, unit: 'шт', label: 'АКБ AGM 12 В 100 А·ч' },
  battery_rack: { min: 2000, max: 6000, unit: 'шт', label: 'Полка-стойка под АКБ на стяжку' },
  voltage_relay: { min: 2500, max: 7000, unit: 'шт', label: 'Реле напряжения с автовозвратом' },
  rcd_300s: { min: 2500, max: 7000, unit: 'шт', label: 'УЗО 2P 63 А / 300 мА тип S' },
  rcbo_30ma: { min: 1600, max: 4500, unit: 'шт', label: 'Дифавтомат C16 / 30 мА' },
  panel_24: { min: 2000, max: 6500, unit: 'шт', label: 'Щит на 24 модуля, внутренний' },
  isolator_2p: { min: 500, max: 1600, unit: 'шт', label: 'Выключатель нагрузки 2P 40 А' },
  cable_6: { min: 250, max: 420, unit: 'м', label: 'Кабель ВВГнг-LS 3×6' },

  // --- Аварийное питание ---
  panel_din8: { min: 700, max: 2200, unit: 'шт', label: 'Бокс DIN на 8 модулей' },
  breaker_b1: { min: 400, max: 1200, unit: 'шт', label: 'Автомат B1 А' },
  rcbo_10ma: { min: 1800, max: 5000, unit: 'шт', label: 'Дифавтомат 10 мА' },
  light_classii: { min: 900, max: 3000, unit: 'шт', label: 'Светильник класса II' },
  light_bap: { min: 2500, max: 7000, unit: 'шт', label: 'Светильник с БАП' },
  socket_marked: { min: 400, max: 1400, unit: 'шт', label: 'Розетка аварийная с маркировкой' },

  // --- Слаботочка ---
  utp_cat6: { min: 45, max: 130, unit: 'м', label: 'Кабель UTP cat.6, медь' },
  conduit20: { min: 30, max: 80, unit: 'м', label: 'Гофра Ø20 с протяжкой' },
  rj45_socket: { min: 350, max: 1100, unit: 'шт', label: 'Розетка RJ45 двойная' },
  rj45_keystone: { min: 90, max: 300, unit: 'шт', label: 'Модуль RJ45 / коннектор' },
  patch_cord: { min: 150, max: 450, unit: 'шт', label: 'Патч-корд' },
  speaker_cable: { min: 80, max: 400, unit: 'м', label: 'Акустический кабель 2×2,5' },
  light_plafond: { min: 1800, max: 6000, unit: 'шт', label: 'Светильник накладной' },
  light_spot: { min: 700, max: 2500, unit: 'шт', label: 'Спот поворотный' },
  light_pendant: { min: 2000, max: 9000, unit: 'шт', label: 'Подвес' },

  // --- Лестница ---
  tube_120x60: { min: 1000, max: 1600, unit: 'м', label: 'Профтруба 120×60×4' },
  angle_63: { min: 350, max: 600, unit: 'м', label: 'Уголок 63×63×5' },
  steel_sheet4: { min: 2800, max: 4700, unit: 'м²', label: 'Лист стальной 4 мм' },
  embed_plate: { min: 150, max: 400, unit: 'шт', label: 'Закладная пластина 100×100×5' },
  embed_stair: { min: 400, max: 900, unit: 'шт', label: 'Закладная под пятку косоура 250×120×6' },
  bolt_m12: { min: 40, max: 110, unit: 'шт', label: 'Болт М12 сквозной с шайбами' },
  metal_paint: { min: 400, max: 900, unit: 'л', label: 'Грунт-эмаль по металлу' },
  bolt_m8: { min: 15, max: 40, unit: 'шт', label: 'Болт М8×60 с гайкой и шайбами' },
  rubber_pad: { min: 5, max: 20, unit: 'шт', label: 'Прокладка резиновая' },
  anchor_m10: { min: 40, max: 120, unit: 'шт', label: 'Анкер М10' },
  ply3: { min: 170, max: 350, unit: 'м²', label: 'Фанера 3 мм ФК' },
  ply12: { min: 700, max: 1400, unit: 'м²', label: 'Фанера 12 мм ФК' },
  wood_glue: { min: 400, max: 900, unit: 'кг', label: 'Клей столярный D3' },
  wood_oil: { min: 700, max: 2000, unit: 'л', label: 'Масло / лак по дереву' },
  gkl: { min: 250, max: 450, unit: 'м²', label: 'ГКЛ 12,5 мм' },
  gkl_frame: { min: 90, max: 180, unit: 'м', label: 'Профиль каркаса' },
  handrail: { min: 400, max: 1200, unit: 'м', label: 'Поручень деревянный' },
  handrail_bracket: { min: 300, max: 900, unit: 'шт', label: 'Кронштейн поручня' },
  cupboard_door: { min: 2000, max: 6000, unit: 'шт', label: 'Дверца кладовой' },

  // --- Обвязка котельной ---
  // Всё, что внутри котла (насос, бак, группа безопасности), здесь
  // ОТСУТСТВУЕТ намеренно: оно уже куплено вместе с котлом.
  ball_valve_20: { min: 450, max: 1400, unit: 'шт', label: 'Кран шаровой 3/4" с американкой' },
  strainer_20: { min: 400, max: 1300, unit: 'шт', label: 'Фильтр косой сетчатый 3/4"' },
  thermometer: { min: 350, max: 1100, unit: 'шт', label: 'Термометр накладной 0–80 °C' },
  outdoor_sensor: { min: 1500, max: 4500, unit: 'шт', label: 'Датчик наружной температуры' },
  test_pump: { min: 3500, max: 9000, unit: 'шт', label: 'Насос опрессовочный ручной' },
  coolant_conc: { min: 250, max: 550, unit: 'л', label: 'Антифриз-концентрат для отопления' },
  pipe_20: { min: 180, max: 600, unit: 'м', label: 'Труба подводки 3/4" с фитингами' },

  // --- Бетонная столешница на стальном каркасе ---
  worktop_concrete: { min: 900, max: 2200, unit: 'м²', label: 'Смесь и арматура столешницы' },
  worktop_frame: { min: 200, max: 450, unit: 'м', label: 'Уголок 40×40×4' },
  worktop_post: { min: 300, max: 900, unit: 'шт', label: 'Зашивка стойки ЛДСП' },
  worktop_seal: { min: 600, max: 1800, unit: 'л', label: 'Пропитка для бетона' }
};

// Фасовка: в чём материал реально продаётся. Считать надо ШТУКАМИ,
// иначе на площадке выяснится, что 31,8 м² ЭППС — это 47 плит,
// а плёнка идёт рулонами по 75 м², и рулон нужен один, а не 0,5.
export const PACKS = {
  // СВЕРЕНО: Лемана ПРО, плита 585 × 1185 = 0,69 м² у большинства марок
  xps_field: { size: 0.69, label: 'плита 1185×585', unit: 'плит' },
  xps_edge: { size: 0.69, label: 'плита 1185×585', unit: 'плит' },
  film: { size: 75, label: 'рулон 3 × 25 м', unit: 'рулонов' },
  mesh: { size: 6, label: 'карта 2 × 3 м', unit: 'карт' },
  damper_tape: { size: 25, label: 'рулон 25 м', unit: 'рулонов' },
  ties: { size: 100, label: 'упаковка 100 шт', unit: 'упаковок' },
  cement: { size: 25, label: 'мешок 25 кг', unit: 'мешков' },
  fibre: { size: 0.6, label: 'пачка 600 г', unit: 'пачек' },
  plasticiser: { size: 5, label: 'канистра 5 л', unit: 'канистр' },
  joint_profile: { size: 3, label: 'хлыст 3 м', unit: 'хлыстов' },
  cable_25: { size: 100, label: 'бухта 100 м', unit: 'бухт' },
  cable_15: { size: 100, label: 'бухта 100 м', unit: 'бухт' },
  conduit: { size: 25, label: 'бухта 25 м', unit: 'бухт' },
  pex16: { size: 100, label: 'бухта 100/200 м', unit: 'бухт' }
};

export function packOf(key, qty) {
  const p = PACKS[key];
  if (!p) return null;
  return { ...p, count: Math.ceil(qty / p.size) };
}

export function priceOf(key) {
  const p = PRICES[key];
  if (!p) return null;
  return { ...p, avg: (p.min + p.max) / 2 };
}

// Стоимость позиции по трём границам
export function lineCost(qty, key) {
  const p = priceOf(key);
  if (!p) return { min: 0, avg: 0, max: 0, priced: false };
  return {
    min: qty * p.min,
    avg: qty * p.avg,
    max: qty * p.max,
    unitMin: p.min,
    unitAvg: p.avg,
    unitMax: p.max,
    priced: true
  };
}
