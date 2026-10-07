import React, { useState } from 'react';
import {
  AlertTriangle,
  Download,
  FileText,
  Info,
  Plus,
  RefreshCw,
  Trash2,
  XCircle
} from 'lucide-react';

import BoilerRoomPanel from './BoilerRoomPanel.jsx';
import EdgeDetail from './EdgeDetail.jsx';
import EstimatePanel from './EstimatePanel.jsx';
import ViewPanel from './ViewPanel.jsx';
import HeatPanel from './HeatPanel.jsx';
import LayerPanel from './LayerPanel.jsx';
import LoopsPanel from './LoopsPanel.jsx';
import { CATEGORY_LABELS, FIXTURES, dims, excludesFloor, getFixture } from '../data/fixtures.js';
import { CLEAR_HEIGHT, INNER_D, INNER_W, LAYOUT_LIMITS, VARIANTS, VARIANT_IDS, buildRooms } from '../data/project.js';
import {
  STAIR_NORMS,
  floorLevels,
  insulationOptions,
  polygonArea,
  screedStackup,
  stairCheck,
  stairHeadroom,
  stairOptions
} from '../calc/geometry.js';

// Строка расчёта: значение, целевой диапазон и отметка соответствия
function CalcRow({ label, value, target, ok }) {
  return (
    <tr className={ok ? '' : 'calc-off'}>
      <td>{label}</td>
      <td className="num">{value}</td>
      <td className="calc-target">
        {ok ? '✓' : '✕'} {target}
      </td>
    </tr>
  );
}

const SEVERITY_ICON = {
  error: <XCircle size={15} />,
  warn: <AlertTriangle size={15} />,
  info: <Info size={15} />
};

function mm(v) {
  return `${Math.round(v)} мм`;
}

export default function Sidebar({
  exportError,
  width,
  project,
  layers,
  warnings,
  selected,
  onUpdateLayer,
  onAddEquipment,
  onDeleteObject,
  onUpdateEquipment,
  onUpdateNode,
  onUpdateStair,
  onUpdateLayout,
  onSwitchVariant,
  onUpdateScreed,
  onUpdateLevels,
  onUpdateClimate,
  onUpdateEnvelope,
  onUpdateSpacing,
  onUpdateKitchenFrame,
  onSelect,
  onFocus,
  onExportPng,
  onExportPdf,
  onReset,
  showConnections,
  setShowConnections,
  showDrainRoutes,
  setShowDrainRoutes
}) {
  const [tab, setTab] = useState('plan');

  const errors = warnings.filter((w) => w.severity === 'error').length;
  const warns = warnings.filter((w) => w.severity === 'warn').length;

  const stack = screedStackup(project.screed);
  const sc = project.stair ? stairCheck(project.stair) : null;
  const opts = project.stair ? stairOptions(project.stair, INNER_D) : null;
  const lv = floorLevels(project.levels, project.screed);
  const rooms = buildRooms(project.layout);
  const floorArea = rooms.reduce((s, r) => s + polygonArea(r.polygon), 0);
  // 75 = существующие 25 + новые 50; 125 = 25 + 100
  const insOptions = insulationOptions(project.screed, project.levels, floorArea, [75, 100, 125, 150]);

  return (
    <aside className="sidebar" style={width ? { width, flexBasis: width } : undefined}>
      <header className="sidebar-head">
        <h1>Первый этаж 5,5 × 5,5</h1>
        <p className="sub">Модернизация · подготовка к заливке стяжки</p>
        <div className="row-btns">
          <button onClick={onExportPng} title="Снимок видимых слоёв">
            <Download size={15} /> PNG
          </button>
          <button onClick={onExportPdf} title="Чертёж видимых слоёв на A4">
            <FileText size={15} /> PDF
          </button>
          <button onClick={onReset} className="danger" title="Вернуть исходную планировку">
            <RefreshCw size={15} />
          </button>
        </div>
        {/* Экспорт падал молча: html2canvas спотыкался о градиент и просто
            ничего не делал. Теперь ошибка видна. */}
        {exportError && <p className="panel-note error-text">{exportError}</p>}
      </header>

      <nav className="tabs">
        <button className={tab === 'plan' ? 'active' : ''} onClick={() => setTab('plan')}>
          План
        </button>
        <button className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}>
          Каталог
        </button>
        <button className={tab === 'heat' ? 'active' : ''} onClick={() => setTab('heat')}>
          Тепло
        </button>
        <button className={tab === 'loops' ? 'active' : ''} onClick={() => setTab('loops')}>
          Петли
        </button>
        <button className={tab === 'boiler' ? 'active' : ''} onClick={() => setTab('boiler')}>
          Котельная
        </button>
        <button className={tab === 'estimate' ? 'active' : ''} onClick={() => setTab('estimate')}>
          Смета
        </button>
        <button className={tab === 'view' ? 'active' : ''} onClick={() => setTab('view')}>
          3D
        </button>
        <button className={tab === 'checks' ? 'active' : ''} onClick={() => setTab('checks')}>
          Проверки
          {errors > 0 && <span className="pill error">{errors}</span>}
          {errors === 0 && warns > 0 && <span className="pill warn">{warns}</span>}
        </button>
      </nav>

      <div className="sidebar-body">
        {tab === 'plan' && (
          <>
            <section className="panel">
              <div className="panel-head"><span>Вариант планировки</span></div>
              <div className="variant-switch">
                {VARIANT_IDS.map((id) => (
                  <button
                    key={id}
                    className={project.layout.variant === id ? 'active' : ''}
                    onClick={() => onSwitchVariant(id)}
                  >
                    {VARIANTS[id].name}
                  </button>
                ))}
              </div>
              <p className="panel-note">{VARIANTS[project.layout.variant]?.description}</p>
            </section>

            <LayerPanel layers={layers} onUpdateLayer={onUpdateLayer} />

            <section className="panel">
              <div className="panel-head"><span>Отображение</span></div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={showConnections}
                  onChange={(e) => setShowConnections(e.target.checked)}
                />
                Точки подключения приборов
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={showDrainRoutes}
                  onChange={(e) => setShowDrainRoutes(e.target.checked)}
                />
                Трассы слива до стояка
              </label>
            </section>

            <section className="panel">
              <div className="panel-head"><span>Площади и разбивка</span></div>
              <table className="mini-table">
                <tbody>
                  {rooms.map((r) => (
                    <tr key={r.id}>
                      <td>{r.name}</td>
                      <td className="num">{polygonArea(r.polygon).toFixed(2)} м²</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>Всего в свету</td>
                    <td className="num">
                      {rooms.reduce((s, r) => s + polygonArea(r.polygon), 0).toFixed(2)} м²
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="field-grid">
                {project.layout.variant === 'bathLeft' ? (
                  <>
                    <label>
                      Санузел, ширина м
                      <input
                        type="number" step="0.05"
                        min={LAYOUT_LIMITS.bathW[0]} max={LAYOUT_LIMITS.bathW[1]}
                        value={project.layout.bathW.toFixed(2)}
                        onChange={(e) => onUpdateLayout({ bathW: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Санузел, глубина м
                      <input
                        type="number" step="0.05"
                        value={(project.layout.bathBottom - project.layout.bathTop).toFixed(2)}
                        onChange={(e) => onUpdateLayout({
                          bathBottom: project.layout.bathTop + Number(e.target.value)
                        })}
                      />
                    </label>
                    <label>
                      Отступ от верхней стены м
                      <input
                        type="number" step="0.05"
                        min={LAYOUT_LIMITS.bathTop[0]} max={LAYOUT_LIMITS.bathTop[1]}
                        value={project.layout.bathTop.toFixed(2)}
                        onChange={(e) => {
                          const d = project.layout.bathBottom - project.layout.bathTop;
                          const t = Number(e.target.value);
                          onUpdateLayout({ bathTop: t, bathBottom: t + d });
                        }}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label>
                      Санузел, ширина м
                      <input
                        type="number" step="0.05"
                        min={INNER_W - LAYOUT_LIMITS.bathX[1]} max={INNER_W - LAYOUT_LIMITS.bathX[0]}
                        value={(INNER_W - project.layout.bathX).toFixed(2)}
                        onChange={(e) => onUpdateLayout({ bathX: INNER_W - Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Санузел, глубина м
                      <input
                        type="number" step="0.05"
                        min={LAYOUT_LIMITS.bathY[0]} max={LAYOUT_LIMITS.bathY[1]}
                        value={project.layout.bathY.toFixed(2)}
                        onChange={(e) => onUpdateLayout({ bathY: Number(e.target.value) })}
                      />
                    </label>
                  </>
                )}
                <label>
                  Прихожая, ширина м
                  <input
                    type="number" step="0.05"
                    min={LAYOUT_LIMITS.hallX[0]} max={LAYOUT_LIMITS.hallX[1]}
                    value={project.layout.hallX.toFixed(2)}
                    onChange={(e) => onUpdateLayout({ hallX: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Прихожая, глубина м
                  <input
                    type="number" step="0.05"
                    min={INNER_D - LAYOUT_LIMITS.hallY[1]} max={INNER_D - LAYOUT_LIMITS.hallY[0]}
                    value={(INNER_D - project.layout.hallY).toFixed(2)}
                    onChange={(e) => onUpdateLayout({ hallY: INNER_D - Number(e.target.value) })}
                  />
                </label>
              </div>
              <p className="panel-note">
                Перегородки гипсокартонные — их можно тянуть прямо на плане за синие
                полосы. Точных размеров пока нет, поэтому все четыре величины
                предположительные.
              </p>
            </section>

            <section className="panel">
              <div className="panel-head"><span>Пирог пола по грунту</span></div>
              <div className="stack-viz">
                {stack.layers.map((l) => (
                  <div
                    key={l.id}
                    className="stack-layer"
                    style={{ height: `${Math.max(6, l.thickness / 3)}px`, background: l.color }}
                    title={`${l.name} — ${l.thickness} мм`}
                  />
                ))}
              </div>
              <table className="mini-table">
                <tbody>
                  {stack.layers.map((l) => (
                    <tr key={l.id}>
                      <td>{l.name}</td>
                      <td className="num">{l.thickness} мм</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>Подъём от основания</td>
                    <td className="num">{mm(stack.total)}</td>
                  </tr>
                </tbody>
              </table>

              <div className="field-grid">
                <label>
                  ЭППС, мм
                  <input
                    type="number" step="10" value={project.screed.insulation}
                    onChange={(e) => onUpdateScreed({ insulation: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Стяжка, мм
                  <input
                    type="number" step="5" value={project.screed.screedTotal}
                    onChange={(e) => onUpdateScreed({ screedTotal: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Щебень, мм
                  <input
                    type="number" step="10" value={project.screed.gravel}
                    onChange={(e) => onUpdateScreed({ gravel: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Покрытие, мм
                  <input
                    type="number" step="1" value={project.screed.finishThickness}
                    onChange={(e) => onUpdateScreed({ finishThickness: Number(e.target.value) })}
                  />
                </label>
              </div>
              <div className="panel-head" style={{ marginTop: 10 }}>
                <span>Выбор толщины ЭППС</span>
              </div>
              <table className="mini-table calc-table">
                <tbody>
                  <tr className="head-row">
                    <td>ЭППС</td>
                    <td className="num">вниз, Вт</td>
                    <td className="calc-target">песка</td>
                  </tr>
                  {insOptions.map((o) => (
                    <tr key={o.insulation} className={o.insulation === project.screed.insulation ? 'calc-current' : ''}>
                      <td>
                        <button className="link-btn" onClick={() => onUpdateScreed({ insulation: o.insulation })}>
                          {o.insulation} мм
                        </button>
                      </td>
                      <td className="num">{o.watts.toFixed(0)}</td>
                      <td className="calc-target">{mm(o.sandNeeded)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="panel-note">
                Поток вниз в поле пола, упрощённо и без периметра — периметр закрывает
                торцевой утеплитель, там перепад вдвое больше. Разница между 75 и 125 мм —
                единицы ватт на весь этаж, зато <b>каждые 50 мм утеплителя — это 50 мм
                песка, который не нужно возить и трамбовать</b>.
              </p>
            </section>

            <section className="panel">
              <div className="panel-head"><span>Засыпка подполья и отметки</span></div>
              <table className="mini-table">
                <tbody>
                  <tr><td>Пирог пола</td><td className="num">{mm(lv.pie)}</td></tr>
                  <tr><td>Уплотнение</td><td className="num">{lv.compactLayers} сл.</td></tr>
                  <tr className={Math.abs(lv.floorDelta) > 5 ? 'calc-off' : ''}>
                    <td>Пол сместится на</td>
                    <td className="num">
                      {lv.floorDelta > 0 ? '+' : ''}{mm(lv.floorDelta)}
                    </td>
                  </tr>
                  <tr><td>Высота помещения</td><td className="num">{mm(lv.clearHeight)}</td></tr>
                  <tr className="total">
                    <td>От пола до пола</td>
                    <td className="num">{mm(lv.floorToFloor)}</td>
                  </tr>
                </tbody>
              </table>

              <div className="field-grid">
                <label>
                  Глубина подполья, мм
                  <input
                    type="number" step="10" value={project.levels.crawlDepth}
                    onChange={(e) => onUpdateLevels({ crawlDepth: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Засыпка песка, мм
                  <input
                    type="number" step="10" value={project.levels.sandFill}
                    onChange={(e) => onUpdateLevels({ sandFill: Number(e.target.value) })}
                  />
                </label>
                <label>
                  ЭППС по торцу, мм
                  <input
                    type="number" step="10" value={project.levels.edgeInsulation}
                    onChange={(e) => onUpdateLevels({ edgeInsulation: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Заглубление торца, мм
                  <input
                    type="number" step="50" value={project.levels.edgeInsulationDepth}
                    onChange={(e) => onUpdateLevels({ edgeInsulationDepth: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Верх торца ниже пола, мм
                  <input
                    type="number" step="5" value={project.levels.edgeTop}
                    onChange={(e) => onUpdateLevels({ edgeTop: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Лента у стяжки, мм
                  <input
                    type="number" step="1" value={project.levels.edgeStrip ?? 0}
                    onChange={(e) => onUpdateLevels({ edgeStrip: Number(e.target.value) })}
                  />
                </label>
              </div>

              <p className="panel-note">
                Профиль ступенчатый: толстая плита идёт только ниже стяжки, где за
                стеной холодный грунт. На высоте самой стяжки разрыв держит лента —
                плита в {project.levels.edgeInsulation} мм отняла бы столько же
                от комнаты с каждой стороны, и такую полку не закрыть плинтусом.
                Керамогранит кладётся на стяжку до самой стены, лента подрезается
                после облицовки.
              </p>

              <EdgeDetail screed={project.screed} levels={project.levels} />
              {!project.levels.edgeInsulation && (
                <button
                  className="link-btn"
                  onClick={() => onUpdateLevels({
                    edgeInsulation: 100, edgeInsulationDepth: 500, edgeTop: 0, edgeStrip: 10
                  })}
                >
                  Заложить торцевой ЭППС 100 мм на 500 вниз
                </button>
              )}
              {Math.abs(lv.floorDelta) > 5 && (
                <button
                  className="link-btn"
                  onClick={() => onUpdateLevels({ sandFill: Math.round(lv.sandForNoChange) })}
                >
                  Подобрать засыпку {mm(lv.sandForNoChange)} — пол останется на месте
                </button>
              )}
              <p className="panel-note">
                Подполье засыпается целиком, сплошная стяжка. Песок уплотняется слоями
                не толще {project.levels.compactLayer} мм с проливкой — просадка рыхлого
                низа рвёт стяжку вместе с трубой ТП. Утепление торца плиты по внутренней
                грани фундамента приклеивается <b>до засыпки</b>: потом туда не добраться.
              </p>
            </section>

            {sc && (
              <section className="panel">
                <div className="panel-head"><span>Лестница вдоль правой стены</span></div>
                <table className="mini-table calc-table">
                  <tbody>
                    <CalcRow
                      label="Угол наклона" value={`${sc.angleDeg.toFixed(1)}°`}
                      target={`≤ ${STAIR_NORMS.maxAngleDeg}°`} ok={sc.angleOk}
                    />
                    <CalcRow
                      label="Высота ступени h" value={mm(sc.risePerStep * 1000)}
                      target={`≤ ${mm(STAIR_NORMS.maxRise * 1000)}`} ok={sc.riseOk}
                    />
                    <CalcRow
                      label="Ширина ступени" value={mm(sc.width * 1000)}
                      target={`≥ ${mm(STAIR_NORMS.minWidth * 1000)}`} ok={sc.widthOk}
                    />
                    <CalcRow
                      label="Ширина проступи s" value={mm(sc.tread * 1000)}
                      target={`≥ ${mm(STAIR_NORMS.minTread * 1000)}`} ok={sc.treadOk}
                    />
                    <CalcRow
                      label="Блонделя 2h + s" value={mm(sc.blondel * 1000)}
                      target={`${mm(STAIR_NORMS.blondel[0] * 1000)}…${mm(STAIR_NORMS.blondel[1] * 1000)}`}
                      ok={sc.blondelOk}
                    />
                    <CalcRow
                      label="Удобства h + s" value={mm(sc.comfort * 1000)}
                      target={`≈ ${mm(STAIR_NORMS.comfort * 1000)}`} ok={sc.comfortOk}
                    />
                    <CalcRow
                      label="Проекция марша" value={`${sc.actualRun.toFixed(2)} м`}
                      target={`нужно ${sc.requiredRun.toFixed(2)}`} ok={sc.fits}
                    />
                    <tr className="total">
                      <td>Сдвиг проёма</td>
                      <td className="num" colSpan={2}>
                        {mm(Math.max(0, project.stair.existingOpeningTopY - project.stair.y) * 1000)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="panel-note">
                  Ориентиры норм — предположения до сверки с актуальным текстом СП.
                  Существующий марш: ширина ступени {mm(project.stair.existingWidth * 1000)},
                  проекция {mm(project.stair.existingRun * 1000)}, проступь{' '}
                  {mm((project.stair.existingRun / (project.stair.risers - 1)) * 1000)}.
                </p>

                <div className="panel-head" style={{ marginTop: 10 }}>
                  <span>Подбор при проекции {opts.maxRun.toFixed(2)} м</span>
                </div>
                <table className="mini-table calc-table">
                  <tbody>
                    {opts.options.filter((o) => o.risers >= 14 && o.risers <= 18).map((o) => (
                      <tr key={o.risers} className={o.allOk ? '' : 'calc-off'}>
                        <td>{o.risers} ступ.</td>
                        <td className="num">
                          {mm(o.risePerStep * 1000)} × {mm(o.tread * 1000)}
                        </td>
                        <td className="calc-target">
                          {o.allOk ? '✓' : `${o.passed}/5`} · {o.angleDeg.toFixed(0)}°
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {opts.best.passed > 0 && opts.best.risers !== project.stair.risers && (
                  <button
                    className="link-btn"
                    onClick={() => onUpdateStair({
                      risers: opts.best.risers,
                      tread: opts.best.tread,
                      length: opts.maxRun,
                      y: project.stair.minLanding
                    })}
                  >
                    Применить {opts.best.risers} подступенков
                  </button>
                )}
                <p className="panel-note">
                  Сейчас марш упирается в перекрытие на отметке{' '}
                  {project.stair.existingOpeningTopY.toFixed(2)} м — красная штриховая линия
                  на плане. Тяните лестницу за верхний край вверх: проступь растёт,
                  а строка «сдвиг проёма» показывает, сколько перекрытия над санузлом
                  придётся разобрать.
                </p>
                <div className="field-grid">
                  <label>
                    Подступенков
                    <input
                      type="number" value={project.stair.risers}
                      onChange={(e) => onUpdateStair({ risers: Math.max(2, Number(e.target.value)) })}
                    />
                  </label>
                  <label>
                    Проступь, м
                    <input
                      type="number" step="0.01" value={project.stair.tread}
                      onChange={(e) => onUpdateStair({ tread: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    Ширина марша, м
                    <input
                      type="number" step="0.05" value={project.stair.width}
                      onChange={(e) => onUpdateStair({ width: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    Длина марша, м
                    <input
                      type="number" step="0.1" value={project.stair.length}
                      onChange={(e) => onUpdateStair({ length: Number(e.target.value) })}
                    />
                  </label>
                </div>
                <p className="panel-note">
                  Оранжевые изолинии на плане — высота прохода под маршем: у нижней
                  ступени низко, ближе к верху почти полная высота.
                </p>
              </section>
            )}
          </>
        )}

        {tab === 'catalog' && (
          <>
            {Object.keys(CATEGORY_LABELS).map((cat) => (
              <section className="panel" key={cat}>
                <div className="panel-head"><span>{CATEGORY_LABELS[cat]}</span></div>
                <div className="catalog-grid">
                  {FIXTURES.filter((f) => f.category === cat).map((f) => (
                    <button key={f.id} className="catalog-item" onClick={() => onAddEquipment(f.id)}>
                      <span className="ci-swatch" style={{ background: f.color }} />
                      <span className="ci-name">{f.name}</span>
                      <span className="ci-dims">
                        {Math.round(f.w * 1000)}×{Math.round(f.d * 1000)}
                      </span>
                      {f.connections.length > 0 && (
                        <span className="ci-conn">
                          {f.connections.map((c) => c.kind).filter((v, i, a) => a.indexOf(v) === i).join(' · ')}
                        </span>
                      )}
                      <Plus size={14} className="ci-plus" />
                    </button>
                  ))}
                </div>
              </section>
            ))}
            <p className="panel-note">
              Каждый прибор приносит собственные точки подключения. Слив автоматически
              трассируется до стояка и проверяется на уклон 2 см/м в пределах пирога пола.
            </p>
          </>
        )}

        {tab === 'heat' && (
          <HeatPanel
            project={project}
            onUpdateClimate={onUpdateClimate}
            onUpdateEnvelope={onUpdateEnvelope}
          />
        )}

        {tab === 'loops' && (
          <LoopsPanel
            project={project}
            onUpdateSpacing={onUpdateSpacing}
            onUpdateEnvelope={onUpdateEnvelope}
            onUpdateKitchenFrame={onUpdateKitchenFrame}
          />
        )}

        {tab === 'boiler' && <BoilerRoomPanel project={project} />}

        {tab === 'estimate' && <EstimatePanel project={project} />}

        {tab === 'view' && <ViewPanel project={project} />}

        {tab === 'checks' && (
          <section className="panel">
            <div className="panel-head">
              <span>Проверки перед заливкой</span>
              <span className="muted">{warnings.length}</span>
            </div>
            {warnings.length === 0 && <p className="panel-note">Конфликтов не найдено.</p>}
            {warnings.map((w) => (
              <div
                key={w.id}
                className={`warn-card ${w.severity}`}
                onClick={() => {
                  if (w.at) onFocus(w.at);
                }}
              >
                <div className="warn-title">
                  {SEVERITY_ICON[w.severity]}
                  <span>{w.title}</span>
                </div>
                <div className="warn-detail">{w.detail}</div>
                {w.fix && <div className="warn-fix">→ {w.fix}</div>}
              </div>
            ))}
          </section>
        )}

        {/* Свойства выбранного объекта — показываем всегда, когда что-то выбрано */}
        {selected && (
          <section className="panel selected-panel">
            <div className="panel-head">
              <span>Выбрано</span>
              {selected.kind === 'equipment' && (
                <button className="icon-btn danger" onClick={() => onDeleteObject(selected.data.id)}>
                  <Trash2 size={15} />
                </button>
              )}
            </div>

            {selected.kind === 'equipment' && (
              <SelectedEquipment
                item={selected.data}
                project={project}
                onUpdate={(u) => onUpdateEquipment(selected.data.id, u)}
              />
            )}

            {selected.kind === 'node' && (
              <SelectedNode node={selected.data} onUpdate={(u) => onUpdateNode(selected.data.id, u)} />
            )}

            {selected.kind === 'stair' && (
              <div className="field-grid">
                <label>
                  X, м
                  <input
                    type="number" step="0.05" value={selected.data.x}
                    onChange={(e) => onUpdateStair({ x: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Y, м
                  <input
                    type="number" step="0.05" value={selected.data.y}
                    onChange={(e) => onUpdateStair({ y: Number(e.target.value) })}
                  />
                </label>
              </div>
            )}
          </section>
        )}
      </div>
    </aside>
  );
}

function SelectedEquipment({ item, project, onUpdate }) {
  const spec = getFixture(item.catalogId);
  if (!spec) return null;
  const size = dims(item);
  const head = project.stair
    ? stairHeadroom(project.stair, item.x + size.w / 2, item.y + size.d / 2, CLEAR_HEIGHT)
    : null;
  const resized = item.w !== undefined || item.d !== undefined;
  const excludes = excludesFloor(item);

  return (
    <>
      <div className="sel-name">{spec.name}</div>
      <div className="sel-dims">
        {Math.round(size.w * 1000)} × {Math.round(size.d * 1000)} × {Math.round(spec.h * 1000)} мм
        {resized && <> · из каталога {Math.round(spec.w * 1000)} × {Math.round(spec.d * 1000)}</>}
      </div>
      <div className="field-grid">
        <label>
          X, м
          <input type="number" step="0.01" value={item.x.toFixed(2)}
            onChange={(e) => onUpdate({ x: Number(e.target.value) })} />
        </label>
        <label>
          Y, м
          <input type="number" step="0.01" value={item.y.toFixed(2)}
            onChange={(e) => onUpdate({ y: Number(e.target.value) })} />
        </label>
        <label>
          Ширина, м
          <input type="number" step="0.01" min="0.15" value={size.w.toFixed(2)}
            onChange={(e) => onUpdate({ w: Number(e.target.value) })} />
        </label>
        <label>
          Глубина, м
          <input type="number" step="0.01" min="0.15" value={size.d.toFixed(2)}
            onChange={(e) => onUpdate({ d: Number(e.target.value) })} />
        </label>
        <label>
          Поворот, °
          <input type="number" step="15" value={item.rotation || 0}
            onChange={(e) => onUpdate({ rotation: Number(e.target.value) })} />
        </label>
      </div>
      {resized && (
        <button className="link-btn" onClick={() => onUpdate({ w: undefined, d: undefined })}>
          Вернуть каталожный габарит
        </button>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={excludes}
          onChange={(e) => onUpdate({ floorExclusion: e.target.checked })}
        />
        Не класть тёплый пол под прибором
      </label>
      <p className="panel-note" style={{ marginTop: 2 }}>
        {excludes
          ? 'Пятно вычитается из поля ТП: площадь уходит, а нагрузка остаётся.'
          : 'Труба идёт под прибором — так и надо для мебели на ножках с зазором от 50 мм.'}
        {spec.exclusionNote && <> {spec.exclusionNote}.</>}
      </p>

      {head !== null && (
        <p className={`headroom ${head < 1.9 ? 'low' : ''}`}>
          Высота под маршем в этой точке: <b>{head.toFixed(2)} м</b>
        </p>
      )}
      {spec.connections.length > 0 && (
        <ul className="conn-list">
          {spec.connections.map((c, i) => (
            <li key={i}>
              {c.kind === 'drain' ? `Слив Ø${c.dia}` : c.kind.toUpperCase()}
              {c.critical && <span className="tag">критично по высоте</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function SelectedNode({ node, onUpdate }) {
  return (
    <>
      <div className="sel-name">{node.name}</div>
      {node.existing && <div className="tag existing">Существующий узел — двигать нельзя</div>}
      {node.confirmed === false && <div className="tag draft">Привязка не подтверждена замером</div>}
      <div className="field-grid">
        <label>
          X, м
          <input type="number" step="0.01" value={node.x.toFixed(2)}
            onChange={(e) => onUpdate({ x: Number(e.target.value) })} />
        </label>
        <label>
          Y, м
          <input type="number" step="0.01" value={node.y.toFixed(2)}
            onChange={(e) => onUpdate({ y: Number(e.target.value) })} />
        </label>
      </div>
      {node.type === 'sewer_riser' && (
        <label className="full-field">
          Отметка лотка стояка, м (ниже чистого пола — отрицательная)
          <input type="number" step="0.01" value={node.invert ?? -0.35}
            onChange={(e) => onUpdate({ invert: Number(e.target.value) })} />
        </label>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={node.confirmed === true}
          onChange={(e) => onUpdate({ confirmed: e.target.checked })}
        />
        Привязка подтверждена замером
      </label>
      {node.note && <p className="panel-note">{node.note}</p>}
    </>
  );
}
