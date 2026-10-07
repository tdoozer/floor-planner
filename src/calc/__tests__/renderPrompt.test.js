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

describe('what falls in the frame', () => {
  it('from the hall door the kitchen is visible, but not what is behind', () => {
    const vp = VIEWPOINTS.find((v) => v.id === 'from-hall');
    const seen = visibleItems({ eye: vp.eye, look: vp.look, equipment: p.equipment });
    const ids = seen.map((s) => s.id);
    expect(ids).toContain('eq-hob');
    // the sofa stands behind the camera
    expect(ids).not.toContain('eq-sofa');
  });

  it('items are sorted by distance — the nearest first', () => {
    const vp = VIEWPOINTS[0];
    const seen = visibleItems({ eye: vp.eye, look: vp.look, equipment: p.equipment });
    seen.slice(1).forEach((s, i) => expect(s.dist).toBeGreaterThanOrEqual(seen[i].dist));
  });

  it('electrical points do not fall in the frame — they are icons, not objects', () => {
    const vp = VIEWPOINTS[0];
    const seen = visibleItems({ eye: vp.eye, look: vp.look, equipment: p.equipment });
    expect(seen.some((s) => s.id.startsWith('el-'))).toBe(false);
  });

  it('a narrow field of view cuts off more than a wide one', () => {
    const vp = VIEWPOINTS[0];
    const wide = visibleItems({ eye: vp.eye, look: vp.look, equipment: p.equipment, fovDeg: 90 });
    const narrow = visibleItems({ eye: vp.eye, look: vp.look, equipment: p.equipment, fovDeg: 30 });
    expect(narrow.length).toBeLessThan(wide.length);
  });

  it('from the sofa the TV is visible — that is why the spot was chosen', () => {
    const vp = VIEWPOINTS.find((v) => v.id === 'from-sofa');
    const seen = visibleItems({ eye: vp.eye, look: vp.look, equipment: p.equipment });
    expect(seen.map((s) => s.id)).toContain('eq-tv');
  });
});

describe('prompt assembly', () => {
  const r = buildRenderPrompt({ project: p, viewpointId: 'from-dining' });

  it('contains the real dimensions of the room, not generic words', () => {
    expect(r.text).toContain('5.5 by 5.5 metres');
  });

  it('lists what is visible, not the whole catalogue', () => {
    expect(r.text).toContain('in view:');
    expect(r.text).toContain('gas hob');
  });

  it('repeated items collapse into one phrase', () => {
    // there are two benches — “benches” must occur once
    const count = r.text.split('wooden benches').length - 1;
    expect(count).toBe(1);
  });

  it('carries the accepted finishing decisions', () => {
    expect(r.text).toContain('concrete kitchen countertop');
    expect(r.text).toContain('porcelain stoneware');
  });

  it('the chosen style is substituted', () => {
    const loft = buildRenderPrompt({ project: p, styleId: 'industrial' });
    expect(loft.text).toContain('industrial');
    expect(loft.text).not.toContain('scandinavian');
  });

  it('evening mode removes daylight', () => {
    const night = buildRenderPrompt({ project: p, daylight: false });
    expect(night.text).toContain('artificial light only');
    expect(night.text).not.toContain('overcast daylight');
  });

  it('forbids people, text and watermarks', () => {
    expect(r.text).toContain('no people');
    expect(r.text).toContain('no watermark');
  });

  it('an unknown viewpoint does not crash the assembly', () => {
    const fallback = buildRenderPrompt({ project: p, viewpointId: 'no-such-viewpoint' });
    expect(fallback.viewpoint.id).toBe(VIEWPOINTS[0].id);
    expect(fallback.style.id).toBe(STYLES[0].id);
  });
});

describe('image address', () => {
  it('goes through the local proxy, not directly to the internet', () => {
    const u = renderUrl('a room', { seed: 42 });
    expect(u.startsWith('/prompt/')).toBe(true);
    expect(u).not.toContain('http');
  });

  it('the prompt is escaped, the seed is passed', () => {
    const u = renderUrl('a room, wide angle', { seed: 7 });
    expect(u).toContain('seed=7');
    expect(u).not.toContain(' ');
  });
});

describe('the prompt is in English and not bloated', () => {
  it('the viewpoint description is in English — no Cyrillic leaks into the prompt', () => {
    VIEWPOINTS.forEach((v) => {
      const r = buildRenderPrompt({ project: p, viewpointId: v.id });
      expect(/[А-Яа-яЁё]/.test(r.text)).toBe(false);
    });
  });

  it('the list of items is limited — otherwise it becomes a shopping list', () => {
    const r = buildRenderPrompt({ project: p, viewpointId: 'from-hall' });
    expect(r.visible.length).toBeGreaterThan(MAX_NAMED);
    expect(r.named.length).toBeLessThanOrEqual(MAX_NAMED);
  });

  it('the NEAREST items are named, not random ones', () => {
    const r = buildRenderPrompt({ project: p, viewpointId: 'from-dining' });
    const seen = r.visible;
    // the nearest to the camera comes first in the list
    expect(seen[0].dist).toBeLessThanOrEqual(seen[1].dist);
    expect(r.named.length).toBeGreaterThan(2);
  });
});
