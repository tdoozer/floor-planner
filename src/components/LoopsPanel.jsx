import React from 'react';

import { CLEAR_HEIGHT } from '../data/project.js';
import { heatLoss } from '../calc/heatloss.js';
import { layoutLoops } from '../calc/loops.js';
import { systemHydraulics } from '../calc/hydraulics.js';

const mm = (m) => `${Math.round(m * 1000)}`;

export default function LoopsPanel({
  project,
  onUpdateSpacing,
  onUpdateEnvelope,
  onUpdateKitchenFrame
}) {
  const {
    climate, envelope, screed, layout, openings, coolant, nodes, equipment,
    loopSpacings = {}
  } = project;

  const hl = heatLoss({ layout, openings, climate, envelope, screed, clearHeight: CLEAR_HEIGHT });
  const manifold = nodes.find((n) => n.type === 'manifold');
  const L = layoutLoops({
    layout,
    heatLossByRoom: hl.byRoom,
    manifold,
    coolant,
    spacings: loopSpacings,
    equipment,
    exclusionZones: project.floorExclusionZones,
    mode: project.loopMode,
    kitchenOnFrame: project.kitchenOnFrame
  });

  const H = systemHydraulics({
    loops: L.byRoom.flatMap((r) =>
      Array.from({ length: r.loops }, () => ({ powerW: r.roomLoadW / r.loops, lengthM: r.perLoop }))
    ),
    coolant
  });

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <span>Контуры тёплого пола</span>
          <span className="muted">{L.totalLoops} шт · {L.totalPipe.toFixed(0)} м</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr className="head-row">
              <td>Помещение</td>
              <td className="num">шаг · трубы</td>
              <td className="calc-target">контуров</td>
            </tr>
            {L.byRoom.map((r) => (
              <tr key={r.id} className={r.loops > 1 ? 'calc-off' : ''}>
                <td>{r.name}</td>
                <td className="num">{mm(r.spacing)} · {r.totalPipe.toFixed(0)} м</td>
                <td className="calc-target">
                  {r.loops} × {r.perLoop.toFixed(0)} м
                </td>
              </tr>
            ))}
            <tr className="total">
              <td>Предел петли</td>
              <td className="num">{L.limit.toFixed(0)} м</td>
              <td className="calc-target">антифриз</td>
            </tr>
          </tbody>
        </table>
        <p className="panel-note">
          Санузел и прихожая — отдельными контурами, как и просили. Зал в один
          контур не укладывается: даже широким шагом трубы выходит больше,
          чем допускает предел {L.limit.toFixed(0)} м.
          Разбаланс длин {(L.imbalance * 100).toFixed(0)} % — балансировочные клапаны
          на коллекторе обязательны.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Полезная площадь пола</span>
          <span className="muted">мебель вычтена</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr className="head-row">
              <td>Помещение</td>
              <td className="num">занято</td>
              <td className="calc-target">Вт/м² стало</td>
            </tr>
            {L.byRoom.map((r) => (
              <tr key={r.id} className={r.deficit ? 'calc-off' : ''}>
                <td>{r.name}</td>
                <td className="num">{r.excludedArea.toFixed(2)} м²</td>
                <td className="calc-target">
                  {r.requiredBare.toFixed(0)} → {r.requiredWm2.toFixed(0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <label className="check">
          <input
            type="checkbox"
            checked={!!project.kitchenOnFrame}
            onChange={(e) => onUpdateKitchenFrame(e.target.checked)}
          />
          Кухня на открытом каркасе
        </label>
        <label className="full-field">
          Кратность воздухообмена, 1/ч
          <input
            type="number" step="0.1" value={envelope.ventilationAch}
            onChange={(e) => onUpdateEnvelope({ ventilationAch: Number(e.target.value) })}
          />
        </label>
        <p className="panel-note">
          Под кухонными шкафами, холодильником, душевым поддоном и стиральной
          машиной трубу не кладут: тепло там запирается, в комнату не выходит.
          Площадь уходит, а нагрузка остаётся — поэтому требование на оставшиеся
          квадраты растёт. Мебель на ножках с зазором от 50 мм не исключается:
          снимите галочку у дивана или лавок, и площадь вернётся.
          Кратность воздухообмена — самый чувствительный параметр всего расчёта.
        </p>
        <p className="panel-note">
          <b>Кухня на каркасе</b> — бетонная столешница на стойках с продуваемым
          зазором под фронтом. Тогда сплошные зоны исчезают, а исключаются только
          приборы, стоящие на полу: холодильник, посудомойка, духовой шкаф,
          стиралка, плюс мойка (сифон и фильтр) и варочная панель (газ и доступ
          к нему). Столешницы и глухие шкафы уходят на каркас — под ними труба.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Гидравлика и насос</span>
          <span className="muted">{H.totalFlowLh.toFixed(0)} л/ч</span>
        </div>
        <table className="mini-table calc-table">
          <tbody>
            <tr>
              <td>Худший контур</td>
              <td className="num">{H.worst.dropM.toFixed(2)} м</td>
              <td className="calc-target">{H.worst.velocity.toFixed(2)} м/с</td>
            </tr>
            <tr>
              <td>С местными сопр.</td>
              <td className="num">{H.requiredHeadM.toFixed(2)} м</td>
              <td className="calc-target">требуется</td>
            </tr>
            <tr className={H.boilerPumpEnough ? '' : 'calc-off'}>
              <td>Насос котла</td>
              <td className="num">≈ {H.boilerHeadM} м</td>
              <td className="calc-target">
                {H.boilerPumpEnough ? '✓' : '✕'} запас {H.margin.toFixed(2)} м
              </td>
            </tr>
            <tr className="calc-off">
              <td>Режим течения</td>
              <td className="num">Re {H.worst.reynolds.toFixed(0)}</td>
              <td className="calc-target">{H.anyLaminar ? 'ламинарный' : 'турбулентный'}</td>
            </tr>
          </tbody>
        </table>
        <p className="panel-note">
          По напору насоса котла хватает с запасом. Но {H.boilerHeadM} м — это
          <b> предположение</b>, сверьте с графиком насоса в паспорте.
          Течение <b>ламинарное</b> из-за вязкости антифриза: теплоотдача от трубы
          к бетону хуже, чем в турбулентном режиме, и это уже учтено запасом
          по шагу. Отдельный насос на коллекторе всё равно оправдан —
          он даёт непрерывную циркуляцию независимо от логики котла.
        </p>
      </section>

      {L.byRoom.map((r) => (
        <section className="panel" key={r.id}>
          <div className="panel-head">
            <span>{r.name}</span>
            <span className="muted">нужно {r.requiredWm2.toFixed(0)} Вт/м²</span>
          </div>
          <table className="mini-table calc-table">
            <tbody>
              <tr className="head-row">
                <td>Шаг</td>
                <td className="num">съём</td>
                <td className="calc-target">трубы · контуров</td>
              </tr>
              {r.candidates.map((c) => {
                const margin = c.capacity / r.requiredWm2 - 1;
                const chosen = c.spacing === r.spacing;
                return (
                  <tr
                    key={c.spacing}
                    className={`${chosen ? 'calc-current' : ''} ${c.enough ? '' : 'calc-off'}`}
                  >
                    <td>
                      <button className="link-btn" onClick={() => onUpdateSpacing(r.id, c.spacing)}>
                        {mm(c.spacing)} мм
                      </button>
                    </td>
                    <td className="num">
                      {c.capacity.toFixed(0)}
                      {c.enough && <span className="muted"> +{(margin * 100).toFixed(0)}%</span>}
                    </td>
                    <td className="calc-target">
                      {c.enough ? '✓' : '✕'} {c.totalPipe.toFixed(0)} м · {c.loops}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="panel-note">
            Температура поверхности ограничена {r.maxFloorTemp} °C при воздухе{' '}
            {r.airTemp} °C. Подводка от коллектора {r.supplyRunM.toFixed(1)} м
            в одну сторону, в длину петли входит дважды.
            {r.candidates.find((c) => c.spacing === r.spacing)?.capacity / r.requiredWm2 < 1.1 && (
              <> <b>Запас меньше 10 % — стоит взять шаг мельче.</b></>
            )}
          </p>
        </section>
      ))}
    </>
  );
}
