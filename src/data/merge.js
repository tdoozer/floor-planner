// Слияние сохранённого проекта со свежим кодом.
//
// ЗАЧЕМ. Раньше было «всё или ничего»: несовпала ревизия — весь проект
// заменялся стартовым, и вся расстановка заказчика улетала. Каждое
// обновление кода откатывало розетки, светильники и мебель на места
// по умолчанию. Хэш-ревизия это только усугубила: теперь ЛЮБАЯ правка
// в коде сбрасывала расстановку.
//
// ПРАВИЛО РАЗДЕЛЕНИЯ:
//   • ГДЕ СТОИТ — принадлежит заказчику. Координаты, поворот, габарит,
//     флаг обхода тёплым полом. Код это НЕ трогает.
//   • ЧТО ЭТО ТАКОЕ и ЧЕМ СЧИТАЕМ — принадлежит коду. Толщины пирога,
//     отметки, климат, теплофизика, паспорт котла, состав теплоносителя.
//     Это расчётные параметры: я их уточняю, и они должны доезжать.
//
// Новые объекты из кода добавляются, свои объекты заказчика сохраняются,
// удалённые им — остаются удалёнными.

// Что заказчик двигает мышкой и правит в панели объекта
const PLACEMENT_KEYS = ['x', 'y', 'w', 'd', 'rotation', 'floorExclusion', 'mountHeight'];

// ЕДИНСТВЕННОЕ исключение из правила «положение принадлежит заказчику».
//
// Иногда перестановка — это согласованное решение, а не побочный эффект
// правки кода. Тогда у объекта в коде поднимается `placementRev`, и его
// положение один раз перетирает сохранённое. Молча это не срабатывает
// никогда: чтобы объект переехал, ревизию надо поднять руками и осознанно,
// а следующее перетаскивание мышкой снова закрепляется за заказчиком.
function codeWinsPlacement(base, saved) {
  return (base.placementRev ?? 0) > (saved.placementRev ?? 0);
}

function mergeById(baseList = [], savedList = [], { removable = true, knownIds } = {}) {
  if (!Array.isArray(savedList)) return baseList.map((o) => ({ ...o }));

  const savedById = new Map(savedList.map((o) => [o.id, o]));
  const baseIds = new Set(baseList.map((o) => o.id));

  // Объект из кода, которого нет в сохранённом, — это ЛИБО удалённый
  // заказчиком, ЛИБО добавленный мной уже после сохранения. Отличаем по
  // списку id, записанному в момент сохранения: если id там был и пропал —
  // удалили; если его там не было — он новый и должен появиться.
  const wasKnown = (id) => (knownIds ? knownIds.includes(id) : true);

  // Объекты из кода: свойства свежие, положение — сохранённое
  const merged = baseList
    .filter((b) => !removable || savedById.has(b.id) || !wasKnown(b.id))
    .map((b) => {
      const s = savedById.get(b.id);
      if (!s) return { ...b };
      // Согласованная перестановка: код побеждает ровно один раз
      if (codeWinsPlacement(b, s)) return { ...b };

      const placement = {};
      PLACEMENT_KEYS.forEach((k) => {
        if (s[k] !== undefined) placement[k] = s[k];
      });
      return { ...b, ...placement };
    });

  // Объекты, которых в коде нет: либо добавлены заказчиком, либо удалены
  // мной. Оставляем — удалять чужое молча нельзя.
  const extra = savedList.filter((s) => !baseIds.has(s.id)).map((o) => ({ ...o }));

  return [...merged, ...extra];
}

export function mergeProject(base, saved) {
  if (!saved || !saved.layout) return base;

  return {
    ...base,
    // Расчётные параметры — из кода. Их я уточняю по замерам и паспортам,
    // и старые значения из браузера не должны их перетирать.
    layout: { ...base.layout },
    screed: { ...base.screed },
    levels: { ...base.levels },
    ceiling: { ...base.ceiling },
    climate: { ...base.climate },
    envelope: base.envelope,
    boiler: { ...base.boiler },
    coolant: { ...base.coolant },
    stair: { ...base.stair },
    floorExclusionZones: base.floorExclusionZones,
    openings: base.openings,

    // Расстановка — заказчика
    equipment: mergeById(base.equipment, saved.equipment, {
      knownIds: saved.meta?.knownEquipmentIds
    }),
    nodes: mergeById(base.nodes, saved.nodes, { removable: false }),

    // Настройки, которые заказчик меняет переключателями
    loopSpacings: saved.loopSpacings ?? base.loopSpacings,
    loopMode: saved.loopMode ?? base.loopMode,
    kitchenOnFrame: saved.kitchenOnFrame ?? base.kitchenOnFrame,

    meta: { ...base.meta, updatedAt: new Date().toISOString() }
  };
}

// Что записать в проект перед сохранением: список id, известных коду
// на этот момент. Без него нельзя отличить «заказчик удалил» от
// «я добавил после сохранения», и новые объекты никогда бы не появились.
export function stampKnownIds(project, base) {
  return {
    ...project,
    meta: {
      ...project.meta,
      knownEquipmentIds: base.equipment.map((e) => e.id)
    }
  };
}
