import { describe, expect, it } from 'vitest';
import {
  DESIGN_OUTDOOR_C, EXISTING, GROUP_LOADS, INDOOR, OUTDOOR, OUTDOOR_MIN_C,
  TRIP, inputCheck, panelFill, panelPlan, rcdChain, scenarioLoad, tripBand
} from '../panel.js';
import { CIRCUITS } from '../electrical.js';
import { SW500L } from '../ups.js';

describe('что стоит в уличном ящике сейчас', () => {
  it('прочитано с фотографии и зафиксировано', () => {
    expect(EXISTING.meter.model).toBe('Меркурий 203.1');
    expect(EXISTING.input.rating).toBe(32);
    expect(EXISTING.groups).toHaveLength(2);
  });

  it('реле напряжения без автовозврата — это и есть проблема', () => {
    // РММ47 сбрасывает автомат и оставляет его выключенным до ручного
    // взвода. В пустом доме одна просадка в январе = замороженный дом.
    expect(EXISTING.voltageRelay.autoReset).toBe(false);
    const kv = OUTDOOR.devices.find((d) => d.id === 'KV1');
    expect(kv.replace).toBe('РММ47');
    expect(kv.why).toMatch(/АВТОВОЗВРАТОМ/);
  });

  it('счётчик легитимен до 2028 и менять его не вам', () => {
    expect(EXISTING.meter.year + EXISTING.meter.calibrationYears).toBe(2028);
  });
});

describe('почему группировка уезжает в дом', () => {
  const p = panelPlan();

  it('на улице холоднее, чем допускают электронные дифавтоматы', () => {
    expect(DESIGN_OUTDOOR_C).toBeLessThan(OUTDOOR_MIN_C);
    expect(p.coldOutside).toBe(true);
    expect(p.coldMarginK).toBe(2);
  });

  it('ИБП на улицу нельзя вовсе — паспорт разрешает только от +5', () => {
    expect(SW500L.tempC[0]).toBeGreaterThan(0);
  });

  it('снятые с улицы групповые аппараты освобождают место под УЗО 300 мА', () => {
    // C25 это 1 модуль, АВДТ32 — 2. Ровно столько и нужно новому УЗО плюс запас.
    expect(p.freedModules).toBe(3);
    expect(p.outdoor.fits).toBe(true);
  });
});

describe('состав щитов', () => {
  const p = panelPlan();

  it('уличный щит влезает в 12 модулей', () => {
    expect(p.outdoor.used).toBeLessThanOrEqual(p.outdoor.modules);
  });

  it('внутренний щит собран не впритык', () => {
    expect(p.indoor.fits).toBe(true);
    expect(p.indoor.roomy).toBe(true);
    expect(p.indoor.free).toBeGreaterThanOrEqual(6);
  });

  it('каждая расчётная группа получила свой аппарат', () => {
    const inPanel = INDOOR.devices.filter((d) => d.circuit).map((d) => d.circuit).sort();
    const expected = Object.keys(CIRCUITS).filter((c) => !CIRCUITS[c].lowVoltage).sort();
    expect(inPanel).toEqual(expected);
  });

  it('дифавтомат на каждую розеточную группу, а не одно общее УЗО', () => {
    // Дом подолгу пустой: «выбило одно — погасло всё» дороже разницы в цене
    const rcbo = INDOOR.devices.filter((d) => d.width === 2 && d.circuit);
    expect(rcbo.length).toBeGreaterThanOrEqual(6);
  });

  it('свет остаётся без УЗО намеренно', () => {
    const light = INDOOR.devices.find((d) => d.circuit === 'light');
    expect(light.width).toBe(1); // обычный автомат, не дифавтомат
    expect(CIRCUITS.light.rcd).toBe(false);
  });

  it('переполнение щита ловится, а не проходит молча', () => {
    const tiny = panelFill({ modules: 4, devices: INDOOR.devices });
    expect(tiny.fits).toBe(false);
    expect(tiny.free).toBeLessThan(0);
  });
});

describe('проверка ввода C32', () => {
  const chk = inputCheck({ rating: 32 });

  it('длительный ток держится во всех сценариях', () => {
    expect(chk.sufficient).toBe(true);
  });

  it('но пик в праздник ввод уже не держит', () => {
    expect(chk.worst.peak.band).not.toBe('hold');
    expect(chk.worst.peakA).toBeGreaterThan(50);
  });

  it('кратковременный пик и длительный ток — разные вердикты', () => {
    // Именно поэтому «сумма мощностей» без длительности ничего не значит
    const cook = chk.rows.find((r) => r.id === 'cooking');
    expect(cook.sustained.band).toBe('hold');
    expect(cook.peak.band).not.toBe('hold');
  });

  it('до 1,13 номинала автомат не трогается вообще', () => {
    expect(tripBand(1.0).band).toBe('hold');
    expect(tripBand(TRIP.hold).band).toBe('hold');
    expect(tripBand(1.2).band).toBe('slow');
    expect(tripBand(6).band).toBe('instant');
  });

  it('установленная мощность вдвое больше ввода — и это нормально', () => {
    expect(chk.installedW).toBeGreaterThan(chk.limitW * 1.8);
    expect(chk.sufficient).toBe(true);
  });

  it('запаса на будущее у C32 нет', () => {
    // Обогреватель, сауна или зарядка машины сюда уже не влезут
    expect(chk.headroomW).toBeLessThan(3500);
  });

  it('нагрузки заданы двумя числами, а не одним', () => {
    Object.values(GROUP_LOADS).forEach((g) => {
      expect(g.peak).toBeGreaterThanOrEqual(g.sustained);
    });
    expect(scenarioLoad(['kitchen'], 'peak')).toBeGreaterThan(scenarioLoad(['kitchen'], 'sustained'));
  });
});

describe('селективность по утечке', () => {
  const chain = rcdChain();

  it('три ступени сверху вниз, каждая чувствительнее', () => {
    for (let i = 1; i < chain.length - 1; i++) {
      expect(chain[i].ma).toBeLessThanOrEqual(chain[i - 1].ma);
    }
  });

  it('вводное — тип S, иначе ступеней не получится', () => {
    // Без выдержки времени противопожарное будет выбивать
    // одновременно с групповым, и смысл каскада пропадёт
    expect(chain[0].ma).toBe(300);
    expect(chain[0].type).toBe('S');
  });

  it('санузел чувствительнее общих групп', () => {
    expect(CIRCUITS.bath.rcdMa).toBe(10);
    expect(chain.find((c) => c.at.includes('санузел')).ma).toBe(10);
  });
});
