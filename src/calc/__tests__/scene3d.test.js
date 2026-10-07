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

describe('levels in the build-up', () => {
  const { p } = build();

  it('the pipe lies inside the screed, not under it', () => {
    const pipe = -pipeElevation(p.screed) * 1000;
    const screedBottom = p.screed.finishThickness + p.screed.screedTotal;
    expect(pipe).toBeLessThan(screedBottom);
    expect(pipe).toBeGreaterThan(p.screed.finishThickness);
  });

  it('the cable is BELOW the pipe — that is why it goes into the insulation', () => {
    expect(cableElevation(p.screed)).toBeLessThan(pipeElevation(p.screed));
  });

  it('the cable is inside the insulation layer, not under it', () => {
    const cable = -cableElevation(p.screed) * 1000;
    const insTop = p.screed.finishThickness + p.screed.screedTotal;
    expect(cable).toBeGreaterThan(insTop);
    expect(cable).toBeLessThan(insTop + p.screed.insulation);
  });

  it('the build-up layers go down without gaps', () => {
    const slabs = pieSlabs(p.screed);
    expect(slabs[0].top).toBeCloseTo(0, 9);
    slabs.slice(1).forEach((s, i) => {
      expect(s.top).toBeCloseTo(slabs[i].bottom, 6);
    });
  });

  it('the screed is translucent — otherwise the pipe cannot be seen', () => {
    const screed = pieSlabs(p.screed).find((s) => s.id === 'screed');
    expect(screed.opacity).toBeLessThan(0.6);
  });
});

describe('scene geometry', () => {
  const { scene, p, loops } = build();

  it('all walls are built, the outer ones with a load-bearing thickness', () => {
    const walls = wallSolids(p.layout);
    expect(walls.length).toBeGreaterThanOrEqual(6);
    const outer = walls.filter((w) => w.kind === 'outer');
    expect(outer).toHaveLength(4);
    outer.forEach((w) => expect(w.thickness).toBeGreaterThan(0.2));
  });

  it('one step fewer than risers', () => {
    const steps = stairSteps(p.stair);
    expect(steps).toHaveLength(p.stair.risers - 1);
    // riser 200 mm
    expect(steps[0].height).toBeCloseTo(p.stair.totalRise / p.stair.risers, 6);
  });

  it('the flight rises from bottom to top, not sinking below the floor', () => {
    const steps = stairSteps(p.stair);
    expect(steps[0].bottom).toBe(0);
    expect(steps[steps.length - 1].bottom).toBeGreaterThan(2.5);
  });

  it('all loops got into the scene and lie at one level', () => {
    const runs = pipeRuns(loops, p.screed).filter((r) => r.kind === 'loop');
    expect(runs).toHaveLength(loops.totalLoops);
    const elevs = new Set(runs.map((r) => r.elev));
    expect(elevs.size).toBe(1);
  });

  it('openings sit at the measured levels, not invented ones', () => {
    const panels = openingPanels(p.openings, p.layout);
    const win = panels.find((o) => o.id === 'win-n1');
    const src = p.openings.find((o) => o.id === 'win-n1');
    expect(win.bottom).toBe(src.sill);
    expect(win.height).toBe(src.h);
    const door = panels.find((o) => o.id === 'door-entry');
    expect(door.bottom).toBe(0);
  });

  it('openings do not go beyond the envelope of their wall', () => {
    openingPanels(p.openings, p.layout).forEach((o) => {
      [o.a, o.b].forEach((pt) => {
        expect(pt.x).toBeGreaterThanOrEqual(-0.01);
        expect(pt.x).toBeLessThanOrEqual(INNER_W + 0.01);
        expect(pt.y).toBeGreaterThanOrEqual(-0.01);
        expect(pt.y).toBeLessThanOrEqual(INNER_D + 0.01);
      });
    });
  });

  it('wall cabinets hang above the worktop, not stand on the floor', () => {
    const boxes = equipmentBoxes(p.equipment);
    const wall = boxes.filter((b) => b.id.startsWith('eq-wall'));
    expect(wall.length).toBeGreaterThan(3);
    wall.forEach((b) => expect(b.bottom).toBeGreaterThan(1.0));
  });

  it('electrical points go to their own layer, not into the furniture', () => {
    const boxes = equipmentBoxes(p.equipment);
    const sockets = boxes.filter((b) => b.category === 'electrical');
    expect(sockets.length).toBeGreaterThan(20);
    sockets.forEach((b) => expect(b.layer).toBe('electrical'));
  });

  it('the scene is assembled in full and knows its depth', () => {
    expect(scene.height).toBe(CLEAR_HEIGHT);
    expect(scene.pieBottom).toBeLessThan(-0.3); // build-up 349 mm
    expect(scene.pipes.length).toBeGreaterThan(loops.totalLoops);
    expect(scene.cables.length).toBeGreaterThan(0);
  });
});
