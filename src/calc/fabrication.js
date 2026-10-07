// Изготовление металла: лестница и каркас столешницы.
//
// Это не «примерно так», а размеры под резку. Всё выводится из геометрии
// марша и фронта кухни — поменяли число подступенков или сдвинули
// посудомойку, пересчитались длины, углы и число деталей.
//
// Всё В МИЛЛИМЕТРАХ (в отличие от плана — там метры): резать и варить
// удобнее в целых миллиметрах, и путаницы с масштабом не возникает.

const deg = (rad) => (rad * 180) / Math.PI;

// ---------------------------------------------------------------------------
// ЛЕСТНИЦА
// ---------------------------------------------------------------------------
//
// Схема: два прямых косоура из профтрубы. Поверх каждого — «гребёнка»
// из треугольных косынок, на них горизонтальные площадки из уголка,
// на площадки болтами через резиновую прокладку садится проступь.
//
// Треугольники здесь не украшение и не усиление: прямая труба под
// ступенчатой поверхностью ОСТАВЛЯЕТ треугольные пустоты, и катеты
// этих треугольников — это ровно подступенок и проступь.
export const STAIR_FAB = {
  stringer: { label: '120×60×4', h: 120, w: 60, wall: 4, kgPerM: 10.3 },
  stringerCount: 2,
  // Расстояние между осями косоуров. При ступени 800 остаётся по 150
  // свеса с каждой стороны — фанера такой свес держит без прогиба.
  gauge: 500,
  platform: { label: '63×63×5', leg: 63, t: 5, len: 250 },
  gussetT: 4,
  // Проступь: доска демонтированного пола 40 мм плюс фанера 3 мм пластью
  treadT: 43,
  treadWidth: 800,
  nosing: 30,
  // Пятка приваривается к закладной ГОРИЗОНТАЛЬНЫМ резом трубы:
  // так шов идёт по всему периметру реза, а не по торцу в 4 мм
  footPlate: { w: 250, d: 120, t: 6 },
  // Верхний узел. Косоур кончается НА КРОМКЕ ПРОЁМА и опирается на ригель:
  // последняя ступень — это сам пол мансарды. Заводить трубу дальше,
  // под перекрытие, некуда и незачем — она там ни на что не опирается.
  topAllowance: 0,
  topBracket: { w: 160, t: 8, bolts: 4, boltSize: 'M12' },
  // Пирог перекрытия мансарды. Высота лаги НЕ ЗАМЕРЕНА — от неё зависит
  // высота кронштейна, и только она.
  mansardBoards: 40,
  joistDepth: 200,
  joistConfirmed: false
};

export function stairFabrication(stair, fab = STAIR_FAB) {
  const risers = stair.risers;
  const treads = risers - 1;
  const rise = (stair.totalRise * 1000) / risers; // riser
  const going = (stair.length * 1000) / treads; // tread
  const slope = Math.atan(rise / going);
  const angleDeg = deg(slope);

  // Линия носков проходит через задние углы ступеней. Верхняя грань трубы
  // идёт параллельно ей, ниже на толщину проступи и полки уголка —
  // иначе площадка не ляжет горизонтально.
  const faceDrop = fab.treadT + fab.platform.t;
  const run = stair.length * 1000; // 3400
  const nosingRise = rise * treads; // rise along the nosing line

  // Труба 120 мм по вертикали занимает больше: она наклонена
  const tubeVert = fab.stringer.h / Math.cos(slope);
  // Верхняя грань трубы как функция от проекции
  const tf = (x) => Math.tan(slope) * x - faceDrop;
  // Где нижняя грань трубы приходит на пол
  const footX = (faceDrop + tubeVert) / Math.tan(slope);
  // Длина реза по трубе от пятки до верха марша плюс запас на узел
  const cutLen = (run - footX) / Math.cos(slope) + fab.topAllowance;

  // Косынка: прямоугольный треугольник, катеты — проступь и подступенок
  const gusset = {
    base: going,
    height: rise,
    hyp: Math.hypot(going, rise),
    thickness: fab.gussetT,
    count: treads * fab.stringerCount,
    areaM2: (0.5 * going * rise * treads * fab.stringerCount) / 1e6
  };
  gusset.massKg = gusset.areaM2 * (fab.gussetT / 1000) * 7850;

  const platforms = {
    ...fab.platform,
    count: treads * fab.stringerCount,
    totalM: (fab.platform.len * treads * fab.stringerCount) / 1000
  };

  const stringers = {
    ...fab.stringer,
    count: fab.stringerCount,
    cutLen,
    totalM: (cutLen * fab.stringerCount) / 1000,
    massKg: ((cutLen * fab.stringerCount) / 1000) * fab.stringer.kgPerM
  };

  // Верхний узел. На кромке проёма верх трубы оказывается на 248 ниже
  // чистого пола мансарды: это последний подступенок 200 плюс проступь
  // с полкой уголка. Низ лаги при обычной высоте 150–200 всё равно ВЫШЕ
  // трубы — значит торцом к лаге косоур не пришить, между ними разрыв.
  // Разрыв закрывает кронштейн: пластина по боку ригеля с приваренной
  // полкой, на которую труба и садится.
  const faceTop = tf(run);
  const tubeBottomTop = faceTop - tubeVert;
  const joistBottom = stair.totalRise * 1000 - fab.mansardBoards - fab.joistDepth;
  const topNode = {
    faceTop,
    tubeBottom: tubeBottomTop,
    dropUnderFloor: stair.totalRise * 1000 - faceTop,
    joistBottom,
    joistDepth: fab.joistDepth,
    joistConfirmed: fab.joistConfirmed,
    // Кронштейн ведётся от низа трубы до верха лаги
    bracketH: stair.totalRise * 1000 - fab.mansardBoards - tubeBottomTop,
    ...fab.topBracket,
    // Пришить торец прямо к ригелю можно, только если лага опускается
    // ниже верхней грани трубы
    directToJoist: joistBottom < faceTop
  };

  // Сварка: по два шва на косынку (к трубе по гипотенузе, к площадке
  // по катету) плюс площадка к косынке
  const weldM =
    (gusset.count * (gusset.hyp + gusset.base) + platforms.count * fab.platform.len * 2) / 1000;

  return {
    risers,
    treads,
    rise,
    going,
    angleDeg,
    run,
    nosingRise,
    faceDrop,
    footX,
    tubeVert,
    gauge: fab.gauge,
    overhang: (fab.treadWidth - fab.gauge) / 2,
    treadT: fab.treadT,
    treadDepth: going + fab.nosing,
    treadWidth: fab.treadWidth,
    stringers,
    gusset,
    platforms,
    footPlate: fab.footPlate,
    topNode,
    weldM,
    // Резать трубу удобнее из хлыста 6 м: два косоура по 4,4 — это два хлыста
    stockBars: Math.ceil(stringers.count / Math.floor(6000 / cutLen))
  };
}

// ---------------------------------------------------------------------------
// КАРКАС СТОЛЕШНИЦЫ
// ---------------------------------------------------------------------------
//
// Плита 60 мм лежит не на шкафах, а на своей стальной раме: кухня поднята
// на стойки, чтобы тёплый пол работал под ней. Рама — лестница из двух
// продольных уголков и поперечин; поперечины опираются на ПАРЫ стоек.
//
// Пара, а не одна стойка: глубина 600, и от одной линии опор плита
// консолилась бы на 600 мм. Стойки встают на стык секций кухни, где
// сходятся две боковины шкафов, — там их не видно ни снаружи, ни изнутри.
export const WORKTOP_FAB = {
  angle: { label: '40×40×4', leg: 40, t: 4, kgPerM: 2.42 },
  framePitch: 600, // post pitch ALONG THE FRONT: matches the section joints
  // Сзади шаг вдвое реже. Стойка там ничему не мешает и её не видно,
  // но и часто ставить незачем: прогиб связки уголка с плитой на 1200
  // выходит 0,14 мм — бетон 60 мм несёт себя сам, уголок ему направляющая.
  backPitch: 1200,
  edgeInset: 50, // offset of the longitudinal angle from the slab edge
  embed: { w: 100, d: 100, t: 5 },
  concreteDensity: 2400
};

// Пристенный уголок вместо задней линии стоек.
//
// Вопрос честный: задняя кромка могла бы лежать не на стойках, а на уголке,
// прикрученном к стене. Тогда внутри шкафов не будет стоек и ящики станут
// глубже. Считаем, выдержит ли газобетон.
//
// Нагрузка на анкер — СРЕЗ (вертикальная) плюс небольшой отрыв от того,
// что плита опирается в 50 мм от плоскости стены.
export const LEDGER = {
  angle: '50×50×5',
  pitch: 400,
  // Дюбель для ячеистого бетона (Fischer GB, TOX Ytong и подобные).
  // ЗНАЧЕНИЕ ОРИЕНТИРОВОЧНОЕ и сильно зависит от марки блока:
  // у D400 против D500 разница почти вдвое.
  anchorShearN: 1200,
  anchorConfirmed: false,
  minSafety: 3
};

export function wallLedgerCheck({ worktop, lineLoadNPerM, pitchMm = LEDGER.pitch, cfg = LEDGER }) {
  const perAnchorN = (lineLoadNPerM * pitchMm) / 1000;
  const safety = cfg.anchorShearN / perAnchorN;
  return {
    ...cfg,
    pitchMm,
    perAnchorN,
    safety,
    ok: safety >= cfg.minSafety,
    anchors: Math.ceil((worktop.runM * 1000) / pitchMm) + 1
  };
}

export function worktopFabrication(worktop, screed, fab = WORKTOP_FAB) {
  if (!worktop) return null;

  const topMm = worktop.top * 1000;
  const slabT = worktop.thickness * 1000;
  const underside = topMm - slabT;
  // Закладная утоплена заподлицо со СТЯЖКОЙ, поверх неё ляжет керамогранит.
  // Значит стойка длиннее на толщину чистового покрытия.
  const embedLevel = -screed.finishThickness;
  const postLen = underside - embedLevel;

  const runMm = worktop.runM * 1000;
  const frames = Math.floor(runMm / fab.framePitch) + 1;
  const frontPosts = frames;
  const backPosts = Math.ceil(runMm / fab.backPitch) + 1;
  const posts = frontPosts + backPosts;

  const crossLen = worktop.depth * 1000 - 2 * fab.edgeInset; // between the axes of the longitudinal ones
  const longitudinalM = (runMm * 2) / 1000;
  // Поперечина ставится там, где есть ЗАДНЯЯ стойка: без неё связывать нечего
  const crossM = (crossLen * backPosts) / 1000;
  const postM = (postLen * posts) / 1000;
  const angleTotalM = longitudinalM + crossM + postM;

  const slabMassKg = worktop.area * worktop.thickness * fab.concreteDensity;

  return {
    topMm,
    slabT,
    underside,
    embedLevel,
    postLen,
    frames,
    posts,
    frontPosts,
    backPosts,
    framePitch: fab.framePitch,
    backPitch: fab.backPitch,
    crossLen,
    spanLongitudinal: fab.framePitch,
    longitudinalM,
    crossM,
    postM,
    angleTotalM,
    angle: fab.angle,
    embed: { ...fab.embed, count: posts },
    slabMassKg,
    loadPerPostKg: slabMassKg / posts,
    // Погонная нагрузка на продольный уголок: половина массы плиты
    // плюс полезная нагрузка 1 кН/м² по глубине 600
    lineLoadNPerM: ((slabMassKg * 9.81) / runMm) * 1000 / 2 + 1000 * worktop.depth / 2
  };
}

// ---------------------------------------------------------------------------
// ТОЛЩИНА ПЛИТЫ СТОЛЕШНИЦЫ
// ---------------------------------------------------------------------------
//
// Вопрос не в прочности поля: плита пролётом 500 между продольными уголками
// не гнётся ни при какой разумной толщине. Толщину решают три других вещи:
//
//   1) ПЕРЕМЫЧКИ У ВЫРЕЗОВ. Полоса между вырезом мойки и кромкой столешницы
//      всего ~75 мм шириной. Вот она и есть слабое место бетонной столешницы,
//      и именно она ломается, когда на край облокачиваются.
//   2) ЗАЩИТНЫЙ СЛОЙ. Арматуре нужен бетон сверху и снизу. В 40 мм
//      на сетку остаётся 10 мм — Ø4 влезает, Ø6 уже нет.
//   3) ПРОСВЕТ ПОД ПЛИТОЙ. Каждые 10 мм толщины — это 10 мм, отнятые
//      у встроенной техники.
export const SLAB = {
  concreteFlexuralMPa: 3.5, // design flexural tensile strength
  safety: 2,
  coverMm: 15, // cover at top and bottom
  fieldSpanMm: 500, // between the longitudinal angles
  cutoutStripMm: 75, // bridge between the cut-out and the edge
  cutoutSpanMm: 500, // length of the cut-out
  leanLoadN: 500, // a person leans on the bridge
  pointLoadN: 1000, // concentrated load on the field
  edgeInsetMm: 50, // axis of the longitudinal angle from the slab edge
  angleLegMm: 40,
  spreadMm: 300 // how far the load spreads across the width
};

function bendingMPa({ widthMm, tMm, spanMm, pointN, selfW = 0 }) {
  const W = (widthMm * tMm ** 2) / 6;
  const M = (pointN * spanMm) / 4 + (selfW * spanMm ** 2) / 8;
  return M / W;
}

export function slabThicknessOptions({
  worktop,
  applianceH = 0.85,
  finishThickness = 12,
  cfg = SLAB,
  list = [30, 40, 50, 60]
}) {
  const topMm = (worktop?.top ?? 0.9) * 1000;
  const area = worktop?.area ?? 0;

  return list.map((t) => {
    const selfWnPerMm = (2400 * 9.81 * (t / 1000)) / 1000; // N/mm per 1 mm of width
    const field = bendingMPa({
      widthMm: 1000, tMm: t, spanMm: cfg.fieldSpanMm,
      pointN: cfg.pointLoadN, selfW: selfWnPerMm * 1000 / 1000
    });
    // Перемычка у выреза в ДВУХ случаях.
    //
    // Свободная — если под ней ничего нет: полоса 75 мм пролётом во всю
    // длину выреза. Это классическое место излома бетонной столешницы.
    const stripFree = bendingMPa({
      widthMm: cfg.cutoutStripMm, tMm: t, spanMm: cfg.cutoutSpanMm,
      pointN: cfg.leanLoadN
    });
    // Опёртая — наш случай: продольный уголок идёт в 50 мм от кромки,
    // то есть ПРЯМО ПОД перемычкой по всей длине. Пролёта нет, остаётся
    // короткая консоль от полки уголка до края выреза.
    const cantMm = Math.max(5, cfg.cutoutStripMm - cfg.edgeInsetMm - cfg.angleLegMm / 2);
    const stripFramed = bendingMPa({
      widthMm: cfg.spreadMm, tMm: t, spanMm: cantMm * 4, pointN: cfg.leanLoadN
    });
    const allow = cfg.concreteFlexuralMPa / cfg.safety;
    const under = topMm - t;

    return {
      t,
      massKg: area * (t / 1000) * 2400,
      underMm: under,
      // Сколько остаётся прибору: закладная заподлицо со стяжкой,
      // сверху ляжет плитка
      clearForApplianceMm: under,
      applianceFits: under >= applianceH * 1000,
      fieldMPa: field,
      fieldOk: field <= allow,
      stripFreeMPa: stripFree,
      stripOkFree: stripFree <= allow,
      stripFramedMPa: stripFramed,
      stripOkFramed: stripFramed <= allow,
      cantileverMm: cantMm,
      // Что остаётся арматуре после защитного слоя сверху и снизу
      barMm: t - 2 * cfg.coverMm,
      barOk: t - 2 * cfg.coverMm >= 4,
      allowMPa: allow
    };
  });
}

// Задняя опора столешницы. Спереди стойки нужны через 600 — там они
// совпадают со стыками секций и держат кромку, за которую опираются руками.
// Сзади нагрузка та же, но условия другие: стойка ничему не мешает и её
// не видно, зато и часто ставить незачем.
//
// Ключ к решению: считать прогиб надо не у уголка, а у СВЯЗКИ уголка
// с плитой. Бетон 60 мм сам по себе почти не гнётся, уголок под ним —
// направляющая, а не балка.
export const ANGLE_40 = { Ix: 45800, W: 1596 }; // mm⁴ and mm³ for 40×40×4
export const E_STEEL = 210000; // MPa
export const E_CONCRETE = 25000;

export function backSpanCheck({ lineLoadNPerM, spanMm, slabT = 60, tributaryMm = 300 }) {
  const w = lineLoadNPerM / 1000; // N/mm
  const M = (w * spanMm ** 2) / 8;
  const sigma = M / ANGLE_40.W;
  const defAngle = (5 * w * spanMm ** 4) / (384 * E_STEEL * ANGLE_40.Ix);
  // Плита работает вместе с уголком и берёт на себя почти всё
  const Islab = (tributaryMm * slabT ** 3) / 12;
  const defSlab = (5 * w * spanMm ** 4) / (384 * E_CONCRETE * Islab);
  return {
    spanMm,
    momentNmm: M,
    sigmaMPa: sigma,
    deflAngleMm: defAngle,
    deflSlabMm: defSlab,
    // Совместная работа: сумма жёсткостей, а не сумма прогибов
    deflCombinedMm: 1 / (1 / defAngle + 1 / defSlab),
    ok: sigma < 160
  };
}

// Три способа держать заднюю кромку. Выбор можно отложить —
// закладные всё равно ставятся до заливки и стоят копейки.
export function backSupportOptions(worktop, screed) {
  const f = worktopFabrication(worktop, screed);
  if (!f) return null;
  const run = worktop.runM * 1000;
  const led = ledgerOption(worktop, screed);

  const mk = (id, name, pitch, note) => {
    const posts = Math.ceil(run / pitch) + 1;
    return { id, name, pitch, posts, note, ...backSpanCheck({ lineLoadNPerM: f.lineLoadNPerM, spanMm: pitch }) };
  };

  return {
    frontPosts: f.frames,
    frontPitch: f.framePitch,
    options: [
      mk('dense', 'Like the front, every 600', 600,
         'Maximum margin, but twice the metal and embeds'),
      mk('sparse', 'Every other one, pitch 1200', 1200,
         'Recommended: a post at the back gets in nobody’s way, but there is no point in setting them often'),
      {
        id: 'ledger',
        name: 'Wall angle instead of posts',
        pitch: null,
        posts: led.sidePosts,
        note: 'More room in the cabinets, but drilling aerated concrete and deciding BEFORE plastering. ' +
          'Impossible on the side branch: there is plasterboard',
        ledger: led
      }
    ]
  };
}

// Полный разбор варианта «уголок к стене вместо задних стоек».
// Он проходит НЕ ВЕЗДЕ: боковая ветка идёт вдоль гипсокартонной
// перегородки санузла, а она не несёт ничего.
export function ledgerOption(worktop, screed, pitchMm = LEDGER.pitch) {
  const f = worktopFabrication(worktop, screed);
  if (!f) return null;

  const check = wallLedgerCheck({ worktop, lineLoadNPerM: f.lineLoadNPerM, pitchMm });
  // Верхняя ветка идёт по газобетону, вертикальная — по перегородке из ГКЛ
  const topBranchM = Math.max(...worktop.polygon.map((p) => p.x)) -
    Math.min(...worktop.polygon.map((p) => p.x));
  const sideBranchM = worktop.runM - topBranchM;

  const sideFrames = Math.max(1, Math.round(sideBranchM / 0.6));
  const savedPosts = f.frames - sideFrames;

  return {
    ...check,
    topBranchM,
    sideBranchM,
    // На гипсокартоне уголок держать нельзя — там стойки остаются
    sidePosts: sideFrames * 2,
    savedPosts,
    postsWithLedger: f.posts - savedPosts,
    ledgerM: topBranchM,
    note: 'Aerated concrete holds the angle, the bathroom plasterboard partition does not'
  };
}
