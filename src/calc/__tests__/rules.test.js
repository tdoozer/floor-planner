import { describe, expect, it } from 'vitest';

import { runRules } from '../rules.js';
import {
  CLEAR_HEIGHT,
  VARIANT_IDS,
  contentRevision,
  makeInitialProject
} from '../../data/project.js';
import { connectionPoints } from '../../data/fixtures.js';
import { floorEstimate } from '../estimate.js';
import { drainFit, drainRoute, floorLevels, insulationOptions, riserPoint } from '../geometry.js';

function ids(warnings) {
  return warnings.map((w) => w.id);
}

// Запас по уклону для конкретного прибора — вспомогательная функция тестов
function drainMargin(project, catalogId) {
  const riser = project.nodes.find((n) => n.type === 'sewer_riser');
  const item = project.equipment.find((e) => e.catalogId === catalogId);
  const c = connectionPoints(item).find((p) => p.kind === 'drain');
  const route = drainRoute(c, riserPoint(riser));
  return {
    routeLength: route.length,
    ...drainFit({
      routeLength: route.length,
      dia: c.dia,
      riserInvertM: riser.invert,
      screed: project.screed
    })
  };
}

describe('runRules — стартовая планировка', () => {
  const project = makeInitialProject();
  const warnings = runRules(project, CLEAR_HEIGHT);

  it('всегда сообщает о неподтверждённых привязках', () => {
    expect(ids(warnings)).toContain('unconfirmed');
  });

  it('на исходной геометрии сливы помещаются в пирог пола', () => {
    const drainErrors = warnings.filter((w) => w.id.startsWith('drain-') && w.severity === 'error');
    expect(drainErrors).toHaveLength(0);
  });

  it('приборы не накладываются друг на друга', () => {
    expect(warnings.filter((w) => w.id.startsWith('overlap-'))).toHaveLength(0);
  });

  it('варочная панель дотягивается до ввода газа', () => {
    // Ввод замерен в самом углу и перенести его нельзя — он заложен
    // в проект газоснабжения дома. Панель стоит у правого конца фронта:
    // 0,56 м при пределе 1,5. В САМ угол её загонять не потребовалось.
    expect(warnings.find((w) => w.id === 'gas-eq-hob')).toBeUndefined();
  });

  it('панель, уехавшая к холодильнику, снова не дотягивается', () => {
    const project = makeInitialProject();
    project.equipment = project.equipment.map((e) =>
      e.catalogId === 'hob_gas' ? { ...e, x: 1.0 } : e
    );
    const gas = runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'gas-eq-hob');
    expect(gas).toBeDefined();
    expect(gas.severity).toBe('warn');
  });
});

describe('runRules — уклон канализации', () => {
  it('унитаз, утащенный от стояка, ломает уклон', () => {
    const project = makeInitialProject();
    project.equipment = project.equipment.map((e) =>
      e.catalogId === 'wc' ? { ...e, x: 0.3, y: 5.0 } : e
    );
    const warnings = runRules(project, CLEAR_HEIGHT);
    const err = warnings.find((w) => w.id.startsWith('drain-') && w.severity === 'error');
    expect(err).toBeDefined();
    expect(err.title).toContain('не помещается');
  });

  it('утолщение ЭППС само по себе не ломает слив — лимит даёт стяжка', () => {
    const project = makeInitialProject();
    project.screed = { ...project.screed, insulation: 200 };
    const warnings = runRules(project, CLEAR_HEIGHT);
    expect(warnings.filter((w) => w.id.startsWith('drain-') && w.severity === 'error')).toHaveLength(0);
  });
});

describe('runRules — высота под маршем', () => {
  it('душевая под нижней частью марша получает предупреждение', () => {
    const project = makeInitialProject();
    project.equipment = project.equipment.map((e) =>
      e.catalogId === 'shower' ? { ...e, x: 4.6, y: 3.4 } : e
    );
    const warnings = runRules(project, CLEAR_HEIGHT);
    const head = warnings.find((w) => w.id.startsWith('head-'));
    expect(head).toBeDefined();
    expect(head.title).toContain('мало высоты');
  });

  it('в исходной расстановке душевая стоит в высокой части', () => {
    const project = makeInitialProject();
    const warnings = runRules(project, CLEAR_HEIGHT);
    expect(warnings.find((w) => w.id === 'head-eq-shower')).toBeUndefined();
  });
});

describe('runRules — сдвиг проёма над санузлом', () => {
  it('предлагаемый пологий марш требует сдвинуть проём', () => {
    const project = makeInitialProject();
    const warnings = runRules(project, CLEAR_HEIGHT);
    const w = warnings.find((x) => x.id === 'stair-opening');
    expect(w).toBeDefined();
    // Проём с 1,80 м до 1,00 м = 800 мм
    expect(w.title).toContain('800');
  });

  it('если марш оставить в границах существующего проёма, сдвиг не нужен', () => {
    const project = makeInitialProject();
    project.stair = { ...project.stair, y: 1.8, length: 2.6 };
    const warnings = runRules(project, CLEAR_HEIGHT);
    expect(warnings.find((x) => x.id === 'stair-opening')).toBeUndefined();
    // ...зато марш перестаёт помещаться — это и есть нынешняя крутизна
    expect(warnings.find((x) => x.id === 'stair-run')).toBeDefined();
  });

  it('в исходном положении и заход, и площадка не меньше метра', () => {
    const warnings = runRules(makeInitialProject(), CLEAR_HEIGHT);
    expect(warnings.find((x) => x.id === 'stair-approach')).toBeUndefined();
    expect(warnings.find((x) => x.id === 'stair-landing')).toBeUndefined();
  });

  it('удлинение марша вверх съедает площадку на втором этаже', () => {
    const project = makeInitialProject();
    project.stair = { ...project.stair, y: 0.6, length: 3.8 };
    const w = runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'stair-landing');
    expect(w).toBeDefined();
    expect(w.severity).toBe('error');
    expect(w.title).toContain('600');
  });

  it('сдвиг марша вниз съедает заход перед нижней ступенью', () => {
    const project = makeInitialProject();
    project.stair = { ...project.stair, y: 1.4 }; // низ уезжает на 4,80
    const w = runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'stair-approach');
    expect(w).toBeDefined();
    expect(w.severity).toBe('error');
    expect(w.title).toContain('700');
  });

  it('подбор молчит: принятый марш уже проходит все критерии', () => {
    // 15 подступенков 200 × 243 приняты заказчиком, подсказывать нечего
    const p = makeInitialProject();
    expect(p.stair.risers).toBe(15);
    expect(runRules(p, CLEAR_HEIGHT).find((x) => x.id === 'stair-best')).toBeUndefined();
  });

  it('но на прежних 17 подступенках подбор снова предлагает 15', () => {
    const p = makeInitialProject();
    p.stair = { ...p.stair, risers: 17, tread: 3.4 / 16 };
    const w = runRules(p, CLEAR_HEIGHT).find((x) => x.id === 'stair-best');
    expect(w).toBeDefined();
    expect(w.title).toContain('15');
  });

  it('после применения подбора подсказка исчезает', () => {
    const project = makeInitialProject();
    project.stair = { ...project.stair, risers: 15, tread: 3.5 / 14, length: 3.5, y: 1.0 };
    expect(runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'stair-best')).toBeUndefined();
    // ...и заход остаётся ровно метром — минимум соблюдён
    expect(runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'stair-approach')).toBeUndefined();
  });
});

describe('runRules — замеренные проёмы против подвижных перегородок', () => {
  it('в исходной планировке каждый проём в своём помещении', () => {
    const warnings = runRules(makeInitialProject(), CLEAR_HEIGHT);
    expect(warnings.filter((w) => w.id.startsWith('opening-room-'))).toHaveLength(0);
  });

  it('сдвиг перегородки мимо глухого окна ловится', () => {
    // Окно 1400…2300 от левого нижнего угла привязано замером,
    // а перегородка прихожей должна идти сразу за ним (3200).
    const project = makeInitialProject();
    project.layout = { ...project.layout, hallY: 4.4 };
    const w = runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'opening-room-win-w-blind');
    expect(w).toBeDefined();
    expect(w.detail).toContain('Прихожая-котельная');
  });
});

describe('Варианты планировки', () => {
  it.each(VARIANT_IDS)('вариант %s собирается без ошибок уклона', (variantId) => {
    const project = makeInitialProject(variantId);
    const warnings = runRules(project, CLEAR_HEIGHT);
    expect(warnings.filter((w) => w.id.startsWith('drain-') && w.severity === 'error')).toHaveLength(0);
  });

  it.each(VARIANT_IDS)('в варианте %s приборы не накладываются', (variantId) => {
    const warnings = runRules(makeInitialProject(variantId), CLEAR_HEIGHT);
    expect(warnings.filter((w) => w.id.startsWith('overlap-'))).toHaveLength(0);
  });

  it.each(VARIANT_IDS)('в варианте %s приборы не вылезают за помещение', (variantId) => {
    const warnings = runRules(makeInitialProject(variantId), CLEAR_HEIGHT);
    expect(warnings.filter((w) => w.id.startsWith('bounds-'))).toHaveLength(0);
  });

  it('перенос санузла влево заметно удлиняет трассу слива унитаза', () => {
    const right = drainMargin(makeInitialProject('bathRight'), 'wc');
    const left = drainMargin(makeInitialProject('bathLeft'), 'wc');
    // Стояк замерен у правого верхнего угла: слева трасса через весь дом
    expect(left.routeLength).toBeGreaterThan(right.routeLength + 3);
    expect(left.marginMm).toBeLessThan(right.marginMm);
    expect(left.ok).toBe(true);
  });

  it('в варианте «санузел слева» утолщение стяжки ломает уклон унитаза', () => {
    const project = makeInitialProject('bathLeft');
    project.screed = { ...project.screed, screedTotal: 130 };
    expect(drainMargin(project, 'wc').ok).toBe(false);

    const warnings = runRules(project, CLEAR_HEIGHT);
    expect(warnings.find((w) => w.id.startsWith('drain-') && w.severity === 'error')).toBeDefined();
  });

  it('в варианте «санузел справа» тот же запас стяжки безопасен', () => {
    const project = makeInitialProject('bathRight');
    project.screed = { ...project.screed, screedTotal: 130 };
    expect(drainMargin(project, 'wc').ok).toBe(true);
  });

  it('мойка в углу у стояка даёт очень короткий слив', () => {
    const left = drainMargin(makeInitialProject('bathLeft'), 'sink');
    expect(left.routeLength).toBeLessThan(1.0);
  });
});

describe('Кухня под лестницей (вариант bathLeft)', () => {
  const project = makeInitialProject('bathLeft');
  const warnings = runRules(project, CLEAR_HEIGHT);

  it('нижние шкафы под маршем проходят по высоте', () => {
    expect(warnings.filter((w) => w.id.startsWith('head-eq-wt'))).toHaveLength(0);
    expect(warnings.find((w) => w.id === 'head-eq-oven')).toBeUndefined();
  });

  it('высокий холодильник под марш бы не поместился', () => {
    const moved = makeInitialProject('bathLeft');
    moved.equipment = moved.equipment.map((e) =>
      e.catalogId === 'fridge' ? { ...e, x: 4.85, y: 2.0 } : e
    );
    const w = runRules(moved, CLEAR_HEIGHT).find((x) => x.id === 'head-eq-fridge');
    expect(w).toBeDefined();
  });

  it('мойка под низким маршем даёт подсказку по эргономике, а не запрет', () => {
    const moved = makeInitialProject('bathLeft');
    moved.equipment = moved.equipment.map((e) =>
      e.catalogId === 'sink' ? { ...e, x: 4.85, y: 2.4 } : e
    );
    const list = runRules(moved, CLEAR_HEIGHT);
    expect(list.find((x) => x.id === 'work-eq-sink')?.severity).toBe('info');
    expect(list.find((x) => x.id === 'head-eq-sink')).toBeUndefined();
  });
});

describe('runRules — засыпка подполья песком', () => {
  it('подбор засыпки по умолчанию оставляет пол на месте', () => {
    const project = makeInitialProject();
    const lv = floorLevels(project.levels, project.screed);
    expect(Math.abs(lv.floorDelta)).toBeLessThanOrEqual(5);
    expect(lv.floorToFloor).toBeCloseTo(3000, 0);
  });

  it('засыпки почти нет — уплотнять надо СУЩЕСТВУЮЩИЙ песок', () => {
    const project = makeInitialProject();
    const all = runRules(project, CLEAR_HEIGHT);
    const w = all.find((x) => x.id === 'fill-compaction');
    expect(w).toBeDefined();
    // Подпол оказался 390, а не 900: досыпка 46 мм — один проход
    expect(w.title).toContain('1');

    // Зато появилось правило про рыхлое основание — оно теперь главное
    const loose = all.find((x) => x.id === 'crawl-compaction');
    expect(loose).toBeDefined();
    expect(loose.severity).toBe('error');
  });

  it('утолщение пирога поднимает пол и режет высоту помещения', () => {
    const project = makeInitialProject();
    project.screed = { ...project.screed, insulation: 300, gravel: 300 };
    const lv = floorLevels(project.levels, project.screed);
    expect(lv.floorDelta).toBeGreaterThan(300);
    expect(lv.clearHeight).toBeLessThan(project.levels.clearHeightNow);
    expect(lv.floorToFloor).toBeLessThan(3000);
  });

  it('ревизия считается из содержимого, а не проставляется руками', () => {
    const a = makeInitialProject();
    const b = makeInitialProject();
    // Один и тот же проект — одна и та же ревизия
    expect(a.meta.revision).toBe(b.meta.revision);
    expect(a.meta.revision).toBeGreaterThan(0);
  });

  it('любое изменение стартовых данных даёт новую ревизию', () => {
    const base = makeInitialProject();
    const { meta, ...content } = base;

    // Толщина утеплителя
    expect(contentRevision({ ...content, screed: { ...content.screed, insulation: 200 } }))
      .not.toBe(meta.revision);
    // Отметка засыпки
    expect(contentRevision({ ...content, levels: { ...content.levels, sandFill: 999 } }))
      .not.toBe(meta.revision);
    // Сдвинутая розетка
    expect(contentRevision({
      ...content,
      equipment: content.equipment.map((e) => (e.id === 'el-tv' ? { ...e, x: 1 } : e))
    })).not.toBe(meta.revision);
    // Ширина лестницы
    expect(contentRevision({ ...content, stair: { ...content.stair, width: 1.1 } }))
      .not.toBe(meta.revision);
  });

  // Мойка теперь линейная, но повёрнутые приборы на кухне остались:
  // проверка габаритов должна считать их по фактическому контуру, а не
  // по осевой рамке — иначе духовка на боковой ветке даст ложное наложение.
  it('повёрнутая духовка не даёт ложных наложений', () => {
    const p = makeInitialProject();
    const oven = p.equipment.find((e) => e.id === 'eq-oven');
    expect(oven.rotation).toBe(90);
    const bad = runRules(p, CLEAR_HEIGHT).filter((w) => w.id.includes('eq-oven'));
    expect(bad).toHaveLength(0);
  });

  it('но настоящее наложение всё равно ловится', () => {
    const p = makeInitialProject();
    p.equipment = p.equipment.map((e) =>
      e.id === 'eq-store1' ? { ...e, x: 2.9, y: 0.06 } : e
    );
    const bad = runRules(p, CLEAR_HEIGHT).filter((w) => w.id.startsWith('overlap-'));
    expect(bad.length).toBeGreaterThan(0);
  });

  it('навесные шкафы в проверках пола не участвуют', () => {
    const p = makeInitialProject();
    const walls = p.equipment.filter((e) => e.id.startsWith('eq-wall'));
    expect(walls.length).toBeGreaterThan(3);
    const bad = runRules(p, CLEAR_HEIGHT).filter((w) => w.id.includes('eq-wall'));
    expect(bad).toHaveLength(0);
  });

  it('утепление торца заложено — ошибки нет', () => {
    const p = makeInitialProject();
    // 100 мм: та же плита, что в поле. 80 мм в рознице почти не встречается
    expect(p.levels.edgeInsulation).toBe(100);
    expect(p.levels.edgeInsulationDepth).toBe(500);
    const w = runRules(p, CLEAR_HEIGHT).find((x) => x.id === 'edge-insulation');
    expect(w).toBeUndefined();
  });

  it('без утепления торца — ошибка, а не пожелание', () => {
    const p = makeInitialProject();
    p.levels = { ...p.levels, edgeInsulation: 0, edgeInsulationDepth: 0 };
    const w = runRules(p, CLEAR_HEIGHT).find((x) => x.id === 'edge-insulation');
    expect(w).toBeDefined();
    expect(w.severity).toBe('error');
    expect(w.fix).toContain('ДО засыпки');
  });

  it('с заложенным утеплением торца ошибка снимается', () => {
    const project = makeInitialProject();
    project.levels = { ...project.levels, edgeInsulation: 100, edgeInsulationDepth: 500, edgeTop: 0 };
    const w = runRules(project, CLEAR_HEIGHT);
    expect(w.find((x) => x.id === 'edge-insulation')).toBeUndefined();
    expect(w.find((x) => x.id === 'edge-top')).toBeUndefined();
    expect(w.find((x) => x.id === 'edge-depth')).toBeUndefined();
  });

  it('утепление «до низа стяжки» ловится как ошибка', () => {
    const project = makeInitialProject();
    // Верх утеплителя на уровне низа стяжки: 12 покрытия + 70 стяжки
    project.levels = {
      ...project.levels,
      edgeInsulation: 80,
      edgeInsulationDepth: 500,
      edgeTop: project.screed.finishThickness + project.screed.screedTotal
    };
    const w = runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'edge-top');
    expect(w).toBeDefined();
    expect(w.severity).toBe('error');
    // Непокрытыми остаются ровно 70 мм стяжки с трубой
    expect(w.detail).toContain('70');
  });

  it('слишком мелкое заглубление торца — предупреждение', () => {
    const project = makeInitialProject();
    project.levels = { ...project.levels, edgeInsulation: 80, edgeInsulationDepth: 150, edgeTop: 0 };
    const w = runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'edge-depth');
    expect(w).toBeDefined();
    expect(w.fix).toContain('400–600');
  });

  // Профиль торца СТУПЕНЧАТЫЙ: 100 мм плиты нельзя довести до чистого пола,
  // она отняла бы по 100 мм комнаты с каждой стороны, и керамогранит
  // пришлось бы обрывать в 100 мм от стены. Наверху работает лента.
  it('на высоте стяжки разрыв тонкий, а не плита в 100 мм', () => {
    const p = makeInitialProject();
    expect(p.levels.edgeStrip).toBe(10);
    expect(p.levels.edgeStrip).toBeLessThan(p.levels.edgeInsulation);
    expect(runRules(p, CLEAR_HEIGHT).find((x) => x.id === 'edge-strip')).toBeUndefined();
  });

  it('край стяжки без ленты — ошибка: и мостик, и расширение', () => {
    const p = makeInitialProject();
    p.levels = { ...p.levels, edgeStrip: 0 };
    const w = runRules(p, CLEAR_HEIGHT).find((x) => x.id === 'edge-strip');
    expect(w).toBeDefined();
    expect(w.severity).toBe('error');
  });

  it('плита торца считается только ниже стяжки', () => {
    const p = makeInitialProject();
    const band = p.screed.screedTotal + p.screed.finishThickness;
    const est = floorEstimate({
      layout: p.layout, screed: p.screed, levels: p.levels,
      loops: { totalPipe: 218, totalLoops: 4 }, coolant: p.coolant
    });
    const row = est.items.find((i) => i.name.includes('на торец плиты'));
    // 500 глубины минус 82 мм стяжки с покрытием, а не все 500
    expect(row.note).toContain(String(p.levels.edgeInsulationDepth - band));
  });
});

describe('runRules — переиспользование старого ЭППС', () => {
  it('требует подтвердить марку старых плит', () => {
    const w = runRules(makeInitialProject(), CLEAR_HEIGHT).find((x) => x.id === 'reused-strength');
    expect(w).toBeDefined();
    expect(w.detail).toContain('250 кПа');
  });

  it('подтверждение марки снимает предупреждение', () => {
    const project = makeInitialProject();
    project.screed = { ...project.screed, reusedStrengthConfirmed: true };
    expect(runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'reused-strength')).toBeUndefined();
  });

  it('подсказывает порядок слоёв: новый вниз, старый вторым', () => {
    const w = runRules(makeInitialProject(), CLEAR_HEIGHT).find((x) => x.id === 'reused-position');
    expect(w).toBeDefined();
    // 120 общих − 25 старых = 95 новых
    expect(w.detail).toContain('100');
  });

  it('утепление только из старых плит — ошибка', () => {
    const project = makeInitialProject();
    project.screed = { ...project.screed, insulation: 25 };
    const w = runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'reused-only');
    expect(w).toBeDefined();
    expect(w.severity).toBe('error');
  });
});

describe('Выбор толщины утеплителя', () => {
  it('толще утеплитель — меньше поток вниз и меньше песка', () => {
    const project = makeInitialProject();
    const opts = insulationOptions(project.screed, project.levels, 30.25, [75, 125]);
    const [thin, thick] = opts;
    expect(thick.watts).toBeLessThan(thin.watts);
    expect(thick.sandNeeded).toBeLessThan(thin.sandNeeded);
    // Каждые 50 мм утеплителя — ровно 50 мм песка, который не надо трамбовать
    expect(thin.sandNeeded - thick.sandNeeded).toBeCloseTo(50, 6);
  });

  it('разница между 75 и 125 мм — единицы ватт на весь этаж', () => {
    const project = makeInitialProject();
    const [thin, thick] = insulationOptions(project.screed, project.levels, 30.25, [75, 125]);
    expect(thin.watts - thick.watts).toBeLessThan(60);
    expect(thin.watts - thick.watts).toBeGreaterThan(10);
  });
});

describe('runRules — перегородки', () => {
  it('сдвиг перегородки прихожей не ломает проверки', () => {
    const project = makeInitialProject();
    project.layout = { ...project.layout, hallX: 2.4, hallY: 3.2 };
    expect(() => runRules(project, CLEAR_HEIGHT)).not.toThrow();
  });
});

describe('runRules — стяжка над трубой', () => {
  it('тонкая стяжка даёт ошибку по защитному слою', () => {
    const project = makeInitialProject();
    project.screed = { ...project.screed, screedTotal: 55 };
    const warnings = runRules(project, CLEAR_HEIGHT);
    expect(ids(warnings)).toContain('screed-cover');
  });

  it('70 мм над трубой Ø16 проходит', () => {
    const project = makeInitialProject();
    const warnings = runRules(project, CLEAR_HEIGHT);
    expect(ids(warnings)).not.toContain('screed-cover');
  });
});

describe('runRules — эргономика расстановки', () => {
  const w = runRules(makeInitialProject(), CLEAR_HEIGHT);

  // Обеденная группа отодвинута: рабочий проход 1000, дверца духовки свободна
  it('в принятой расстановке проход у кухни в норме', () => {
    expect(w.find((x) => x.id === 'kitchen-aisle')).toBeUndefined();
    const ok = w.find((x) => x.id === 'kitchen-aisle-ok');
    expect(ok.severity).toBe('info');
    expect(ok.title).toContain('1000');
  });

  it('дверцы встроенной техники ни во что не упираются', () => {
    expect(w.filter((x) => x.id.startsWith('door-swing-'))).toHaveLength(0);
  });

  // Наложения предметов НЕТ — они разнесены, и проверка габаритов молчит.
  // Но человеку у плиты нужен метр, и это отдельная проверка.
  it('придвинутая обратно лавка ловится, хотя пересечений нет', () => {
    const p = makeInitialProject();
    p.equipment = p.equipment.map((e) => (e.id === 'eq-bench-n' ? { ...e, y: 0.9 } : e));
    const r = runRules(p, CLEAR_HEIGHT).find((x) => x.id === 'kitchen-aisle');
    expect(r).toBeDefined();
    expect(r.severity).toBe('error');
    expect(r.title).toContain('300');
    expect(r.detail).toContain('Наложения предметов при этом НЕТ');
    expect(r.fix).toContain('мышкой');
  });

  it('и тогда же дверца духовки перестаёт открываться', () => {
    const p = makeInitialProject();
    p.equipment = p.equipment.map((e) => {
      if (e.id === 'eq-bench-n') return { ...e, y: 0.9 };
      if (e.id === 'eq-oven') return { ...e, x: 0.94, y: 0.06, rotation: 0 };
      return e;
    });
    const r = runRules(p, CLEAR_HEIGHT).find((x) => x.id === 'door-swing-eq-oven');
    expect(r).toBeDefined();
    expect(r.detail).toContain('противень');
  });
});

describe('runRules — мойка под окном', () => {
  const withSink = () => {
    const p = makeInitialProject();
    p.equipment = p.equipment.map((e) =>
      e.id === 'eq-sink'
        ? { ...e, catalogId: 'sink', rotation: 0, x: 1.26, y: 0.06, w: undefined, d: undefined }
        : e
    );
    return p;
  };

  it('замеренный подоконник 960 попал в модель', () => {
    const win = makeInitialProject().openings.find((o) => o.id === 'win-n1');
    expect(win.sill).toBe(0.96);
  });

  it('мойка на 1260 встаёт по центру ГЛУХОЙ створки, а не окна', () => {
    const p = withSink();
    const win = p.openings.find((o) => o.id === 'win-n1');
    const sink = p.equipment.find((e) => e.id === 'eq-sink');
    const blindCentre = win.start + win.len / 4;
    expect(Math.abs(sink.x + 0.3 - blindCentre)).toBeLessThan(0.25);
    expect(sink.x + 0.3).toBeLessThan(win.start + win.len / 2);
  });

  it('створки описаны: левая глухая, правая поворотно-откидная', () => {
    const win = makeInitialProject().openings.find((o) => o.id === 'win-n1');
    expect(win.sashes).toBe(2);
    expect(win.openingSash).toBe('right');
  });

  // Решает не высота подоконника сама по себе, а какая створка над краном.
  // Под глухой половиной сносить смеситель нечем — складной не нужен.
  it('кран под глухой половиной — это справка, а не проблема', () => {
    const r = runRules(withSink(), CLEAR_HEIGHT).find((x) => x.id === 'sink-under-window');
    expect(r).toBeDefined();
    expect(r.severity).toBe('info');
    expect(r.detail).toContain('Складной не нужен');
    expect(r.title).toContain('60');
  });

  it('мойка, уехавшая под открывающуюся створку, — предупреждение', () => {
    const p = makeInitialProject();
    p.equipment = p.equipment.map((e) =>
      e.id === 'eq-sink'
        ? { ...e, catalogId: 'sink', rotation: 0, x: 1.7, y: 0.06, w: undefined, d: undefined }
        : e
    );
    const r = runRules(p, CLEAR_HEIGHT).find((x) => x.id === 'sink-under-window');
    expect(r.severity).toBe('warn');
    expect(r.title).toContain('снесёт');
    expect(r.fix).toContain('глухую');
  });

  it('в принятой расстановке мойка уже под окном и под глухой створкой', () => {
    const r = runRules(makeInitialProject(), CLEAR_HEIGHT)
      .find((x) => x.id === 'sink-under-window');
    expect(r).toBeDefined();
    expect(r.severity).toBe('info');
  });
});
