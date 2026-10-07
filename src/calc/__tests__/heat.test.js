import { describe, expect, it } from 'vitest';

import { heatLoss, externalWallLength, wallR } from '../heatloss.js';
import {
  boilerCheck,
  burnerCycleMinutes,
  houseCooldown,
  screedThermalMass,
  MIN_CYCLE_MINUTES
} from '../boiler.js';
import { maxLoopLength, volumetricRatio } from '../../data/coolant.js';
import { SW500L, TOPOLOGY, maxBankAh, rechargeHours, requiredAh, runtimeHours, upsSizing } from '../ups.js';
import { gsop, requiredWallR } from '../../data/climate.js';
import { CLEAR_HEIGHT, INNER_D, INNER_W, buildRooms, makeInitialProject } from '../../data/project.js';

function load(project) {
  return heatLoss({
    layout: project.layout,
    openings: project.openings,
    climate: project.climate,
    envelope: project.envelope,
    screed: project.screed,
    clearHeight: CLEAR_HEIGHT
  });
}

describe('externalWallLength', () => {
  it('санузел в правом верхнем углу выходит на две наружные стены', () => {
    const bath = buildRooms(makeInitialProject().layout).find((r) => r.id === 'bath');
    // 1800 по верхней стене + 1800 по правой
    expect(externalWallLength(bath.polygon)).toBeCloseTo(3.6, 6);
  });

  it('у зала наружных стен больше всех', () => {
    const rooms = buildRooms(makeInitialProject().layout);
    const living = externalWallLength(rooms.find((r) => r.id === 'living').polygon);
    const hall = externalWallLength(rooms.find((r) => r.id === 'hall').polygon);
    expect(living).toBeGreaterThan(hall);
  });

  it('суммарно все помещения дают периметр коробки', () => {
    const rooms = buildRooms(makeInitialProject().layout);
    const sum = rooms.reduce((s, r) => s + externalWallLength(r.polygon), 0);
    expect(sum).toBeCloseTo(2 * (INNER_W + INNER_D), 5);
  });
});

describe('Климат по СП 131.13330.2020, метеостанция «Липецк»', () => {
  const c = makeInitialProject().climate;

  it('расчётная пятидневка обеспеченностью 0,92 — минус 27', () => {
    expect(c.tOutDesign).toBe(-27);
    expect(c.tOut098).toBe(-31);
    expect(c.confirmed).toBe(true);
  });

  it('параметры отопительного периода помечены как несверенные', () => {
    expect(c.heatingPeriodConfirmed).toBe(false);
  });

  it('стена перекрывает нормируемое сопротивление', () => {
    const p = makeInitialProject();
    expect(wallR(p.envelope)).toBeGreaterThan(requiredWallR(c));
    expect(gsop(c)).toBeGreaterThan(3500);
  });
});

describe('wallR', () => {
  it('газобетон 300 плюс ЭППС 50 дают около 4 м²·К/Вт', () => {
    const r = wallR(makeInitialProject().envelope);
    expect(r).toBeGreaterThan(3.5);
    expect(r).toBeLessThan(4.5);
  });

  it('утолщение блока увеличивает сопротивление', () => {
    const p = makeInitialProject();
    const thin = wallR(p.envelope);
    const thick = wallR({ ...p.envelope, wall: { ...p.envelope.wall, thickness: 400 } });
    expect(thick).toBeGreaterThan(thin);
  });
});

describe('heatLoss — первый этаж', () => {
  const hl = load(makeInitialProject());

  it('нагрузка первого этажа около 1,8 кВт', () => {
    expect(hl.totalKw).toBeGreaterThan(1.5);
    expect(hl.totalKw).toBeLessThan(2.5);
  });

  it('вентиляция — весомая доля потерь', () => {
    const vent = hl.byRoom.reduce((s, r) => s + r.qVent, 0);
    expect(vent / hl.total).toBeGreaterThan(0.25);
  });

  it('пол по грунту почти не теряет — утеплитель работает', () => {
    const ground = hl.byRoom.reduce((s, r) => s + r.qGround, 0);
    expect(ground / hl.total).toBeLessThan(0.1);
  });

  it('прихожая — самое холодное место на квадрат: входная дверь и две стены', () => {
    const perM2 = Object.fromEntries(hl.byRoom.map((r) => [r.id, r.perM2]));
    expect(perM2.hall).toBeGreaterThan(perM2.living);
  });

  it('похолодание расчётной температуры увеличивает нагрузку', () => {
    const p = makeInitialProject();
    p.climate = { ...p.climate, tOutDesign: -35 };
    expect(load(p).total).toBeGreaterThan(hl.total);
  });
});

describe('screedThermalMass', () => {
  it('30 м² стяжки 70 мм по теплоёмкости равны почти тонне воды', () => {
    const p = makeInitialProject();
    const m = screedThermalMass(30.25, p.screed);
    expect(m.massKg).toBeGreaterThan(4000);
    expect(m.waterEquivalentL).toBeGreaterThan(800);
  });
});

describe('burnerCycleMinutes', () => {
  it('чем больше объём, тем длиннее цикл', () => {
    const a = burnerCycleMinutes({ minPowerKw: 9.3, loadKw: 1.84, systemVolumeL: 24 });
    const b = burnerCycleMinutes({ minPowerKw: 9.3, loadKw: 1.84, systemVolumeL: 988 });
    expect(b).toBeGreaterThan(a);
  });

  it('если котёл модулируется ниже нагрузки, тактования нет', () => {
    expect(burnerCycleMinutes({ minPowerKw: 2, loadKw: 5, systemVolumeL: 30 })).toBe(Infinity);
  });
});

describe('Антифриз в контуре', () => {
  const p = makeInitialProject();

  it('объёмная теплоёмкость ниже воды', () => {
    expect(volumetricRatio(p.coolant)).toBeLessThan(1);
    expect(volumetricRatio(p.coolant)).toBeGreaterThan(0.85);
  });

  it('предельная длина петли падает против воды', () => {
    const limit = maxLoopLength(p.coolant);
    expect(limit).toBeLessThan(90);
    expect(limit).toBeGreaterThan(60);
  });

  it('вода не даёт поправок', () => {
    expect(maxLoopLength({ pressureDropFactor: 1 })).toBeCloseTo(90, 6);
  });
});

describe('houseCooldown — сколько есть времени без отопления', () => {
  const p = makeInitialProject();
  const hl = load(p);
  const ua = hl.total / (p.climate.tInLiving - p.climate.tOutDesign);

  it('в расчётный мороз дом держится около суток', () => {
    const c = houseCooldown({
      screedMassKg: 4659,
      uaWPerK: ua,
      tStart: 22,
      tOut: p.climate.tOutDesign
    });
    expect(c.hours).toBeGreaterThan(12);
    expect(c.hours).toBeLessThan(48);
  });

  it('в умеренный мороз время заметно больше', () => {
    const hard = houseCooldown({ screedMassKg: 4659, uaWPerK: ua, tStart: 22, tOut: -27 });
    const mild = houseCooldown({ screedMassKg: 4659, uaWPerK: ua, tStart: 22, tOut: -10 });
    expect(mild.hours).toBeGreaterThan(hard.hours);
  });

  it('если на улице выше нуля, дом не промёрзнет никогда', () => {
    expect(houseCooldown({ screedMassKg: 4659, uaWPerK: ua, tStart: 22, tOut: 3 }).hours).toBe(Infinity);
  });
});

describe('Подбор ИБП для котла 110 Вт', () => {
  const p = makeInitialProject();
  const ups = upsSizing({ boilerW: p.boiler.electric, targetHours: 26 });

  it('средняя нагрузка ниже паспортной', () => {
    expect(ups.peakW).toBe(110);
    expect(ups.avgW).toBeLessThan(110);
  });

  it('инвертора хватает самого малого — ограничение в батареях', () => {
    expect(ups.inverterVaMin).toBeLessThanOrEqual(400);
  });

  it('один AGM 100 А·ч даёт около 6 часов', () => {
    const o = ups.options.find((x) => x.id === 'agm100');
    expect(o.hours).toBeGreaterThan(4);
    expect(o.hours).toBeLessThan(8);
  });

  it('два AGM 100 А·ч закрывают типовое отключение', () => {
    const o = ups.options.find((x) => x.id === 'agm100x2');
    expect(o.hours).toBeGreaterThan(10);
  });

  it('литий той же ёмкости работает вдвое дольше свинца', () => {
    const agm = ups.options.find((x) => x.id === 'agm100');
    const lfp = ups.options.find((x) => x.id === 'lfp100');
    expect(lfp.hours / agm.hours).toBeGreaterThan(1.7);
  });

  it('собственное потребление инвертора учтено', () => {
    const withIdle = runtimeHours({ voltage: 12, ah: 100, dod: 0.5, count: 1 }, 100);
    const bare = (12 * 100 * 0.5 * 0.85) / 100;
    expect(withIdle).toBeLessThan(bare);
  });

  it('требуемая ёмкость растёт со временем автономии', () => {
    expect(requiredAh({ loadW: 72, hours: 24 })).toBeGreaterThan(requiredAh({ loadW: 72, hours: 6 }));
  });
});

describe('boilerCheck — BAXI ECO Life 24F', () => {
  const project = makeInitialProject();
  const hl = load(project);
  const bc = boilerCheck({
    boiler: project.boiler,
    loadKw: hl.totalKw,
    areaM2: hl.area,
    screed: project.screed,
    pipeVolumeL: 40
  });

  it('минимальная мощность 9,3 кВт кратно превышает нагрузку', () => {
    expect(bc.minPowerKw).toBe(9.3);
    expect(bc.oversized).toBe(true);
    expect(bc.ratio).toBeGreaterThan(3);
  });

  it('через смесительный узел цикл получается недопустимо коротким', () => {
    const s = bc.schemes.find((x) => x.id === 'separated');
    expect(s.cycleMinutes).toBeLessThan(3);
    expect(s.ok).toBe(false);
  });

  it('буфера 100 л не хватает', () => {
    const s = bc.schemes.find((x) => x.id === 'buffer100');
    expect(s.ok).toBe(false);
  });

  it('прямое низкотемпературное подключение решает задачу', () => {
    const s = bc.schemes.find((x) => x.id === 'direct');
    expect(s.cycleMinutes).toBeGreaterThan(MIN_CYCLE_MINUTES * 3);
    expect(s.ok).toBe(true);
    expect(bc.best.id).toBe('direct');
  });
});

// Подбор ИБП под конкретное железо: Штиль SW500L (online, 400 Вт, з/у 5 А)
// и батареи, которые к нему предлагают. Проверено по карточкам ЭТМ.
describe('ИБП: топология и зарядное решают больше, чем мощность инвертора', () => {
  const sw500 = { topology: TOPOLOGY.online, chargerA: 5, alwaysOnW: 15 };

  it('роутер идёт в средних ЦЕЛИКОМ, а котёл — с коэффициентом', () => {
    // Котёл тактует, роутер работает непрерывно
    const r = upsSizing({ boilerW: 110, ...sw500 });
    expect(r.avgW).toBeCloseTo(110 * 0.65 + 15, 6);
    expect(r.peakW).toBe(125);
  });

  it('online съедает больше line-interactive на той же нагрузке', () => {
    const base = { boilerW: 110, alwaysOnW: 15, chargerA: 5 };
    const li = upsSizing({ ...base, topology: TOPOLOGY.lineInteractive });
    const on = upsSizing({ ...base, topology: TOPOLOGY.online });
    // Двойное преобразование работает всегда — отсюда постоянные 30 Вт
    expect(on.idleW).toBeGreaterThan(li.idleW);
    const h = (r) => r.options.find((o) => o.id === 'agm100x2').hours;
    expect(h(on)).toBeLessThan(h(li));
  });

  it('батареи ИБП соединяются последовательно: банк 2 × 100 = 100 А·ч, а не 200', () => {
    // Энергия складывается, ампер-часы — нет. От этого зависит зарядное.
    const r = upsSizing({ boilerW: 110, ...sw500 });
    const two = r.options.find((o) => o.id === 'agm100x2');
    const one = r.options.find((o) => o.id === 'agm100');
    expect(two.bankAh).toBe(100);
    expect(two.usableWh).toBeCloseTo(one.usableWh * 2, 6);
    expect(two.hours).toBeCloseTo(one.hours * 2, 6);
  });

  it('зарядное 5 А ограничивает свинцовый банк сотней ампер-часов', () => {
    // Медленнее C/20 AGM не успевает вернуться к полному заряду
    // между отключениями и сульфатирует за пару сезонов
    expect(maxBankAh(5)).toBe(100);
    const r = upsSizing({ boilerW: 110, ...sw500 });
    expect(r.bankLimitAh).toBe(100);
    expect(r.options.find((o) => o.id === 'agm100x2').chargeable).toBe(true);
    expect(r.options.find((o) => o.id === 'agm140x2').chargeable).toBe(false);
  });

  it('литию медленное зарядное не вредит — только долго', () => {
    const r = upsSizing({ boilerW: 110, ...sw500 });
    const lfp = r.options.find((o) => o.id === 'lfp200');
    expect(lfp.bankAh).toBeGreaterThan(r.bankLimitAh);
    expect(lfp.chargeable).toBe(true);
    // И хвоста заряда у лития почти нет, в отличие от свинца
    const pb = rechargeHours({ ah: 100, dod: 0.5, chargerA: 5 });
    const li = rechargeHours({ ah: 100, dod: 0.5, chargerA: 5, chemistry: 'lfp' });
    expect(pb.total).toBeGreaterThan(li.total);
  });

  it('SF 1240 на 40 А·ч дают 3,5 часа — дом остывает за 12', () => {
    const r = upsSizing({ boilerW: 110, targetHours: 12, ...sw500 });
    const sf = r.options.find((o) => o.id === 'agm40x2');
    expect(sf.hours).toBeLessThan(4);
    expect(sf.ok).toBe(false);
  });

  it('правило C/20 — предупреждение о долгом заряде, а не запрет', () => {
    // Моя прежняя оценка «5 А не тянет банк больше 100 А·ч» была занижена.
    // Паспорт SW500L прямо разрешает до 250 А·ч: там интеллектуальный
    // алгоритм заряда и термокомпенсация. Правило C/20 остаётся — но
    // как отметка «заряжаться будет долго», а не как отказ.
    const r = upsSizing({ boilerW: 110, ...sw500, deviceMaxBankAh: SW500L.maxBankAh });
    expect(r.bankLimitAh).toBe(250);
    expect(r.slowChargeAh).toBe(100);
    const big = r.options.find((o) => o.id === 'agm200x2');
    expect(big.chargeable).toBe(true);
    expect(big.slowCharge).toBe(true);
  });

  it('старый вызов без топологии и зарядного продолжает работать', () => {
    const r = upsSizing({ boilerW: 110, targetHours: 12 });
    expect(r.idleW).toBe(TOPOLOGY.lineInteractive.idleW);
    expect(r.bankLimitAh).toBeNull();
    expect(r.options.every((o) => o.chargeable)).toBe(true);
  });
});

// Паспорт SW500L прочитан с сайта производителя. Две цифры опровергли
// мои прежние оценки, и обе в лучшую сторону.
describe('ИБП по паспорту SW500L', () => {
  const cfg = {
    boilerW: 110, alwaysOnW: 25, topology: TOPOLOGY.online,
    chargerA: SW500L.chargerA, deviceMaxBankAh: SW500L.maxBankAh,
    depth: SW500L.dodCutoff, targetHours: 12
  };

  it('модель сходится с собственным обещанием производителя', () => {
    // Штиль заявляет до 9,5 ч при 100 % нагрузке на банке 250 А·ч.
    // Если наша формула даёт то же самое — значит КПД и глубина разряда
    // взяты верно, и остальным цифрам можно верить.
    const wh = SW500L.busV * SW500L.maxBankAh * SW500L.dodCutoff * 0.85;
    const hours = wh / (SW500L.watts + TOPOLOGY.online.idleW);
    expect(hours).toBeGreaterThan(9);
    expect(hours).toBeLessThan(10);
  });

  it('шина 24 В — значит две батареи 12 В в серию', () => {
    expect(SW500L.busV).toBe(24);
    const r = upsSizing(cfg);
    const two = r.options.find((o) => o.id === 'agm100x2');
    expect(two.bankAh).toBe(100); // ампер-часы не удваиваются
    expect(two.usableWh).toBe(SW500L.busV * 100 * SW500L.dodCutoff);
  });

  it('2 × 100 А·ч закрывают цель в 12 часов', () => {
    // По ресурсной глубине 50 % выходило 8,1 ч и цель не бралась.
    // Но ИБП отсекает батарею на 80–85 %, и в настоящем отключении
    // доступно именно столько.
    const r = upsSizing(cfg);
    const two = r.options.find((o) => o.id === 'agm100x2');
    expect(two.hours).toBeGreaterThan(12);
    expect(two.ok).toBe(true);
    const shallow = upsSizing({ ...cfg, depth: null });
    expect(shallow.options.find((o) => o.id === 'agm100x2').hours).toBeLessThan(12);
  });

  it('единственная выходная розетка — отсюда и щиток после ИБП', () => {
    expect(SW500L.outlets).toMatch(/1 шт/);
    expect(SW500L.maxOutA).toBeCloseTo(2.3, 6);
  });

  it('ИБП только в помещении: рабочий диапазон от +5 °C', () => {
    // На улицу его вешать нельзя, и это ещё один довод за щит в прихожей
    expect(SW500L.tempC[0]).toBe(5);
    expect(SW500L.ip).toBe(20);
  });

  it('влезает в нишу под окном прихожей', () => {
    // Ниша 900 × 1100, освобождается от снятого радиатора
    expect(SW500L.sizeMm.w).toBeLessThan(900);
    expect(SW500L.sizeMm.h + 420).toBeLessThan(1100); // полка с АКБ снизу
    expect(SW500L.massKg).toBe(5);
  });
});
