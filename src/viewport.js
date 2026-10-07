// World area for drawing the plan: the house box plus room for dimension lines.
// Kept in a separate module so that App and the plan components do not form
// a circular import.

import { INNER_D, INNER_W, WALL_OUTER } from './data/project.js';

// Room for the dimension chains. The value directly eats into the plan scale:
// at 1.25 m the margins took 28 % of the canvas width. 0.85 is enough for two
// chains at the top and a label, and the plan became noticeably larger.
export const VIEW_MARGIN = 0.85;

export const WORLD = {
  minX: -WALL_OUTER - VIEW_MARGIN,
  minY: -WALL_OUTER - VIEW_MARGIN,
  w: INNER_W + 2 * WALL_OUTER + 2 * VIEW_MARGIN,
  h: INNER_D + 2 * WALL_OUTER + 2 * VIEW_MARGIN
};

export function worldToPx(x, y, pxPerMeter) {
  return {
    left: (x - WORLD.minX) * pxPerMeter,
    top: (y - WORLD.minY) * pxPerMeter
  };
}

export function pxToWorld(left, top, pxPerMeter) {
  return {
    x: left / pxPerMeter + WORLD.minX,
    y: top / pxPerMeter + WORLD.minY
  };
}
