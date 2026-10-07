import { describe, expect, it } from 'vitest';

import {
  CABLE_OD_MM,
  CIRCUITS,
  IN_FLOOR,
  cableRoutes,
  electricalPlan,
  electricalPoints,
  switchCoverage
} from '../electrical.js';
import { CLEAR_HEIGHT, makeInitialProject } from '../../data/project.js';
import { getFixture } from '../../data/fixtures.js';
import { runRules } from '../rules.js';

const project = makeInitialProject();
const entry = project.nodes.find((n) => n.type === 'electrical_panel');
const plan = electricalPlan({ equipment: project.equipment, entry });

describe('electricalPoints', () => {
  it('выбирает из расстановки только электрику', () => {
    const pts = electricalPoints(project.equipment);
    expect(pts.length).toBeGreaterThan(15);
    expect(pts.every((p) => p.id.startsWith('el-'))).toBe(true);
  });

  it('у каждой точки есть группа и отметка', () => {
    electricalPoints(project.equipment).forEach((p) => {
      expect(CIRCUITS[p.circuit]).toBeDefined();
      expect(p.mountHeight).toBeGreaterThan(0);
    });
  });

  it('выключатели ниже светильников', () => {
    const pts = electricalPoints(project.equipment);
    const sw = pts.find((p) => p.catalogId === 'switch1');
    const light = pts.find((p) => p.catalogId === 'light');
    expect(sw.mountHeight).toBeLessThan(light.mountHeight);
  });
});

describe('cableRoutes', () => {
  it('в трассах нет диагоналей', () => {
    plan.routes.forEach((r) => {
      for (let i = 1; i < r.points.length; i++) {
        const dx = Math.abs(r.points[i].x - r.points[i - 1].x);
        const dy = Math.abs(r.points[i].y - r.points[i - 1].y);
        expect(Math.min(dx, dy)).toBeLessThan(1e-6);
      }
    });
  });

  it('каждая трасса идёт в своей полосе', () => {
    const lanes = plan.routes.map((r) => r.corridorX);
    expect(new Set(lanes).size).toBe(lanes.length);
  });

  it('кабеля нужно больше, чем длина трассы по полу', () => {
    plan.routes.forEach((r) => expect(r.cableM).toBeGreaterThan(r.runM));
  });

  it('дальняя точка требует больше кабеля, чем ближняя', () => {
    const sorted = [...plan.routes].sort((a, b) => a.runM - b.runM);
    expect(sorted[sorted.length - 1].cableM).toBeGreaterThan(sorted[0].cableM);
  });

  it('перенос точки меняет трассу', () => {
    const moved = project.equipment.map((e) =>
      e.id === 'el-tv' ? { ...e, x: 0.5, y: 0.5 } : e
    );
    const before = plan.routes.find((r) => r.id === 'el-tv').runM;
    const after = electricalPlan({ equipment: moved, entry })
      .routes.find((r) => r.id === 'el-tv').runM;
    expect(after).not.toBeCloseTo(before, 2);
  });
});

describe('Электроточки и проёмы', () => {
  it('ни одна точка не стоит в проёме', () => {
    const bad = runRules(project, CLEAR_HEIGHT).filter((w) => w.id.startsWith('el-in-opening'));
    expect(bad.map((w) => w.id)).toEqual([]);
  });

  it('точку, задвинутую в дверь, правило ловит', () => {
    const p = makeInitialProject();
    // Дверь прихожая→зал: проём 3300…4100 на перегородке x = 2.0
    p.equipment = p.equipment.map((e) =>
      e.id === 'el-sw-living' ? { ...e, x: 2.02, y: 3.7 } : e
    );
    const bad = runRules(p, CLEAR_HEIGHT).filter((w) => w.id.startsWith('el-in-opening'));
    expect(bad.length).toBeGreaterThan(0);
    expect(bad[0].severity).toBe('error');
  });

  it('розетка НИЖЕ подоконника проёмом не считается', () => {
    const p = makeInitialProject();
    // Окно верхней стены 1000…2300, подоконник 960.
    // Розетки холодильника и посудомойки стоят под ним, на отметке 150.
    const dw = p.equipment.find((e) => e.id === 'el-dishwasher');
    expect(dw.x).toBeGreaterThan(1.0);
    expect(dw.x).toBeLessThan(2.3);
    const bad = runRules(p, CLEAR_HEIGHT).filter((w) => w.id.includes('el-dishwasher'));
    expect(bad).toHaveLength(0);
  });

  it('но блок на 1100 в том же месте — уже конфликт', () => {
    const p = makeInitialProject();
    p.equipment = p.equipment.map((e) =>
      e.id === 'el-kitchen-block' ? { ...e, x: 1.6 } : e
    );
    const bad = runRules(p, CLEAR_HEIGHT).filter((w) => w.id.includes('el-kitchen-block'));
    expect(bad.length).toBeGreaterThan(0);
  });
});

describe('Перекрытие: проводка по дереву', () => {
  it('межбалочное пространство пустое — доступ снизу', () => {
    expect(project.ceiling.cavityFilled).toBe(false);
    expect(project.ceiling.subfloor).toBe(false);
  });

  it('утеплитель между этажами нужен для ЗВУКА, а не тепла', () => {
    // Мансарда отапливается — две спальни с радиаторами
    expect(project.ceiling.insulationPurpose).toBe('acoustic');
  });

  it('правило про металлорукав срабатывает', () => {
    const w = runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'ceiling-wiring');
    expect(w).toBeDefined();
    expect(w.detail).toContain('металлорукав');
  });

  it('и напоминает, что окно доступа временное', () => {
    const w = runRules(project, CLEAR_HEIGHT).find((x) => x.id === 'ceiling-access-window');
    expect(w).toBeDefined();
  });
});

describe('electricalPlan — группы', () => {
  // Отдельная линия осталась одна — духовой шкаф: 3,5 кВт выбирают
  // 3×2,5 на автомате 16 А целиком, делить её не с кем.
  it('на отдельной линии остался только духовой шкаф', () => {
    const app = plan.byCircuit.find((g) => g.circuit === 'appliance');
    expect(app.lines).toBe(app.count);
    expect(app.count).toBe(1);
    expect(app.points[0].id).toBe('el-oven');
  });

  it('холодильник и посудомойка объединены в одну группу', () => {
    const g = plan.byCircuit.find((c) => c.circuit === 'kitchenApp');
    expect(g.count).toBe(2);
    expect(g.lines).toBe(1);
    // 0,3 + 2,2 кВт против 3,5 кВт, которые несёт 3×2,5 на 16 А
    expect(CIRCUITS.kitchenApp.load).toBeLessThan(3500);
  });

  it('стиральная машина идёт группой санузла, а не своей линией', () => {
    const g = plan.byCircuit.find((c) => c.circuit === 'bath');
    expect(g.points.map((p) => p.id)).toContain('el-washer');
    // мокрая зона — УЗО 10 мА, а не общие 30
    expect(CIRCUITS.bath.rcdMa).toBe(10);
  });

  it('аварийная линия несёт ровно то, что решено, и ничего сверх', () => {
    const g = plan.byCircuit.find((c) => c.circuit === 'boiler');
    // Линия перестала быть «только котёл»: на ИБП сознательно добавлены
    // роутер, свет котельной и одна розетка. Исходное возражение — чужая
    // авария не должна гасить отопление — снято НЕ обещанием, а щитком
    // после ИБП, где у каждой ветки свой аппарат. См. calc/emergencyPanel.js.
    expect(g.points.map((p) => p.id).sort()).toEqual([
      'el-boiler', 'el-l-ups', 'el-panel-ups', 'el-router', 'el-soc-ups', 'el-sw-ups'
    ]);
    expect(g.breaker).toBe(6);
  });

  it('на аварийной линии ровно одна розетка — остальное несъёмное', () => {
    // Инвертор 400 Вт. Всё, что сюда попадает, должно быть заведомо мелким.
    // Светильник и щиток мелкие по определению, котёл известен по паспорту,
    // а вот РОЗЕТКА — единственный элемент, содержимое которого заранее
    // неизвестно. Поэтому её должно быть ровно одна, и с автоматом
    // по остатку инвертора (см. calc/emergencyPanel.js).
    const g = plan.byCircuit.find((c) => c.circuit === 'boiler');
    const sockets = g.points.filter((p) => p.catalogId === 'socket_ups');
    expect(sockets).toHaveLength(1);
    // Обычных розеток на этой линии быть не должно вовсе
    expect(g.points.some((p) => p.catalogId === 'socket2')).toBe(false);
  });

  it('групп стало семь вместо девяти', () => {
    expect(plan.breakers).toBe(7);
  });

  it('кабели в полу разнесены достаточно, чтобы не снижать ток', () => {
    // Просвет между соседними трассами не меньше двух диаметров —
    // тогда снижающий коэффициент по ПУЭ не применяется
    expect(plan.bundle.clearanceMm).toBeGreaterThanOrEqual(2 * CABLE_OD_MM);
    expect(plan.bundle.derating).toBe(1);
  });

  it('освещение тянется не по полу', () => {
    expect(IN_FLOOR.has('light')).toBe(false);
    const light = plan.byCircuit.find((g) => g.circuit === 'light');
    expect(light.inFloor).toBe(false);
  });

  it('розеточные группы идут по полу', () => {
    plan.byCircuit
      .filter((g) => g.circuit !== 'light' && !g.lowVoltage)
      .forEach((g) => expect(g.inFloor).toBe(true));
  });

  it('слаботочка в стяжку не идёт вовсе', () => {
    // Силовой кабель переживёт дом, а стандарты слаботочки — нет.
    // Замуровать витую пару в бетон значит закопать её навсегда.
    expect(IN_FLOOR.has('data')).toBe(false);
    const data = plan.byCircuit.find((g) => g.circuit === 'data');
    expect(data.inFloor).toBe(false);
    expect(data.lowVoltage).toBe(true);
  });

  it('в полу кабеля меньше, чем всего', () => {
    expect(plan.inFloorM).toBeGreaterThan(0);
    expect(plan.inFloorM).toBeLessThan(plan.totalCableM);
  });

  it('автоматов хватает на все силовые группы', () => {
    // Слаботочка автомата не занимает и в силовой щит не идёт
    const power = plan.byCircuit.filter((g) => !g.lowVoltage);
    expect(plan.breakers).toBeGreaterThanOrEqual(power.length);
  });

  it('санузел на своей группе с УЗО', () => {
    expect(CIRCUITS.bath.rcd).toBe(true);
    expect(plan.byCircuit.some((g) => g.circuit === 'bath')).toBe(true);
  });

  it('без точки ввода план пустой, но не падает', () => {
    const empty = electricalPlan({ equipment: project.equipment, entry: null });
    expect(empty.routes).toEqual([]);
    expect(empty.totalCableM).toBe(0);
  });
});

describe('двухклавишные проходные на свет зала', () => {
  const p = makeInitialProject();
  const at = (id) => p.equipment.find((e) => e.id === id);

  it('оба конца проходной схемы — проходные выключатели', () => {
    // Раньше на входе стоял обычный одноклавишный: так проходная схема
    // физически не работает, проходным должен быть КАЖДЫЙ из двух
    expect(at('el-sw-living').catalogId).toBe('switch2_way');
    expect(at('el-sw-living-2').catalogId).toBe('switch2_way');
    expect(getFixture('switch2_way').twoWay).toBe(true);
    expect(getFixture('switch2_way').gangs).toBe(2);
  });

  it('пара ссылается друг на друга в обе стороны', () => {
    expect(at('el-sw-living').pairWith).toBe('el-sw-living-2');
    expect(at('el-sw-living-2').pairWith).toBe('el-sw-living');
  });

  it('клавиши совпадают у обоих концов — группа к группе', () => {
    expect(at('el-sw-living').groups).toEqual(at('el-sw-living-2').groups);
  });

  it('свет зала разбит на две группы, ни одна лампа не потеряна', () => {
    const g = at('el-sw-living').groups;
    expect(g).toHaveLength(2);
    const all = g.flat().sort();
    // Светильник с БАП — обычная лампа, просто с аккумулятором внутри:
    // он висит на той же клавише, что и остальной свет зала, и в аварию
    // зажигается сам. Отдельного управления ему не нужно.
    expect(all).toEqual(['el-bap-living', 'el-l1', 'el-l2', 'el-l3']);
  });

  it('подсветка лестницы осталась отдельной парой с мансардой', () => {
    const st = at('el-sw-stair');
    expect(st.catalogId).toBe('switch_way');
    expect(st.pairWith).toBe('MANSARD');
  });

  it('все лампы по-прежнему кем-то управляются', () => {
    const cov = switchCoverage(p.equipment);
    expect(cov.orphanLights).toHaveLength(0);
  });

  it('свет зала доступен из двух мест', () => {
    const cov = switchCoverage(p.equipment);
    ['el-l1', 'el-l2', 'el-l3'].forEach((id) =>
      expect(cov.dualControlled).toContain(id)
    );
  });
});
