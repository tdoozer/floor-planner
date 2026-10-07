import { describe, expect, it } from 'vitest';
import {
  DESIGN_OUTDOOR_C, EXISTING, GROUP_LOADS, INDOOR, OUTDOOR, OUTDOOR_MIN_C,
  TRIP, inputCheck, panelFill, panelPlan, rcdChain, scenarioLoad, tripBand
} from '../panel.js';
import { CIRCUITS } from '../electrical.js';
import { SW500L } from '../ups.js';

describe('what is in the outdoor box now', () => {
  it('read from the photo and recorded', () => {
    expect(EXISTING.meter.model).toBe('Mercury 203.1');
    expect(EXISTING.input.rating).toBe(32);
    expect(EXISTING.groups).toHaveLength(2);
  });

  it('a voltage relay without auto-reset is the problem', () => {
    // The RMM47 trips the breaker and leaves it off until it is re-armed by hand.
    // In an empty house one mains dip in January = a frozen house.
    expect(EXISTING.voltageRelay.autoReset).toBe(false);
    const kv = OUTDOOR.devices.find((d) => d.id === 'KV1');
    expect(kv.replace).toBe('RMM47');
    expect(kv.why).toMatch(/AUTO-RESET/);
  });

  it('the meter is legitimate until 2028 and replacing it is not your job', () => {
    expect(EXISTING.meter.year + EXISTING.meter.calibrationYears).toBe(2028);
  });
});

describe('why the grouping moves into the house', () => {
  const p = panelPlan();

  it('it is colder outside than electronic RCBOs allow', () => {
    expect(DESIGN_OUTDOOR_C).toBeLessThan(OUTDOOR_MIN_C);
    expect(p.coldOutside).toBe(true);
    expect(p.coldMarginK).toBe(2);
  });

  it('the UPS cannot go outside at all — the data sheet allows only from +5', () => {
    expect(SW500L.tempC[0]).toBeGreaterThan(0);
  });

  it('the group devices removed from outside free up room for a 300 mA RCD', () => {
    // C25 is 1 module, AVDT32 is 2. Exactly that is needed by the new RCD, plus a spare.
    expect(p.freedModules).toBe(3);
    expect(p.outdoor.fits).toBe(true);
  });
});

describe('composition of the boards', () => {
  const p = panelPlan();

  it('the outdoor board fits in 12 modules', () => {
    expect(p.outdoor.used).toBeLessThanOrEqual(p.outdoor.modules);
  });

  it('the internal board is not packed tight', () => {
    expect(p.indoor.fits).toBe(true);
    expect(p.indoor.roomy).toBe(true);
    expect(p.indoor.free).toBeGreaterThanOrEqual(6);
  });

  it('every calculated group got its own device', () => {
    const inPanel = INDOOR.devices.filter((d) => d.circuit).map((d) => d.circuit).sort();
    const expected = Object.keys(CIRCUITS).filter((c) => !CIRCUITS[c].lowVoltage).sort();
    expect(inPanel).toEqual(expected);
  });

  it('an RCBO for every socket group, not one common RCD', () => {
    // The house stands empty for long periods: “one tripped — everything went dark” costs more than the price difference
    const rcbo = INDOOR.devices.filter((d) => d.width === 2 && d.circuit);
    expect(rcbo.length).toBeGreaterThanOrEqual(6);
  });

  it('lighting stays without an RCD on purpose', () => {
    const light = INDOOR.devices.find((d) => d.circuit === 'light');
    expect(light.width).toBe(1); // an ordinary breaker, not an RCBO
    expect(CIRCUITS.light.rcd).toBe(false);
  });

  it('a board overflow is caught, not passed silently', () => {
    const tiny = panelFill({ modules: 4, devices: INDOOR.devices });
    expect(tiny.fits).toBe(false);
    expect(tiny.free).toBeLessThan(0);
  });
});

describe('C32 feed check', () => {
  const chk = inputCheck({ rating: 32 });

  it('the sustained current holds in all scenarios', () => {
    expect(chk.sufficient).toBe(true);
  });

  it('but the feed no longer holds the party peak', () => {
    expect(chk.worst.peak.band).not.toBe('hold');
    expect(chk.worst.peakA).toBeGreaterThan(50);
  });

  it('a short peak and a sustained current are different verdicts', () => {
    // This is exactly why a “sum of powers” without a duration means nothing
    const cook = chk.rows.find((r) => r.id === 'cooking');
    expect(cook.sustained.band).toBe('hold');
    expect(cook.peak.band).not.toBe('hold');
  });

  it('up to 1.13 of the rating the breaker does not trip at all', () => {
    expect(tripBand(1.0).band).toBe('hold');
    expect(tripBand(TRIP.hold).band).toBe('hold');
    expect(tripBand(1.2).band).toBe('slow');
    expect(tripBand(6).band).toBe('instant');
  });

  it('installed power twice the feed — and that is fine', () => {
    expect(chk.installedW).toBeGreaterThan(chk.limitW * 1.8);
    expect(chk.sufficient).toBe(true);
  });

  it('the C32 has no headroom for the future', () => {
    // A heater, a sauna or car charging will no longer fit here
    expect(chk.headroomW).toBeLessThan(3500);
  });

  it('loads are given by two numbers, not one', () => {
    Object.values(GROUP_LOADS).forEach((g) => {
      expect(g.peak).toBeGreaterThanOrEqual(g.sustained);
    });
    expect(scenarioLoad(['kitchen'], 'peak')).toBeGreaterThan(scenarioLoad(['kitchen'], 'sustained'));
  });
});

describe('leakage selectivity', () => {
  const chain = rcdChain();

  it('three steps from top to bottom, each more sensitive', () => {
    for (let i = 1; i < chain.length - 1; i++) {
      expect(chain[i].ma).toBeLessThanOrEqual(chain[i - 1].ma);
    }
  });

  it('the feed one is type S, otherwise there are no steps', () => {
    // Without a time delay the fire-protection one will trip
    // together with the group one, and the point of the cascade is lost
    expect(chain[0].ma).toBe(300);
    expect(chain[0].type).toBe('S');
  });

  it('the bathroom is more sensitive than the common groups', () => {
    expect(CIRCUITS.bath.rcdMa).toBe(10);
    expect(chain.find((c) => c.at.includes('bathroom')).ma).toBe(10);
  });
});
