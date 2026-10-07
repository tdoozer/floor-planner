import { describe, expect, it } from 'vitest';
import {
  BRANCHES, MCB_CURVES, PANEL, autonomyCost, emergencyPanel,
  socketBreaker, tripsInstantly
} from '../emergencyPanel.js';
import { CLEAR_HEIGHT, makeInitialProject } from '../../data/project.js';
import { getFixture } from '../../data/fixtures.js';
import { runRules } from '../rules.js';

const SW500L = 400; // Штиль SW500L, 500 ВА / 400 Вт

describe('щиток аварийного питания', () => {
  const ep = emergencyPanel({ inverterW: SW500L });

  it('расщепляет единственную выходную розетку ИБП на четыре ветки', () => {
    // У SW500L на выходе один Schuko — котёл с роутером в него вдвоём
    // не входят, так что щиток нужен не для красоты
    expect(ep.branches).toHaveLength(4);
    expect(ep.branches.map((b) => b.id)).toEqual(['boiler', 'router', 'light', 'socket']);
  });

  it('у каждой ветки свой аппарат — авария не доходит до котла', () => {
    // Это и есть инженерный ответ на исходное «на линию котла ничего»
    expect(ep.branches.every((b) => b.breaker > 0)).toBe(true);
    const socket = ep.branches.find((b) => b.id === 'socket');
    expect(socket.rcd).toBe(true);
    expect(socket.rcdMa).toBe(10);
    // Остальные ветки своего УЗО не требуют
    expect(ep.branches.filter((b) => b.rcd)).toHaveLength(1);
  });

  it('свет на ИБП — класса II, иначе он может дёрнуть общее УЗО', () => {
    const light = ep.branches.find((b) => b.id === 'light');
    expect(light.classII).toBe(true);
    expect(getFixture('light_ups').circuit).toBe('boiler');
  });

  it('помещается в бокс на 8 модулей с запасом', () => {
    expect(ep.modulesUsed).toBeLessThanOrEqual(PANEL.modules);
    expect(ep.modulesFree).toBeGreaterThan(0);
  });
});

describe('номинал автомата аварийной розетки', () => {
  const ep = emergencyPanel({ inverterW: SW500L });

  it('считается по остатку инвертора, а не по кабелю', () => {
    // Кабель 3×1,5 держит 16 А и в защите на 1 А не нуждается.
    // Защищать надо ИБП: 400 Вт минус постоянные 135.
    expect(ep.baseW).toBe(135);
    expect(ep.socket.spareW).toBe(265);
    expect(ep.socket.rating).toBe(1);
    expect(ep.socket.peakW).toBeLessThanOrEqual(SW500L);
    expect(ep.socket.fits).toBe(true);
  });

  it('пропускает зарядку и ноутбук, не пропускает чайник', () => {
    expect(ep.socket.allowedW).toBe(220);
    expect(220).toBeGreaterThan(65); // ноутбук
    expect(220).toBeLessThan(2000); // чайник
  });

  it('характеристика B, а не C — и это не вкусовщина', () => {
    // Чайник 2 кВт = 9,1 А = 9 номиналов автомата на 1 А.
    // B гарантирует мгновенный расцеп с 5 номиналов, C — только с 10.
    const onB = tripsInstantly({ loadW: 2000, rating: 1, curve: MCB_CURVES.B });
    const onC = tripsInstantly({ loadW: 2000, rating: 1, curve: MCB_CURVES.C });
    expect(onB.guaranteed).toBe(true);
    expect(onC.guaranteed).toBe(false);
    expect(BRANCHES.find((b) => b.id === 'socket').curve).toBe('B');
  });

  it('на более слабом инверторе розетке автомата может не остаться', () => {
    // 150 Вт: постоянных 135, свободно 15 Вт — это 0,07 А,
    // меньше самого мелкого номинала
    const tiny = emergencyPanel({ inverterW: 150 });
    expect(tiny.socket.rating).toBeNull();
    expect(tiny.socket.fits).toBe(false);
  });

  it('чем мощнее инвертор, тем крупнее допустимый автомат', () => {
    const big = socketBreaker({ inverterW: 1000, baseW: 135 });
    expect(big.rating).toBeGreaterThan(1);
    expect(big.peakW).toBeLessThanOrEqual(1000);
  });
});

describe('цена автономии', () => {
  // Банк 2 × 100 А·ч отдаёт 1020 Вт·ч, online-ИБП ест 30 Вт сам
  const rows = autonomyCost({
    usableWh: 1020, idleW: 30, loads: [
      { name: 'котёл', watts: 72 },
      { name: 'роутер', watts: 15 },
      { name: 'свет котельной', watts: 10 },
      { name: 'ноутбук', watts: 65 }
    ]
  });

  it('каждый ватт отнимает часы, и это видно построчно', () => {
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].hours).toBeLessThan(rows[i - 1].hours);
    }
  });

  it('свет котельной стоит меньше часа автономии', () => {
    const before = rows.find((r) => r.name === 'роутер').hours;
    const after = rows.find((r) => r.name === 'свет котельной').hours;
    expect(before - after).toBeLessThan(1);
  });

  it('ноутбук в розетке стоит почти трёх часов — это дорого', () => {
    const before = rows.find((r) => r.name === 'свет котельной').hours;
    const after = rows.find((r) => r.name === 'ноутбук').hours;
    expect(before - after).toBeGreaterThan(2.5);
  });
});

describe('аварийная линия в проекте', () => {
  const p = makeInitialProject();
  const onUps = p.equipment.filter((e) => e.circuit === 'boiler');

  it('розетка на ИБП ровно одна', () => {
    expect(onUps.filter((e) => e.catalogId === 'socket_ups')).toHaveLength(1);
    expect(onUps.filter((e) => e.catalogId === 'socket2')).toHaveLength(0);
  });

  it('светильники с БАП сидят на ОБЫЧНОЙ линии света, а не на ИБП', () => {
    // В этом вся идея: кабель от котельной к лестнице и наверх не тянем,
    // и работают они даже если отказал сам ИБП
    const baps = p.equipment.filter((e) => e.catalogId === 'light_bap');
    expect(baps.length).toBeGreaterThanOrEqual(2);
    expect(getFixture('light_bap').circuit).toBe('light');
    expect(getFixture('light_bap').emergency).toBe(true);
    baps.forEach((b) => expect(b.circuit).toBeUndefined());
  });

  it('правило щитка не ругается на текущем железе', () => {
    const hit = runRules(p, CLEAR_HEIGHT).find((r) => r.id === 'ups-panel');
    expect(hit).toBeTruthy();
    expect(hit.severity).toBe('info');
  });

  it('лишних розеток и не-класса-II правило не находит', () => {
    const ids = runRules(p, CLEAR_HEIGHT).map((r) => r.id);
    expect(ids).not.toContain('ups-socket-count');
    expect(ids).not.toContain('ups-light-class');
  });
});
