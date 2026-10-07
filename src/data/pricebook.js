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
  region: 'Central Russia',
  updated: '2026-08',
  verified: false,
  source: 'Some items checked against the Leroy Merlin PRO catalogue (August 2026)',
  disclaimer:
    'Indicative ranges, not quotes. Items marked checked ' +
    'were verified against the catalogue, the rest are order-of-magnitude estimates. ' +
    'Replace with your own suppliers\' prices before buying.'
};

export const PRICES = {
  // --- Основание ---
  sand_fill: { min: 800, max: 1800, unit: 'm³', label: 'Quarry sand, delivered' },
  sand_washed: { min: 1200, max: 2500, unit: 'm³', label: 'Washed sand' },
  gravel: { min: 2000, max: 3800, unit: 'm³', label: 'Crushed stone 20–40' },
  film: { min: 25, max: 60, unit: 'm²', label: 'Film 200 µm' },

  // --- Утепление ---
  // СВЕРЕНО: Лемана ПРО, плита 585×1185 = 0,69 м².
  // Укна Т-15 — 758 ₽/плита → 1099 ₽/м². Пеноплэкс Фундамент — 858 → 1243 ₽/м².
  // Прежняя оценка 450–900 была ЗАНИЖЕНА вдвое.
  xps_field: { min: 1050, max: 1300, unit: 'm²', label: 'XPS 100 mm', checked: true },
  // Цоколь — ТОТ ЖЕ материал 100 мм. В рознице ходовые толщины 50 и 100,
  // 80 мм почти не встречается. Цоколь ниже стяжки, площади не отнимает,
  // поэтому берём 100: одна позиция вместо двух, один завоз.
  xps_edge: { min: 1050, max: 1300, unit: 'm²', label: 'XPS 100 mm (plinth)', checked: true },
  // Для справки, если решите тоньше: СВЕРЕНО, Лемана ПРО, 50 мм —
  // 244 ₽/плита 0,72 м² (Полимерпласт) … 357 ₽/плита 0,69 м² (Укна Прочный)
  xps_50: { min: 340, max: 520, unit: 'm²', label: 'XPS 50 mm', checked: true },
  foam_glue: { min: 500, max: 900, unit: 'cyl.', label: 'Foam adhesive' },
  damper_tape: { min: 25, max: 70, unit: 'm', label: 'Damper strip' },

  // --- Тёплый пол ---
  // СВЕРЕНО: Лемана ПРО, трубы для тёплого пола 16 мм — «от 77 ₽».
  // Нижняя граница подтвердилась, верхняя — Rehau и PE-Xa с кислородным барьером.
  pex16: { min: 77, max: 170, unit: 'm', label: 'PEX pipe 16×2.0', checked: true },
  mesh: { min: 180, max: 350, unit: 'm²', label: 'Mesh 100×100×4' },
  ties: { min: 1, max: 3, unit: 'pcs', label: 'Nylon cable tie' },
  manifold: { min: 9000, max: 22000, unit: 'set', label: 'Manifold with flow meters' },
  eurocone: { min: 250, max: 600, unit: 'pcs', label: 'Euroconus 16' },
  manifold_box: { min: 3500, max: 9000, unit: 'pcs', label: 'Manifold cabinet' },
  safety_stat: { min: 1200, max: 3500, unit: 'pcs', label: 'Emergency thermostat' },

  // --- Стяжка ---
  cement: { min: 8, max: 14, unit: 'kg', label: 'Cement M500' },
  fibre: { min: 150, max: 400, unit: 'kg', label: 'Polypropylene fibre' },
  plasticiser: { min: 120, max: 350, unit: 'l', label: 'Plasticiser for underfloor heating' },
  joint_profile: { min: 150, max: 400, unit: 'm', label: 'Expansion joint profile' },

  // --- Электрика ---
  // СВЕРЕНО: Лемана ПРО, ВВГ 3×2,5 ГОСТ — «от 127 ₽/м».
  // Прежняя оценка 60–130 была занижена: 127 это НИЖНЯЯ граница.
  cable_25: { min: 127, max: 210, unit: 'm', label: 'Cable VVGng-LS 3×2.5', checked: true },
  cable_15: { min: 80, max: 140, unit: 'm', label: 'Cable VVGng-LS 3×1.5' },
  conduit: { min: 25, max: 90, unit: 'm', label: 'Corrugated conduit / metal hose' },
  back_box: { min: 15, max: 45, unit: 'pcs', label: 'Back box' },
  junction_box: { min: 40, max: 120, unit: 'pcs', label: 'Junction box' },
  socket: { min: 200, max: 800, unit: 'pcs', label: 'Socket with frame' },
  socket_ip44: { min: 350, max: 1200, unit: 'pcs', label: 'Socket IP44' },
  switch: { min: 200, max: 900, unit: 'pcs', label: 'Switch' },
  switch_way: { min: 350, max: 1400, unit: 'pcs', label: 'Two-way switch' },
  switch2_way: { min: 600, max: 2200, unit: 'pcs', label: 'Two-gang two-way switch' },
  breaker: { min: 250, max: 700, unit: 'pcs', label: 'Breaker 16 A' },
  rcd: { min: 900, max: 3000, unit: 'pcs', label: 'RCD / RCBO' },
  panel_box: { min: 1200, max: 4000, unit: 'pcs', label: 'Internal board' },

  // --- Щиты ---
  // СВЕРЕНО: ИБП по каталогу производителя (shtyl.ru) и по ЭТМ.
  ups_sw500l: { min: 24800, max: 30000, unit: 'pcs', label: 'UPS Shtil SW500L 500 VA', checked: true },
  agm_100: { min: 12000, max: 20000, unit: 'pcs', label: 'AGM battery 12 V 100 Ah' },
  battery_rack: { min: 2000, max: 6000, unit: 'pcs', label: 'Battery rack standing on the screed' },
  voltage_relay: { min: 2500, max: 7000, unit: 'pcs', label: 'Voltage relay with auto-reset' },
  rcd_300s: { min: 2500, max: 7000, unit: 'pcs', label: 'RCD 2P 63 A / 300 mA type S' },
  rcbo_30ma: { min: 1600, max: 4500, unit: 'pcs', label: 'RCBO C16 / 30 mA' },
  panel_24: { min: 2000, max: 6500, unit: 'pcs', label: 'Board for 24 modules, internal' },
  isolator_2p: { min: 500, max: 1600, unit: 'pcs', label: 'Load switch 2P 40 A' },
  cable_6: { min: 250, max: 420, unit: 'm', label: 'Cable VVGng-LS 3×6' },

  // --- Аварийное питание ---
  panel_din8: { min: 700, max: 2200, unit: 'pcs', label: 'DIN enclosure for 8 modules' },
  breaker_b1: { min: 400, max: 1200, unit: 'pcs', label: 'Breaker B1 A' },
  rcbo_10ma: { min: 1800, max: 5000, unit: 'pcs', label: 'RCBO 10 mA' },
  light_classii: { min: 900, max: 3000, unit: 'pcs', label: 'Class II luminaire' },
  light_bap: { min: 2500, max: 7000, unit: 'pcs', label: 'Luminaire with battery backup' },
  socket_marked: { min: 400, max: 1400, unit: 'pcs', label: 'Marked emergency socket' },

  // --- Слаботочка ---
  utp_cat6: { min: 45, max: 130, unit: 'm', label: 'UTP cat.6 cable, copper' },
  conduit20: { min: 30, max: 80, unit: 'm', label: 'Corrugated conduit Ø20 with pull cord' },
  rj45_socket: { min: 350, max: 1100, unit: 'pcs', label: 'Double RJ45 socket' },
  rj45_keystone: { min: 90, max: 300, unit: 'pcs', label: 'RJ45 module / connector' },
  patch_cord: { min: 150, max: 450, unit: 'pcs', label: 'Patch cord' },
  speaker_cable: { min: 80, max: 400, unit: 'm', label: 'Speaker cable 2×2.5' },
  light_plafond: { min: 1800, max: 6000, unit: 'pcs', label: 'Surface-mounted luminaire' },
  light_spot: { min: 700, max: 2500, unit: 'pcs', label: 'Adjustable spot' },
  light_pendant: { min: 2000, max: 9000, unit: 'pcs', label: 'Pendant' },

  // --- Лестница ---
  tube_120x60: { min: 1000, max: 1600, unit: 'm', label: 'Rectangular tube 120×60×4' },
  angle_63: { min: 350, max: 600, unit: 'm', label: 'Angle 63×63×5' },
  steel_sheet4: { min: 2800, max: 4700, unit: 'm²', label: 'Steel sheet 4 mm' },
  embed_plate: { min: 150, max: 400, unit: 'pcs', label: 'Embed plate 100×100×5' },
  embed_stair: { min: 400, max: 900, unit: 'pcs', label: 'Embed plate for the stringer heel 250×120×6' },
  bolt_m12: { min: 40, max: 110, unit: 'pcs', label: 'Through bolt M12 with washers' },
  metal_paint: { min: 400, max: 900, unit: 'l', label: 'Metal primer-enamel' },
  bolt_m8: { min: 15, max: 40, unit: 'pcs', label: 'Bolt M8×60 with nut and washers' },
  rubber_pad: { min: 5, max: 20, unit: 'pcs', label: 'Rubber gasket' },
  anchor_m10: { min: 40, max: 120, unit: 'pcs', label: 'Anchor M10' },
  ply3: { min: 170, max: 350, unit: 'm²', label: 'Plywood 3 mm FK' },
  ply12: { min: 700, max: 1400, unit: 'm²', label: 'Plywood 12 mm FK' },
  wood_glue: { min: 400, max: 900, unit: 'kg', label: 'Wood glue D3' },
  wood_oil: { min: 700, max: 2000, unit: 'l', label: 'Wood oil / varnish' },
  gkl: { min: 250, max: 450, unit: 'm²', label: 'Plasterboard 12.5 mm' },
  gkl_frame: { min: 90, max: 180, unit: 'm', label: 'Frame profile' },
  handrail: { min: 400, max: 1200, unit: 'm', label: 'Wooden handrail' },
  handrail_bracket: { min: 300, max: 900, unit: 'pcs', label: 'Handrail bracket' },
  cupboard_door: { min: 2000, max: 6000, unit: 'pcs', label: 'Storage cupboard door' },

  // --- Обвязка котельной ---
  // Всё, что внутри котла (насос, бак, группа безопасности), здесь
  // ОТСУТСТВУЕТ намеренно: оно уже куплено вместе с котлом.
  ball_valve_20: { min: 450, max: 1400, unit: 'pcs', label: 'Ball valve 3/4" with union' },
  strainer_20: { min: 400, max: 1300, unit: 'pcs', label: 'Y-strainer 3/4"' },
  thermometer: { min: 350, max: 1100, unit: 'pcs', label: 'Strap-on thermometer 0–80 °C' },
  outdoor_sensor: { min: 1500, max: 4500, unit: 'pcs', label: 'Outdoor temperature sensor' },
  test_pump: { min: 3500, max: 9000, unit: 'pcs', label: 'Manual pressure-test pump' },
  coolant_conc: { min: 250, max: 550, unit: 'l', label: 'Heating antifreeze concentrate' },
  pipe_20: { min: 180, max: 600, unit: 'm', label: 'Feed pipe 3/4" with fittings' },

  // --- Бетонная столешница на стальном каркасе ---
  worktop_concrete: { min: 900, max: 2200, unit: 'm²', label: 'Worktop mix and reinforcement' },
  worktop_frame: { min: 200, max: 450, unit: 'm', label: 'Angle 40×40×4' },
  worktop_post: { min: 300, max: 900, unit: 'pcs', label: 'Post cladding, chipboard' },
  worktop_seal: { min: 600, max: 1800, unit: 'l', label: 'Concrete sealer' }
};

// Фасовка: в чём материал реально продаётся. Считать надо ШТУКАМИ,
// иначе на площадке выяснится, что 31,8 м² ЭППС — это 47 плит,
// а плёнка идёт рулонами по 75 м², и рулон нужен один, а не 0,5.
export const PACKS = {
  // СВЕРЕНО: Лемана ПРО, плита 585 × 1185 = 0,69 м² у большинства марок
  xps_field: { size: 0.69, label: 'board 1185×585', unit: 'boards' },
  xps_edge: { size: 0.69, label: 'board 1185×585', unit: 'boards' },
  film: { size: 75, label: 'roll 3 × 25 m', unit: 'rolls' },
  mesh: { size: 6, label: 'sheet 2 × 3 m', unit: 'sheets' },
  damper_tape: { size: 25, label: 'roll 25 m', unit: 'rolls' },
  ties: { size: 100, label: 'pack of 100', unit: 'packs' },
  cement: { size: 25, label: 'bag 25 kg', unit: 'bags' },
  fibre: { size: 0.6, label: 'pack 600 g', unit: 'packs' },
  plasticiser: { size: 5, label: 'canister 5 l', unit: 'canisters' },
  joint_profile: { size: 3, label: 'length 3 m', unit: 'lengths' },
  cable_25: { size: 100, label: 'coil 100 m', unit: 'coils' },
  cable_15: { size: 100, label: 'coil 100 m', unit: 'coils' },
  conduit: { size: 25, label: 'coil 25 m', unit: 'coils' },
  pex16: { size: 100, label: 'coil 100/200 m', unit: 'coils' }
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
