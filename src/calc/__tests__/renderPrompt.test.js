import { describe, expect, it } from 'vitest';

import {
  MAX_NAMED,
  STYLES,
  VIEWPOINTS,
  buildRenderPrompt,
  renderUrl,
  visibleItems
} from '../renderPrompt.js';
import { makeInitialProject } from '../../data/project.js';

const p = makeInitialProject();

describe('что попадает в кадр', () => {
  it('от двери прихожей видна кухня, но не то, что за спиной', () => {
    const vp = VIEWPOINTS.find((v) => v.id === 'from-hall');
    const seen = visibleItems({ eye: vp.eye, look: vp.look, equipment: p.equipment });
    const ids = seen.map((s) => s.id);
    expect(ids).toContain('eq-hob');
    // диван стоит позади камеры
    expect(ids).not.toContain('eq-sofa');
  });

  it('предметы отсортированы по дальности — ближние первыми', () => {
    const vp = VIEWPOINTS[0];
    const seen = visibleItems({ eye: vp.eye, look: vp.look, equipment: p.equipment });
    seen.slice(1).forEach((s, i) => expect(s.dist).toBeGreaterThanOrEqual(seen[i].dist));
  });

  it('электроточки в кадр не попадают — это значки, а не предметы', () => {
    const vp = VIEWPOINTS[0];
    const seen = visibleItems({ eye: vp.eye, look: vp.look, equipment: p.equipment });
    expect(seen.some((s) => s.id.startsWith('el-'))).toBe(false);
  });

  it('узкий угол обзора отсекает больше, чем широкий', () => {
    const vp = VIEWPOINTS[0];
    const wide = visibleItems({ eye: vp.eye, look: vp.look, equipment: p.equipment, fovDeg: 90 });
    const narrow = visibleItems({ eye: vp.eye, look: vp.look, equipment: p.equipment, fovDeg: 30 });
    expect(narrow.length).toBeLessThan(wide.length);
  });

  it('с дивана видно телевизор — ради этого место и выбиралось', () => {
    const vp = VIEWPOINTS.find((v) => v.id === 'from-sofa');
    const seen = visibleItems({ eye: vp.eye, look: vp.look, equipment: p.equipment });
    expect(seen.map((s) => s.id)).toContain('eq-tv');
  });
});

describe('сборка промпта', () => {
  const r = buildRenderPrompt({ project: p, viewpointId: 'from-dining' });

  it('содержит реальные размеры комнаты, а не общие слова', () => {
    expect(r.text).toContain('5.5 by 5.5 metres');
  });

  it('перечисляет то, что видно, а не весь каталог', () => {
    expect(r.text).toContain('in view:');
    expect(r.text).toContain('gas hob');
  });

  it('повторяющиеся предметы схлопываются в одну фразу', () => {
    // лавок две — «benches» должно встретиться один раз
    const count = r.text.split('wooden benches').length - 1;
    expect(count).toBe(1);
  });

  it('несёт принятые отделочные решения', () => {
    expect(r.text).toContain('concrete kitchen countertop');
    expect(r.text).toContain('porcelain stoneware');
  });

  it('стиль подставляется выбранный', () => {
    const loft = buildRenderPrompt({ project: p, styleId: 'industrial' });
    expect(loft.text).toContain('industrial');
    expect(loft.text).not.toContain('scandinavian');
  });

  it('вечерний режим убирает дневной свет', () => {
    const night = buildRenderPrompt({ project: p, daylight: false });
    expect(night.text).toContain('artificial light only');
    expect(night.text).not.toContain('overcast daylight');
  });

  it('запрещает людей, надписи и водяные знаки', () => {
    expect(r.text).toContain('no people');
    expect(r.text).toContain('no watermark');
  });

  it('неизвестный ракурс не роняет сборку', () => {
    const fallback = buildRenderPrompt({ project: p, viewpointId: 'нет-такого' });
    expect(fallback.viewpoint.id).toBe(VIEWPOINTS[0].id);
    expect(fallback.style.id).toBe(STYLES[0].id);
  });
});

describe('адрес картинки', () => {
  it('идёт через локальный прокси, а не напрямую в интернет', () => {
    const u = renderUrl('a room', { seed: 42 });
    expect(u.startsWith('/prompt/')).toBe(true);
    expect(u).not.toContain('http');
  });

  it('промпт экранируется, seed передаётся', () => {
    const u = renderUrl('a room, wide angle', { seed: 7 });
    expect(u).toContain('seed=7');
    expect(u).not.toContain(' ');
  });
});

describe('промпт на английском и не раздут', () => {
  it('описание ракурса на английском — кириллица в промпт не течёт', () => {
    VIEWPOINTS.forEach((v) => {
      const r = buildRenderPrompt({ project: p, viewpointId: v.id });
      expect(/[А-Яа-яЁё]/.test(r.text)).toBe(false);
    });
  });

  it('перечисление предметов ограничено — иначе выходит список покупок', () => {
    const r = buildRenderPrompt({ project: p, viewpointId: 'from-hall' });
    expect(r.visible.length).toBeGreaterThan(MAX_NAMED);
    expect(r.named.length).toBeLessThanOrEqual(MAX_NAMED);
  });

  it('называются САМЫЕ БЛИЖНИЕ предметы, а не случайные', () => {
    const r = buildRenderPrompt({ project: p, viewpointId: 'from-dining' });
    const seen = r.visible;
    // первым в списке идёт ближайший к точке съёмки
    expect(seen[0].dist).toBeLessThanOrEqual(seen[1].dist);
    expect(r.named.length).toBeGreaterThan(2);
  });
});
