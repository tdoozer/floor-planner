// Мировая область отрисовки плана: коробка дома плюс запас под размерные линии.
// Вынесено отдельным модулем, чтобы App и компоненты плана не образовали
// циклический импорт.

import { INNER_D, INNER_W, WALL_OUTER } from './data/project.js';

// Место под размерные цепочки. Величина прямо съедает масштаб плана:
// при 1,25 м на поля уходило 28 % ширины полотна. 0,85 хватает на две
// цепочки сверху и подпись, а план стал заметно крупнее.
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
