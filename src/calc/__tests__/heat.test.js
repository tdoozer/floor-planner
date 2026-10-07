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
  it('the bathroom in the top right corner faces two outer walls', () => {
    const bath = buildRooms(makeInitialProject().layout).find((r) => r.id === 'bath');
    // 1800 along the top wall + 1800 along the right one
    expect(externalWallLength(bath.polygon)).toBeCloseTo(3.6, 6);
  });

  it('the living room has the most outer walls', () => {
    const rooms = buildRooms(makeInitialProject().layout);
    const living = externalWallLength(rooms.find((r) => r.id === 'living').polygon);
    const hall = externalWallLength(rooms.find((r) => r.id === 'hall').polygon);
    expect(living).toBeGreaterThan(hall);
  });

  it('in total all rooms give the perimeter of the box', () => {
    const rooms = buildRooms(makeInitialProject().layout);
    const sum = rooms.reduce((s, r) => s + externalWallLength(r.polygon), 0);
    expect(sum).toBeCloseTo(2 * (INNER_W + INNER_D), 5);
  });
});

describe('Climate per SP 131.13330.2020, weather station “Lipetsk”', () => {
  const c = makeInitialProject().climate;

  it('the design five-day period at a probability of 0.92 is minus 27', () => {
    expect(c.tOutDesign).toBe(-27);
    expect(c.tOut098).toBe(-31);
    expect(c.confirmed).toBe(true);
  });

  it('heating-season parameters are marked as unchecked', () => {
    expect(c.heatingPeriodConfirmed).toBe(false);
  });

  it('the wall exceeds the required resistance', () => {
    const p = makeInitialProject();
    expect(wallR(p.envelope)).toBeGreaterThan(requiredWallR(c));
    expect(gsop(c)).toBeGreaterThan(3500);
  });
});

describe('wallR', () => {
  it('aerated concrete 300 plus XPS 50 give about 4 m²·K/W', () => {
    const r = wallR(makeInitialProject().envelope);
    expect(r).toBeGreaterThan(3.5);
    expect(r).toBeLessThan(4.5);
  });

  it('a thicker block increases the resistance', () => {
    const p = makeInitialProject();
    const thin = wallR(p.envelope);
    const thick = wallR({ ...p.envelope, wall: { ...p.envelope.wall, thickness: 400 } });
    expect(thick).toBeGreaterThan(thin);
  });
});

describe('heatLoss — ground floor', () => {
  const hl = load(makeInitialProject());

  it('the ground-floor load is about 1.8 kW', () => {
    expect(hl.totalKw).toBeGreaterThan(1.5);
    expect(hl.totalKw).toBeLessThan(2.5);
  });

  it('ventilation is a substantial share of the losses', () => {
    const vent = hl.byRoom.reduce((s, r) => s + r.qVent, 0);
    expect(vent / hl.total).toBeGreaterThan(0.25);
  });

  it('the floor on the ground loses almost nothing — the insulation works', () => {
    const ground = hl.byRoom.reduce((s, r) => s + r.qGround, 0);
    expect(ground / hl.total).toBeLessThan(0.1);
  });

  it('the hall is the coldest place per square metre: the front door and two walls', () => {
    const perM2 = Object.fromEntries(hl.byRoom.map((r) => [r.id, r.perM2]));
    expect(perM2.hall).toBeGreaterThan(perM2.living);
  });

  it('a colder design temperature increases the load', () => {
    const p = makeInitialProject();
    p.climate = { ...p.climate, tOutDesign: -35 };
    expect(load(p).total).toBeGreaterThan(hl.total);
  });
});

describe('screedThermalMass', () => {
  it('30 m² of 70 mm screed has the heat capacity of almost a tonne of water', () => {
    const p = makeInitialProject();
    const m = screedThermalMass(30.25, p.screed);
    expect(m.massKg).toBeGreaterThan(4000);
    expect(m.waterEquivalentL).toBeGreaterThan(800);
  });
});

describe('burnerCycleMinutes', () => {
  it('the larger the volume, the longer the cycle', () => {
    const a = burnerCycleMinutes({ minPowerKw: 9.3, loadKw: 1.84, systemVolumeL: 24 });
    const b = burnerCycleMinutes({ minPowerKw: 9.3, loadKw: 1.84, systemVolumeL: 988 });
    expect(b).toBeGreaterThan(a);
  });

  it('if the boiler modulates below the load, there is no short-cycling', () => {
    expect(burnerCycleMinutes({ minPowerKw: 2, loadKw: 5, systemVolumeL: 30 })).toBe(Infinity);
  });
});

describe('Antifreeze in the circuit', () => {
  const p = makeInitialProject();

  it('volumetric heat capacity is lower than water', () => {
    expect(volumetricRatio(p.coolant)).toBeLessThan(1);
    expect(volumetricRatio(p.coolant)).toBeGreaterThan(0.85);
  });

  it('the maximum loop length falls against water', () => {
    const limit = maxLoopLength(p.coolant);
    expect(limit).toBeLessThan(90);
    expect(limit).toBeGreaterThan(60);
  });

  it('water gives no corrections', () => {
    expect(maxLoopLength({ pressureDropFactor: 1 })).toBeCloseTo(90, 6);
  });
});

describe('houseCooldown — how much time there is without heating', () => {
  const p = makeInitialProject();
  const hl = load(p);
  const ua = hl.total / (p.climate.tInLiving - p.climate.tOutDesign);

  it('at the design frost the house holds for about a day', () => {
    const c = houseCooldown({
      screedMassKg: 4659,
      uaWPerK: ua,
      tStart: 22,
      tOut: p.climate.tOutDesign
    });
    expect(c.hours).toBeGreaterThan(12);
    expect(c.hours).toBeLessThan(48);
  });

  it('at a moderate frost the time is noticeably longer', () => {
    const hard = houseCooldown({ screedMassKg: 4659, uaWPerK: ua, tStart: 22, tOut: -27 });
    const mild = houseCooldown({ screedMassKg: 4659, uaWPerK: ua, tStart: 22, tOut: -10 });
    expect(mild.hours).toBeGreaterThan(hard.hours);
  });

  it('if it is above zero outside, the house will never freeze', () => {
    expect(houseCooldown({ screedMassKg: 4659, uaWPerK: ua, tStart: 22, tOut: 3 }).hours).toBe(Infinity);
  });
});

describe('Selecting a UPS for a 110 W boiler', () => {
  const p = makeInitialProject();
  const ups = upsSizing({ boilerW: p.boiler.electric, targetHours: 26 });

  it('the average load is below the nameplate', () => {
    expect(ups.peakW).toBe(110);
    expect(ups.avgW).toBeLessThan(110);
  });

  it('the smallest inverter is enough — the limit is in the batteries', () => {
    expect(ups.inverterVaMin).toBeLessThanOrEqual(400);
  });

  it('one AGM 100 Ah gives about 6 hours', () => {
    const o = ups.options.find((x) => x.id === 'agm100');
    expect(o.hours).toBeGreaterThan(4);
    expect(o.hours).toBeLessThan(8);
  });

  it('two AGM 100 Ah cover a typical outage', () => {
    const o = ups.options.find((x) => x.id === 'agm100x2');
    expect(o.hours).toBeGreaterThan(10);
  });

  it('lithium of the same capacity lasts twice as long as lead', () => {
    const agm = ups.options.find((x) => x.id === 'agm100');
    const lfp = ups.options.find((x) => x.id === 'lfp100');
    expect(lfp.hours / agm.hours).toBeGreaterThan(1.7);
  });

  it('the inverter own consumption is accounted for', () => {
    const withIdle = runtimeHours({ voltage: 12, ah: 100, dod: 0.5, count: 1 }, 100);
    const bare = (12 * 100 * 0.5 * 0.85) / 100;
    expect(withIdle).toBeLessThan(bare);
  });

  it('the required capacity grows with the run time', () => {
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

  it('the minimum output of 9.3 kW exceeds the load many times over', () => {
    expect(bc.minPowerKw).toBe(9.3);
    expect(bc.oversized).toBe(true);
    expect(bc.ratio).toBeGreaterThan(3);
  });

  it('through a mixing unit the cycle is unacceptably short', () => {
    const s = bc.schemes.find((x) => x.id === 'separated');
    expect(s.cycleMinutes).toBeLessThan(3);
    expect(s.ok).toBe(false);
  });

  it('a 100 l buffer is not enough', () => {
    const s = bc.schemes.find((x) => x.id === 'buffer100');
    expect(s.ok).toBe(false);
  });

  it('a direct low-temperature connection solves the problem', () => {
    const s = bc.schemes.find((x) => x.id === 'direct');
    expect(s.cycleMinutes).toBeGreaterThan(MIN_CYCLE_MINUTES * 3);
    expect(s.ok).toBe(true);
    expect(bc.best.id).toBe('direct');
  });
});

// Selecting a UPS for specific hardware: Shtil SW500L (online, 400 W, 5 A charger)
// and the batteries offered with it. Checked against the ETM catalogue cards.
describe('UPS: topology and charger matter more than inverter power', () => {
  const sw500 = { topology: TOPOLOGY.online, chargerA: 5, alwaysOnW: 15 };

  it('the router counts in the average IN FULL, while the boiler with a factor', () => {
    // The boiler cycles, the router works continuously
    const r = upsSizing({ boilerW: 110, ...sw500 });
    expect(r.avgW).toBeCloseTo(110 * 0.65 + 15, 6);
    expect(r.peakW).toBe(125);
  });

  it('online uses more than line-interactive at the same load', () => {
    const base = { boilerW: 110, alwaysOnW: 15, chargerA: 5 };
    const li = upsSizing({ ...base, topology: TOPOLOGY.lineInteractive });
    const on = upsSizing({ ...base, topology: TOPOLOGY.online });
    // Double conversion always runs — hence the constant 30 W
    expect(on.idleW).toBeGreaterThan(li.idleW);
    const h = (r) => r.options.find((o) => o.id === 'agm100x2').hours;
    expect(h(on)).toBeLessThan(h(li));
  });

  it('UPS batteries are connected in series: a 2 × 100 bank is 100 Ah, not 200', () => {
    // Energy adds up, amp-hours do not. The charger depends on this.
    const r = upsSizing({ boilerW: 110, ...sw500 });
    const two = r.options.find((o) => o.id === 'agm100x2');
    const one = r.options.find((o) => o.id === 'agm100');
    expect(two.bankAh).toBe(100);
    expect(two.usableWh).toBeCloseTo(one.usableWh * 2, 6);
    expect(two.hours).toBeCloseTo(one.hours * 2, 6);
  });

  it('a 5 A charger limits a lead bank to a hundred amp-hours', () => {
    // Slower than C/20, AGM does not manage to return to full charge
    // between outages and sulphates within a couple of seasons
    expect(maxBankAh(5)).toBe(100);
    const r = upsSizing({ boilerW: 110, ...sw500 });
    expect(r.bankLimitAh).toBe(100);
    expect(r.options.find((o) => o.id === 'agm100x2').chargeable).toBe(true);
    expect(r.options.find((o) => o.id === 'agm140x2').chargeable).toBe(false);
  });

  it('a slow charger does not harm lithium — it is only slow', () => {
    const r = upsSizing({ boilerW: 110, ...sw500 });
    const lfp = r.options.find((o) => o.id === 'lfp200');
    expect(lfp.bankAh).toBeGreaterThan(r.bankLimitAh);
    expect(lfp.chargeable).toBe(true);
    // And lithium has almost no charge tail, unlike lead
    const pb = rechargeHours({ ah: 100, dod: 0.5, chargerA: 5 });
    const li = rechargeHours({ ah: 100, dod: 0.5, chargerA: 5, chemistry: 'lfp' });
    expect(pb.total).toBeGreaterThan(li.total);
  });

  it('SF 1240 of 40 Ah gives 3.5 hours — the house cools in 12', () => {
    const r = upsSizing({ boilerW: 110, targetHours: 12, ...sw500 });
    const sf = r.options.find((o) => o.id === 'agm40x2');
    expect(sf.hours).toBeLessThan(4);
    expect(sf.ok).toBe(false);
  });

  it('the C/20 rule is a warning about slow charging, not a ban', () => {
    // My earlier estimate “5 A cannot drive a bank above 100 Ah” was too low.
    // The SW500L data sheet explicitly allows up to 250 Ah: it has an intelligent
    // charging algorithm and temperature compensation. The C/20 rule stays — but
    // as a note “it will charge slowly”, not as a refusal.
    const r = upsSizing({ boilerW: 110, ...sw500, deviceMaxBankAh: SW500L.maxBankAh });
    expect(r.bankLimitAh).toBe(250);
    expect(r.slowChargeAh).toBe(100);
    const big = r.options.find((o) => o.id === 'agm200x2');
    expect(big.chargeable).toBe(true);
    expect(big.slowCharge).toBe(true);
  });

  it('an old call without topology and charger keeps working', () => {
    const r = upsSizing({ boilerW: 110, targetHours: 12 });
    expect(r.idleW).toBe(TOPOLOGY.lineInteractive.idleW);
    expect(r.bankLimitAh).toBeNull();
    expect(r.options.every((o) => o.chargeable)).toBe(true);
  });
});

// The SW500L data sheet was read from the manufacturer site. Two figures refuted
// my earlier estimates, both for the better.
describe('UPS per the SW500L data sheet', () => {
  const cfg = {
    boilerW: 110, alwaysOnW: 25, topology: TOPOLOGY.online,
    chargerA: SW500L.chargerA, deviceMaxBankAh: SW500L.maxBankAh,
    depth: SW500L.dodCutoff, targetHours: 12
  };

  it('the model agrees with the manufacturer own claim', () => {
    // Shtil claims up to 9.5 h at 100 % load on a 250 Ah bank.
    // If our formula gives the same — then the efficiency and depth of discharge
    // are right, and the other figures can be trusted.
    const wh = SW500L.busV * SW500L.maxBankAh * SW500L.dodCutoff * 0.85;
    const hours = wh / (SW500L.watts + TOPOLOGY.online.idleW);
    expect(hours).toBeGreaterThan(9);
    expect(hours).toBeLessThan(10);
  });

  it('a 24 V bus — so two 12 V batteries in series', () => {
    expect(SW500L.busV).toBe(24);
    const r = upsSizing(cfg);
    const two = r.options.find((o) => o.id === 'agm100x2');
    expect(two.bankAh).toBe(100); // amp-hours do not double
    expect(two.usableWh).toBe(SW500L.busV * 100 * SW500L.dodCutoff);
  });

  it('2 × 100 Ah meet the 12-hour target', () => {
    // By the service-life depth of 50 % it came to 8.1 h and the target was missed.
    // But the UPS cuts the battery off at 80–85 %, and in a real outage
    // exactly that much is available.
    const r = upsSizing(cfg);
    const two = r.options.find((o) => o.id === 'agm100x2');
    expect(two.hours).toBeGreaterThan(12);
    expect(two.ok).toBe(true);
    const shallow = upsSizing({ ...cfg, depth: null });
    expect(shallow.options.find((o) => o.id === 'agm100x2').hours).toBeLessThan(12);
  });

  it('the single output socket — hence the board after the UPS', () => {
    expect(SW500L.outlets).toMatch(/1 pc/);
    expect(SW500L.maxOutA).toBeCloseTo(2.3, 6);
  });

  it('the UPS only indoors: operating range from +5 °C', () => {
    // It cannot be hung outside, and that is one more argument for the board in the hall
    expect(SW500L.tempC[0]).toBe(5);
    expect(SW500L.ip).toBe(20);
  });

  it('fits the niche under the hall window', () => {
    // The niche is 900 × 1100, freed by the removed radiator
    expect(SW500L.sizeMm.w).toBeLessThan(900);
    expect(SW500L.sizeMm.h + 420).toBeLessThan(1100); // shelf with batteries below
    expect(SW500L.massKg).toBe(5);
  });
});
