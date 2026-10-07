import { describe, expect, it } from 'vitest';

import {
  buildScene,
  cableElevation,
  equipmentBoxes,
  openingPanels,
  pieSlabs,
  pipeElevation,
  pipeRuns,
  stairSteps,
  wallSolids
} from '../scene3d.js';
import { CLEAR_HEIGHT, INNER_D, INNER_W, makeInitialProject } from '../../data/project.js';
import { heatLoss } from '../heatloss.js';
import { layoutLoops } from '../loops.js';
import { electricalPlan } from '../electrical.js';

function build() {
  const p = makeInitialProject();
  const hl = heatLoss({
    layout: p.layout, openings: p.openings, climate: p.climate,
    envelope: p.envelope, screed: p.screed, clearHeight: CLEAR_HEIGHT
  });
  const loops = layoutLoops({
    layout: p.layout, heatLossByRoom: hl.byRoom,
    manifold: p.nodes.find((n) => n.type === 'manifold'),
    coolant: p.coolant, spacings: p.loopSpacings, equipment: p.equipment,
    exclusionZones: p.floorExclusionZones, mode: p.loopMode,
    kitchenOnFrame: p.kitchenOnFrame
  });
  const electrical = electricalPlan({
    equipment: p.equipment,
    entry: p.nodes.find((n) => n.type === 'electrical_panel')
  });
  return { p, loops, electrical, scene: buildScene({ project: p, loops, electrical }) };
}

describe('отметки в пироге', () => {
  const { p } = build();

  it('труба лежит внутри стяжки, а не под ней', () => {
    const pipe = -pipeElevation(p.screed) * 1000;
    const screedBottom = p.screed.finishThickness + p.screed.screedTotal;
    expect(pipe).toBeLessThan(screedBottom);
    expect(pipe).toBeGreaterThan(p.screed.finishThickness);
  });

  it('кабель НИЖЕ трубы — ради этого он и уходит в утеплитель', () => {
    expect(cableElevation(p.screed)).toBeLessThan(pipeElevation(p.screed));
  });

  it('кабель внутри слоя утеплителя, а не под ним', () => {
    const cable = -cableElevation(p.screed) * 1000;
    const insTop = p.screed.finishThickness + p.screed.screedTotal;
    expect(cable).toBeGreaterThan(insTop);
    expect(cable).toBeLessThan(insTop + p.screed.insulation);
  });

  it('слои пирога идут вниз без разрывов', () => {
    const slabs = pieSlabs(p.screed);
    expect(slabs[0].top).toBeCloseTo(0, 9);
    slabs.slice(1).forEach((s, i) => {
      expect(s.top).toBeCloseTo(slabs[i].bottom, 6);
    });
  });

  it('стяжка полупрозрачная — иначе трубу не увидеть', () => {
    const screed = pieSlabs(p.screed).find((s) => s.id === 'screed');
    expect(screed.opacity).toBeLessThan(0.6);
  });
});

describe('геометрия сцены', () => {
  const { scene, p, loops } = build();

  it('стены строятся все, наружные с несущей толщиной', () => {
    const walls = wallSolids(p.layout);
    expect(walls.length).toBeGreaterThanOrEqual(6);
    const outer = walls.filter((w) => w.kind === 'outer');
    expect(outer).toHaveLength(4);
    outer.forEach((w) => expect(w.thickness).toBeGreaterThan(0.2));
  });

  it('ступеней на одну меньше числа подступенков', () => {
    const steps = stairSteps(p.stair);
    expect(steps).toHaveLength(p.stair.risers - 1);
    // подступенок 200 мм
    expect(steps[0].height).toBeCloseTo(p.stair.totalRise / p.stair.risers, 6);
  });

  it('марш поднимается снизу вверх, не проваливаясь под пол', () => {
    const steps = stairSteps(p.stair);
    expect(steps[0].bottom).toBe(0);
    expect(steps[steps.length - 1].bottom).toBeGreaterThan(2.5);
  });

  it('все петли попали в сцену и лежат на одной отметке', () => {
    const runs = pipeRuns(loops, p.screed).filter((r) => r.kind === 'loop');
    expect(runs).toHaveLength(loops.totalLoops);
    const elevs = new Set(runs.map((r) => r.elev));
    expect(elevs.size).toBe(1);
  });

  it('проёмы садятся на замеренные отметки, а не на выдуманные', () => {
    const panels = openingPanels(p.openings, p.layout);
    const win = panels.find((o) => o.id === 'win-n1');
    const src = p.openings.find((o) => o.id === 'win-n1');
    expect(win.bottom).toBe(src.sill);
    expect(win.height).toBe(src.h);
    const door = panels.find((o) => o.id === 'door-entry');
    expect(door.bottom).toBe(0);
  });

  it('проёмы не выходят за габарит своей стены', () => {
    openingPanels(p.openings, p.layout).forEach((o) => {
      [o.a, o.b].forEach((pt) => {
        expect(pt.x).toBeGreaterThanOrEqual(-0.01);
        expect(pt.x).toBeLessThanOrEqual(INNER_W + 0.01);
        expect(pt.y).toBeGreaterThanOrEqual(-0.01);
        expect(pt.y).toBeLessThanOrEqual(INNER_D + 0.01);
      });
    });
  });

  it('навесные шкафы висят выше столешницы, а не стоят на полу', () => {
    const boxes = equipmentBoxes(p.equipment);
    const wall = boxes.filter((b) => b.id.startsWith('eq-wall'));
    expect(wall.length).toBeGreaterThan(3);
    wall.forEach((b) => expect(b.bottom).toBeGreaterThan(1.0));
  });

  it('электроточки уходят на свой слой, а не в мебель', () => {
    const boxes = equipmentBoxes(p.equipment);
    const sockets = boxes.filter((b) => b.category === 'electrical');
    expect(sockets.length).toBeGreaterThan(20);
    sockets.forEach((b) => expect(b.layer).toBe('electrical'));
  });

  it('сцена собирается целиком и знает свою глубину', () => {
    expect(scene.height).toBe(CLEAR_HEIGHT);
    expect(scene.pieBottom).toBeLessThan(-0.3); // пирог 349 мм
    expect(scene.pipes.length).toBeGreaterThan(loops.totalLoops);
    expect(scene.cables.length).toBeGreaterThan(0);
  });
});
