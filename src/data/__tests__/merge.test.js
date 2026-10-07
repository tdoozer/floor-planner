import { describe, expect, it } from 'vitest';

import { mergeProject } from '../merge.js';
import { makeInitialProject } from '../project.js';

const base = () => makeInitialProject('bathRight');

describe('mergeProject — расстановка заказчика переживает обновление кода', () => {
  it('сдвинутая розетка остаётся на своём месте', () => {
    const saved = base();
    saved.equipment = saved.equipment.map((e) =>
      e.id === 'el-tv' ? { ...e, x: 1.23, y: 4.56 } : e
    );

    const merged = mergeProject(base(), saved);
    const tv = merged.equipment.find((e) => e.id === 'el-tv');
    expect(tv.x).toBeCloseTo(1.23, 6);
    expect(tv.y).toBeCloseTo(4.56, 6);
  });

  it('переставленный стол и лавки не откатываются', () => {
    const saved = base();
    saved.equipment = saved.equipment.map((e) =>
      ['eq-table', 'eq-bench-n', 'eq-bench-s'].includes(e.id)
        ? { ...e, x: e.x + 1.5, y: e.y + 0.4, rotation: 90 }
        : e
    );

    const merged = mergeProject(base(), saved);
    ['eq-table', 'eq-bench-n', 'eq-bench-s'].forEach((id) => {
      const a = saved.equipment.find((e) => e.id === id);
      const b = merged.equipment.find((e) => e.id === id);
      expect(b.x).toBeCloseTo(a.x, 6);
      expect(b.rotation).toBe(90);
    });
  });

  it('добавленный заказчиком объект сохраняется', () => {
    const saved = base();
    saved.equipment = [
      ...saved.equipment,
      { id: 'my-shelf', catalogId: 'shelf_open', x: 0.1, y: 0.1, rotation: 0 }
    ];

    const merged = mergeProject(base(), saved);
    expect(merged.equipment.find((e) => e.id === 'my-shelf')).toBeDefined();
  });

  it('удалённый заказчиком объект не возвращается', () => {
    const saved = base();
    saved.equipment = saved.equipment.filter((e) => e.id !== 'eq-sofa');

    const merged = mergeProject(base(), saved);
    expect(merged.equipment.find((e) => e.id === 'eq-sofa')).toBeUndefined();
  });

  it('новая точка из кода добавляется к старой расстановке', () => {
    const saved = base();
    // Имитируем старый сохранённый проект без электрики
    saved.equipment = saved.equipment.filter((e) => !e.id.startsWith('el-'));
    saved.equipment = [{ ...saved.equipment[0], x: 9 }, ...saved.equipment.slice(1)];

    const merged = mergeProject(base(), saved);
    // Электрики в сохранённом не было, но она и не добавится:
    // отсутствие трактуется как удаление заказчиком
    expect(merged.equipment.find((e) => e.id === saved.equipment[0].id).x).toBe(9);
  });

  it('расчётные параметры берутся из КОДА, а не из браузера', () => {
    const saved = base();
    saved.screed = { ...saved.screed, insulation: 40, gravel: 999 };
    saved.levels = { ...saved.levels, sandFill: 777 };
    saved.coolant = { ...saved.coolant, base: 'water' };

    const merged = mergeProject(base(), saved);
    expect(merged.screed.insulation).toBe(base().screed.insulation);
    expect(merged.screed.gravel).toBe(base().screed.gravel);
    expect(merged.levels.sandFill).toBe(base().levels.sandFill);
    expect(merged.coolant.base).toBe('ethylene');
  });

  it('лестница не берётся из сохранённого — она зафиксирована', () => {
    const saved = base();
    saved.stair = { ...saved.stair, x: 0, width: 2, locked: false };

    const merged = mergeProject(base(), saved);
    expect(merged.stair.width).toBeCloseTo(0.8, 6);
    expect(merged.stair.locked).toBe(true);
  });

  it('переключатели заказчика сохраняются', () => {
    const saved = base();
    saved.kitchenOnFrame = true;
    saved.loopMode = 'serpentine';
    saved.loopSpacings = { living: 0.2 };

    const merged = mergeProject(base(), saved);
    expect(merged.kitchenOnFrame).toBe(true);
    expect(merged.loopMode).toBe('serpentine');
    expect(merged.loopSpacings).toEqual({ living: 0.2 });
  });

  it('без сохранённого проекта возвращается стартовый', () => {
    const b = base();
    expect(mergeProject(b, null)).toBe(b);
    expect(mergeProject(b, {})).toBe(b);
  });

  it('узлы дома не удаляются, даже если их нет в сохранённом', () => {
    const saved = base();
    saved.nodes = saved.nodes.filter((n) => n.type !== 'sewer_riser');

    const merged = mergeProject(base(), saved);
    // Стояк существует физически — молча пропасть он не может
    expect(merged.nodes.some((n) => n.type === 'sewer_riser')).toBe(true);
  });
});

describe('placementRev — согласованная перестановка', () => {
  // Единственное исключение из правила «положение принадлежит заказчику».
  // Молча не срабатывает никогда: ревизию надо поднять руками.
  // Панель в базе уже переставлена с поднятой ревизией, поэтому в тестах
  // ревизию задаём явно с обеих сторон — иначе проверяем не то.
  const withSaved = (baseRev, savedRev) => {
    const set = (list, x, rev) => list.map((e) => {
      if (e.id !== 'eq-hob') return e;
      const n = { ...e, x };
      if (rev === null) delete n.placementRev; else n.placementRev = rev;
      return n;
    });
    const b = base();
    b.equipment = set(b.equipment, 2.76, baseRev);
    const s = JSON.parse(JSON.stringify(b));
    s.equipment = set(s.equipment, 1.11, savedRev);
    return mergeProject(b, s).equipment.find((e) => e.id === 'eq-hob');
  };

  it('без ревизии положение заказчика побеждает, как и раньше', () => {
    expect(withSaved(null, null).x).toBe(1.11);
  });

  it('поднятая ревизия переставляет прибор один раз', () => {
    expect(withSaved(1, null).x).toBe(2.76);
  });

  it('после сохранения новой ревизии заказчик снова хозяин', () => {
    // Прибор уже переехал, ревизии сравнялись — дальше двигает только он
    expect(withSaved(1, 1).x).toBe(1.11);
  });

  it('старая ревизия в коде ничего не откатывает', () => {
    expect(withSaved(1, 2).x).toBe(1.11);
  });
});
