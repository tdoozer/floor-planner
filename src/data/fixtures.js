// Каталог оборудования: кухонная техника и сантехприборы.
//
// Ключевая идея проекта: прибор несёт не только габарит, но и СВОИ ТОЧКИ
// ПОДКЛЮЧЕНИЯ. Поставили мойку — сразу появились точки ХВС/ГВС и слив,
// а от слива строится трасса до стояка, которая проверяется на уклон
// внутри пирога пола. Это превращает расстановку из декорации в проверку.
//
// Габариты — в МЕТРАХ (w — по X, d — по Y, h — высота).
// connections: dx/dy — смещение точки от левого верхнего угла прибора, м.
//   kind: 'cw' ХВС | 'hw' ГВС | 'drain' слив | 'gas' газ | 'power' электрика
//   dia — диаметр слива, мм (только для kind === 'drain')
//
// floorExclusion — под прибором НЕ кладут трубу тёплого пола.
// Правило: исключается то, что стоит вплотную к полу и не пропускает воздух.
// Под таким предметом тепло запирается — в комнату не попадает, зато сушит
// мебель, а холодильник заставляет работать против себя. Мебель на ножках
// с зазором от 50 мм не исключается: под ней трубу класть можно и нужно,
// потому что полезной площади пола здесь в обрез.

export const CONNECTION_META = {
  cw: { label: 'CW', color: '#2563eb', short: 'C' },
  hw: { label: 'HW', color: '#dc2626', short: 'H' },
  drain: { label: 'Drain', color: '#0f766e', short: 'D' },
  gas: { label: 'Gas', color: '#f59e0b', short: 'G' },
  power: { label: '230 V', color: '#ca8a04', short: 'E' }
};

export const FIXTURES = [
  // ---------- Кухня ----------
  {
    id: 'fridge',
    name: 'Refrigerator',
    category: 'kitchen',
    w: 0.6, d: 0.65, h: 2.0,
    color: '#e2e8f0',
    floorExclusion: true,
    exclusionNote: 'Underfloor heating under a refrigerator makes it work against itself',
    connections: [{ kind: 'power', dx: 0.3, dy: 0.6 }]
  },
  {
    id: 'sink',
    builtInTop: true, // is set INTO the worktop, not under it
    name: 'Sink (600 module)',
    category: 'kitchen',
    w: 0.6, d: 0.6, h: 0.9,
    color: '#cbd5e1',
    workstation: true, // people stand at this fixture — headroom is needed
    floorExclusion: true,
    connections: [
      { kind: 'cw', dx: 0.3, dy: 0.5 },
      { kind: 'hw', dx: 0.42, dy: 0.5 },
      { kind: 'drain', dx: 0.3, dy: 0.55, dia: 50 }
    ]
  },
  {
    id: 'sink_corner',
    builtInTop: true, // is set INTO the worktop, not under it
    name: 'Corner sink 900×600',
    category: 'kitchen',
    // Сама чаша 900 × 600, ставится ПО ДИАГОНАЛИ в угол — поворот 45°.
    // Габарит на плане тогда 1061 × 1061: это и есть угловой модуль.
    w: 0.9, d: 0.6, h: 0.9,
    color: '#cbd5e1',
    workstation: true,
    floorExclusion: true,
    connections: [
      { kind: 'cw', dx: 0.45, dy: 0.45 },
      { kind: 'hw', dx: 0.57, dy: 0.45 },
      { kind: 'drain', dx: 0.45, dy: 0.5, dia: 50 }
    ]
  },
  {
    id: 'dishwasher60',
    name: 'Dishwasher 600',
    category: 'kitchen',
    w: 0.6, d: 0.6, h: 0.85,
    color: '#e2e8f0',
    floorExclusion: true,
    connections: [
      { kind: 'cw', dx: 0.3, dy: 0.55 },
      { kind: 'drain', dx: 0.45, dy: 0.55, dia: 40 },
      { kind: 'power', dx: 0.15, dy: 0.55 }
    ]
  },
  {
    id: 'dishwasher45',
    name: 'Dishwasher 450',
    category: 'kitchen',
    w: 0.45, d: 0.6, h: 0.85,
    color: '#e2e8f0',
    floorExclusion: true,
    connections: [
      { kind: 'cw', dx: 0.22, dy: 0.55 },
      { kind: 'drain', dx: 0.34, dy: 0.55, dia: 40 },
      { kind: 'power', dx: 0.1, dy: 0.55 }
    ]
  },
  {
    id: 'hob_gas',
    builtInTop: true, // is set INTO the worktop, not under it
    name: 'Gas hob',
    category: 'kitchen',
    w: 0.6, d: 0.52, h: 0.9,
    color: '#fde68a',
    requiresGas: true,
    workstation: true,
    floorExclusion: true,
    connections: [
      { kind: 'gas', dx: 0.3, dy: 0.46 },
      { kind: 'power', dx: 0.5, dy: 0.46 }
    ]
  },
  {
    id: 'oven',
    name: 'Oven',
    category: 'kitchen',
    w: 0.6, d: 0.55, h: 0.6,
    color: '#e2e8f0',
    floorExclusion: true,
    connections: [{ kind: 'power', dx: 0.3, dy: 0.5 }]
  },
  {
    id: 'worktop',
    name: 'Worktop / cabinet 600',
    category: 'kitchen',
    // Это КОРПУС нижнего шкафа: его высота подстраивается под столешницу,
    // а не спорит с ней. Под бетонной плитой 60 мм корпус будет 840.
    carcass: true,
    w: 0.6, d: 0.6, h: 0.9,
    color: '#f1f5f9',
    floorExclusion: true,
    connections: []
  },

  // ---------- Санузел ----------
  {
    id: 'shower',
    name: 'Shower cabin 900×900',
    category: 'bath',
    w: 0.9, d: 0.9, h: 2.1,
    color: '#cffafe',
    floorExclusion: true,
    exclusionNote: 'The tray stands flat on the floor, heating it makes no sense',
    // Слив душа — самый рискованный элемент по высоте пирога пола
    connections: [
      { kind: 'cw', dx: 0.45, dy: 0.08 },
      { kind: 'hw', dx: 0.57, dy: 0.08 },
      { kind: 'drain', dx: 0.45, dy: 0.45, dia: 50, critical: true }
    ]
  },
  {
    id: 'wc',
    name: 'Toilet',
    category: 'bath',
    w: 0.37, d: 0.65, h: 0.8,
    color: '#f8fafc',
    floorExclusion: false,
    connections: [
      { kind: 'cw', dx: 0.05, dy: 0.08 },
      { kind: 'drain', dx: 0.185, dy: 0.12, dia: 110, critical: true }
    ]
  },
  {
    id: 'basin',
    name: 'Washbasin',
    category: 'bath',
    w: 0.55, d: 0.45, h: 0.85,
    color: '#f1f5f9',
    floorExclusion: false,
    connections: [
      { kind: 'cw', dx: 0.22, dy: 0.38 },
      { kind: 'hw', dx: 0.33, dy: 0.38 },
      { kind: 'drain', dx: 0.275, dy: 0.4, dia: 40 }
    ]
  },
  {
    id: 'washer',
    name: 'Washing machine',
    category: 'bath',
    w: 0.6, d: 0.6, h: 0.85,
    color: '#e2e8f0',
    // Исключать не обязательно: прибору 26…29 °C не вредят, а тепло
    // расходится вбок по бетону и выходит вокруг машины.
    floorExclusion: false,
    exclusionNote: 'Pipe can be laid under it — the heat spreads sideways through the screed',
    connections: [
      { kind: 'cw', dx: 0.3, dy: 0.55 },
      { kind: 'drain', dx: 0.45, dy: 0.55, dia: 40 },
      { kind: 'power', dx: 0.15, dy: 0.55 }
    ]
  },
  {
    id: 'towel_rail',
    name: 'Towel radiator',
    category: 'bath',
    w: 0.5, d: 0.12, h: 0.8,
    color: '#fecaca',
    floorExclusion: false,
    connections: [{ kind: 'power', dx: 0.25, dy: 0.1 }]
  },

  // ---------- Мебель ----------
  {
    // Телевизор на стене. На полу не стоит, полу и мебели не мешает.
    // Габарит 55″: 1225 × 710 панель, на кронштейне ~80 от стены.
    id: 'tv_wall',
    name: 'TV 55″ on a bracket',
    category: 'furniture',
    w: 1.25, d: 0.08, h: 0.71,
    color: '#334155',
    wallMounted: true,
    mountHeight: 0.8, // bottom of the panel; screen centre ≈ 1150 — seated eye level
    floorExclusion: false,
    exclusionNote: 'Wall-mounted',
    connections: []
  },
  {
    // Навесные шкафы. На полу не стоят — тёплый пол их не касается вообще,
    // поэтому floorExclusion не применим. Отметка низа 1400 от чистого пола:
    // 900 столешница + 500 фартук.
    id: 'wall_cabinet',
    name: 'Wall cabinet 600',
    category: 'kitchen',
    w: 0.6, d: 0.35, h: 0.72,
    color: '#e0e7ff',
    wallMounted: true,
    mountHeight: 1.4,
    floorExclusion: false,
    connections: []
  },
  {
    // Шкаф над варочной панелью со ВСТРОЕННОЙ (телескопической) вытяжкой.
    // Зонт сам становится дном шкафа, поэтому место над плитой не пропадает —
    // просто шкаф мельче. Низ на 1650: над газом требуется 650–750 от панели.
    // Верх при этом совпадает с обычными шкафами (1400 + 720 = 2120),
    // и линия фасадов остаётся ровной.
    id: 'wall_cabinet_hood',
    name: 'Wall cabinet with hood 600',
    category: 'kitchen',
    w: 0.6, d: 0.35, h: 0.47,
    color: '#c7d2fe',
    wallMounted: true,
    mountHeight: 1.65,
    floorExclusion: false,
    connections: []
  },
  {
    id: 'wall_cabinet_corner',
    name: 'Corner wall cabinet',
    category: 'kitchen',
    w: 0.6, d: 0.6, h: 0.72,
    color: '#c7d2fe',
    wallMounted: true,
    mountHeight: 1.4,
    floorExclusion: false,
    connections: []
  },
  {
    id: 'shelf_open',
    name: 'Open shelving unit',
    category: 'furniture',
    w: 0.4, d: 0.4, h: 1.5,
    color: '#fed7aa',
    // Открытый стеллаж — воздух под ним и сквозь него ходит,
    // поэтому тёплый пол он не запирает
    floorExclusion: false,
    exclusionNote: 'Open: air passes through. With a solid plinth — enable the exclusion',
    connections: []
  },
  {
    id: 'sofa',
    name: 'Sofa',
    category: 'furniture',
    w: 2.1, d: 0.9, h: 0.85,
    color: '#ddd6fe',
    // Диван на ножках: под ним трубу кладут, воздух проходит.
    // Если поставите модель с глухим коробом до пола — включите исключение.
    floorExclusion: false,
    exclusionNote: 'On legs. A solid box down to the floor — enable the exclusion',
    connections: []
  },
  {
    id: 'dining_table',
    name: 'Dining table',
    category: 'furniture',
    w: 1.4, d: 0.8, h: 0.75,
    color: '#fed7aa',
    floorExclusion: false,
    connections: []
  },
  {
    id: 'bench',
    name: 'Bench by the table',
    category: 'furniture',
    w: 1.4, d: 0.4, h: 0.45,
    color: '#fde68a',
    // Лавки на ножках — под ними тоже кладём
    floorExclusion: false,
    exclusionNote: 'On legs. Solid to the floor — enable the exclusion',
    connections: []
  },
  {
    id: 'wardrobe',
    name: 'Wardrobe / cupboard',
    category: 'furniture',
    w: 1.0, d: 0.6, h: 2.2,
    color: '#e7e5e4',
    // Трубу под шкафом КЛАДЁМ, как под диваном и лавками. Причин три:
    //  • шкаф у наружной стены без подогрева пола — классическое место
    //    плесени: он перекрывает движение воздуха, стена за задней стенкой
    //    остаётся холодной, и там выпадает конденсат;
    //  • шкаф не герметичен, а стяжка разносит тепло вбок — оно всё равно
    //    выйдет в помещение, просто не строго вертикально;
    //  • в прихожей в него вешают МОКРУЮ верхнюю одежду и ставят обувь.
    //    В холодном шкафу она не сохнет и начинает пахнуть; тёплый пол
    //    под ним — самая дешёвая сушилка, какая бывает.
    floorExclusion: false,
    connections: []
  },
  {
    id: 'tv_unit',
    name: 'TV unit',
    category: 'furniture',
    w: 1.4, d: 0.4, h: 0.5,
    color: '#e7e5e4',
    floorExclusion: false,
    connections: [{ kind: 'power', dx: 0.7, dy: 0.35 }]
  }
];

export const CATEGORY_LABELS = {
  kitchen: 'Kitchen',
  bath: 'Bathroom',
  furniture: 'Furniture',
  electrical: 'Electrics'
};

// Электроточки. Габарит условный — на плане это значок, а не предмет.
// Главное в них — mountHeight (отметка от чистого пола) и circuit (группа):
// от группы зависит сечение кабеля и номинал автомата.
const ELECTRICAL = [
  {
    id: 'socket2', name: 'Double socket', category: 'electrical',
    w: 0.15, d: 0.06, h: 0.08, color: '#fde68a',
    mountHeight: 0.3, circuit: 'sockets', power: 0,
    floorExclusion: false, connections: []
  },
  {
    id: 'socket4', name: '4-gang socket block', category: 'electrical',
    w: 0.32, d: 0.06, h: 0.08, color: '#fcd34d',
    mountHeight: 1.1, circuit: 'kitchen', power: 0,
    floorExclusion: false, connections: []
  },
  {
    id: 'socket_app', name: 'Appliance socket', category: 'electrical',
    w: 0.15, d: 0.06, h: 0.08, color: '#f59e0b',
    mountHeight: 0.15, circuit: 'appliance', power: 2200,
    note: 'Separate line. Place it in the NEIGHBOURING cabinet, not behind the appliance itself',
    floorExclusion: false, connections: []
  },
  {
    id: 'socket_ip44', name: 'Splash-proof socket', category: 'electrical',
    w: 0.15, d: 0.06, h: 0.08, color: '#38bdf8',
    mountHeight: 1.1, circuit: 'bath', power: 0,
    note: 'IP44, outside the shower splash zone',
    floorExclusion: false, connections: []
  },
  {
    // Оптика заходит в дом ВМЕСТЕ С ГАЗОВОЙ ТРУБОЙ, под потолком,
    // в промежутке 700 мм между глухим окном и котлом. Роутер вешается там же.
    id: 'ont_router', name: 'Router / ONT', category: 'electrical',
    w: 0.24, d: 0.06, h: 0.18, color: '#a5b4fc',
    mountHeight: 2.3, circuit: 'boiler', power: 15,
    wallMounted: true, floorExclusion: false, connections: []
  },
  {
    // Приставка подключается к роутеру ВИТОЙ ПАРОЙ, поэтому висит
    // не у роутера, а за телевизором.
    id: 'tv_box', name: 'TV set-top box', category: 'electrical',
    w: 0.2, d: 0.14, h: 0.05, color: '#c7d2fe',
    mountHeight: 0.8, circuit: 'sockets', power: 12,
    wallMounted: true, floorExclusion: false, connections: []
  },
  {
    id: 'data_socket', name: 'RJ45 socket', category: 'electrical',
    w: 0.09, d: 0.06, h: 0.08, color: '#818cf8',
    mountHeight: 0.3, circuit: 'data', power: 0,
    floorExclusion: false, connections: []
  },
  {
    // Пустая гофра с протяжкой. Самое дешёвое, что можно заложить:
    // стандарты слаботочки меняются, а стены вскрывать больше не захочется.
    id: 'data_reserve', name: 'Spare conduit with a pull cord', category: 'electrical',
    w: 0.09, d: 0.06, h: 0.08, color: '#94a3b8',
    mountHeight: 0.3, circuit: 'data', power: 0,
    floorExclusion: false, connections: []
  },
  {
    // Щиток аварийного питания ПОСЛЕ ИБП. Нужен не для красоты:
    // у Штиль SW500L на выходе ОДНА розетка Schuko, а потребителей четыре.
    // Он же и снимает исходное возражение — у каждой ветки свой аппарат.
    id: 'panel_ups', name: 'Emergency power board', category: 'electrical',
    w: 0.22, d: 0.1, h: 0.16, color: '#f97316',
    mountHeight: 1.6, circuit: 'boiler', power: 0,
    floorExclusion: false, connections: []
  },
  {
    // Свет от ИБП. Класс II (двойная изоляция) выбран НЕ ради экономии
    // на жиле PE, а ради селективности: у прибора класса II нет
    // заземляемых частей, значит утечка на землю физически невозможна
    // и общее УЗО котла он потревожить не может.
    id: 'light_ups', name: 'Emergency luminaire (from the UPS, class II)',
    category: 'electrical',
    w: 0.24, d: 0.24, h: 0.08, color: '#fde047',
    mountHeight: 2.6, circuit: 'boiler', power: 10,
    floorExclusion: false, connections: []
  },
  {
    // Светильник со ВСТРОЕННЫМ аккумулятором (БАП). Сидит на обычной линии
    // освещения, заряжается от неё и зажигается сам при пропадании
    // напряжения. Кабель от котельной тянуть не надо, и работает он даже
    // тогда, когда отказал сам ИБП.
    id: 'light_bap', name: 'Luminaire with battery backup (own battery)',
    category: 'electrical',
    w: 0.24, d: 0.24, h: 0.1, color: '#4ade80',
    mountHeight: 2.6, circuit: 'light', power: 12, emergency: true,
    floorExclusion: false, connections: []
  },
  {
    // Единственная ветка ИБП, содержимое которой заранее неизвестно.
    // Отсюда и свой дифавтомат, и автомат номиналом по остатку инвертора.
    id: 'socket_ups', name: 'Emergency socket (from the UPS)', category: 'electrical',
    w: 0.09, d: 0.06, h: 0.08, color: '#fb923c',
    mountHeight: 0.3, circuit: 'boiler', power: 0,
    floorExclusion: false, connections: []
  },
  {
    id: 'switch1', name: 'Switch', category: 'electrical',
    w: 0.09, d: 0.06, h: 0.08, color: '#e2e8f0',
    mountHeight: 0.9, circuit: 'light', power: 0, gangs: 1,
    floorExclusion: false, connections: []
  },
  {
    id: 'switch2', name: 'Two-gang switch', category: 'electrical',
    w: 0.09, d: 0.06, h: 0.08, color: '#cbd5e1',
    mountHeight: 0.9, circuit: 'light', power: 0, gangs: 2,
    floorExclusion: false, connections: []
  },
  {
    // Проходной: одна и та же лампа включается и выключается из ДВУХ мест.
    // Ставится только парами — одиночный проходной бессмыслен.
    id: 'switch_way', name: 'Two-way switch', category: 'electrical',
    w: 0.09, d: 0.06, h: 0.08, color: '#94a3b8',
    mountHeight: 0.9, circuit: 'light', power: 0, gangs: 1, twoWay: true,
    note: 'Works only as a pair with a second two-way switch',
    floorExclusion: false, connections: []
  },
  {
    // Двухклавишный проходной: две независимые группы, каждая управляется
    // из двух мест. Внутри это два проходных механизма в одной рамке.
    // Между парой таких нужны ЧЕТЫРЕ перекидные жилы плюс земля —
    // 5×1,5 или два кабеля 3×1,5. Это надо заложить ДО штробления.
    id: 'switch2_way', name: 'Two-gang two-way switch', category: 'electrical',
    w: 0.09, d: 0.06, h: 0.08, color: '#64748b',
    mountHeight: 0.9, circuit: 'light', power: 0, gangs: 2, twoWay: true,
    note: 'Works only as a pair with a second one like it',
    floorExclusion: false, connections: []
  },
  {
    // ОБЩИЙ свет: накладной светильник с матовым плафоном («тарелка»).
    // Угол 90–120°, свет мягкий и рассеянный. Это НЕ спот: спот узкий
    // и направленный, рассеивателя у него не бывает — это разные приборы.
    id: 'light', name: 'General luminaire (ceiling light)', category: 'electrical',
    w: 0.3, d: 0.3, h: 0.09, color: '#fef3c7',
    mountHeight: 2.7, circuit: 'light', power: 12, beam: 110,
    note: 'Surface-mounted with a frosted shade, wide diffuse light',
    floorExclusion: false, connections: []
  },
  {
    // РАБОЧИЙ свет: поворотный спот или трековый светильник.
    // Угол 24–40°, луч направляется на столешницу.
    id: 'light_work', name: 'Task spot (adjustable)', category: 'electrical',
    w: 0.1, d: 0.1, h: 0.12, color: '#fbbf24',
    mountHeight: 2.7, circuit: 'light', power: 10, beam: 30,
    note: 'Adjustable spot or track. Set 600–700 from the wall and turned ' +
      'towards the backsplash — otherwise it shines into your back',
    floorExclusion: false, connections: []
  },
  {
    id: 'light_pendant', name: 'Pendant over the worktop', category: 'electrical',
    w: 0.3, d: 0.3, h: 0.3, color: '#f59e0b',
    mountHeight: 1.6, circuit: 'light', power: 20,
    note: 'Low: 750–800 above the worktop',
    floorExclusion: false, connections: []
  }
];

FIXTURES.push(...ELECTRICAL);

const BY_ID = FIXTURES.reduce((acc, f) => {
  acc[f.id] = f;
  return acc;
}, {});

export function getFixture(catalogId) {
  return BY_ID[catalogId] || null;
}

// Собственный габарит прибора: из каталога, если пользователь его не менял.
// Приборы можно растягивать мышкой — например, подогнать столешницу или
// душевой поддон под фактический размер.
export function dims(item) {
  const spec = getFixture(item.catalogId);
  if (!spec) return { w: 0, d: 0 };
  return { w: item.w ?? spec.w, d: item.d ?? spec.d };
}

// Исключается ли пятно прибора из поля тёплого пола.
// Значение из каталога можно переопределить на конкретном объекте.
export function excludesFloor(item) {
  const spec = getFixture(item.catalogId);
  if (!spec) return false;
  return item.floorExclusion ?? spec.floorExclusion ?? false;
}

// Абсолютные координаты точек подключения с учётом поворота и растяжения.
export function connectionPoints(item) {
  const spec = getFixture(item.catalogId);
  if (!spec) return [];
  const { w, d } = dims(item);
  // При растяжении точки подключения едут пропорционально габариту
  const sx = w / spec.w;
  const sy = d / spec.d;

  const rad = ((item.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = w / 2;
  const cy = d / 2;

  return spec.connections.map((c, i) => {
    // Поворот вокруг центра прибора — та же конвенция, что у отрисовки
    const rx = c.dx * sx - cx;
    const ry = c.dy * sy - cy;
    return {
      ...c,
      id: `${item.id}-c${i}`,
      ownerId: item.id,
      ownerName: spec.name,
      x: item.x + cx + rx * cos - ry * sin,
      y: item.y + cy + rx * sin + ry * cos
    };
  });
}

// Габарит прибора в плане с учётом поворота на 90/270°.
// Габарит повёрнутого прямоугольника — ОБЩАЯ формула, не только 0/90.
// Раньше углы вроде 45° округлялись до ближайшей четверти, и угловая мойка,
// поставленная по диагонали, занимала на плане не то место, что в жизни.
export function footprint(item) {
  const { w, d } = dims(item);
  const rad = ((item.rotation || 0) * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  return {
    w: w * c + d * s,
    d: w * s + d * c
  };
}

// Четыре угла прибора С УЧЁТОМ ПОВОРОТА, в мировых координатах.
// Поворот идёт вокруг центра.
export function corners(item) {
  const { w, d } = dims(item);
  const rad = ((item.rotation || 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = item.x + w / 2;
  const cy = item.y + d / 2;
  const ux = { x: cos, y: sin };
  const vx = { x: -sin, y: cos };
  const hw = w / 2;
  const hd = d / 2;

  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([su, sv]) => ({
    x: cx + su * hw * ux.x + sv * hd * vx.x,
    y: cy + su * hw * ux.y + sv * hd * vx.y
  }));
}

// Пересекаются ли два прибора НА САМОМ ДЕЛЕ, а не их габаритные рамки.
// Для повёрнутого на 45° прибора рамка вдвое больше него самого, и проверка
// по рамкам давала ложные наложения на всю угловую кухню.
// Теорема о разделяющей оси: если есть ось, на которой проекции не
// пересекаются, значит фигуры не пересекаются.
export function shapesOverlap(a, b, tolerance = 0.02) {
  const pa = corners(a);
  const pb = corners(b);

  const axes = [a, b].flatMap((item) => {
    const rad = ((item.rotation || 0) * Math.PI) / 180;
    return [
      { x: Math.cos(rad), y: Math.sin(rad) },
      { x: -Math.sin(rad), y: Math.cos(rad) }
    ];
  });

  const project = (pts, ax) => {
    const vals = pts.map((p) => p.x * ax.x + p.y * ax.y);
    return { min: Math.min(...vals), max: Math.max(...vals) };
  };

  let minGapOverlap = Infinity;
  for (const ax of axes) {
    const A = project(pa, ax);
    const B = project(pb, ax);
    const over = Math.min(A.max, B.max) - Math.max(A.min, B.min);
    if (over <= tolerance) return { overlap: false, depth: 0 };
    minGapOverlap = Math.min(minGapOverlap, over);
  }
  return { overlap: true, depth: minGapOverlap };
}

// Габаритный прямоугольник прибора на плане.
// Поворот идёт ВОКРУГ ЦЕНТРА, поэтому у повёрнутого прибора левый верхний угол
// смещается — брать item.x/item.y напрямую нельзя.
export function boundingBox(item) {
  const own = dims(item);
  const fp = footprint(item);
  const cx = item.x + own.w / 2;
  const cy = item.y + own.d / 2;
  return { x: cx - fp.w / 2, y: cy - fp.d / 2, w: fp.w, d: fp.d, cx, cy };
}

// Прямоугольник, который вычитается из поля тёплого пола
export function exclusionRect(item) {
  const b = boundingBox(item);
  return { x: b.x, y: b.y, w: b.w, d: b.d };
}
