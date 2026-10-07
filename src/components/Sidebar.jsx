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

// Calculation row: value, target range and a compliance mark
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
  return `${Math.round(v)} mm`;
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
  // 75 = existing 25 + new 50; 125 = 25 + 100
  const insOptions = insulationOptions(project.screed, project.levels, floorArea, [75, 100, 125, 150]);

  return (
    <aside className="sidebar" style={width ? { width, flexBasis: width } : undefined}>
      <header className="sidebar-head">
        <h1>Ground floor 5.5 × 5.5</h1>
        <p className="sub">Renovation · preparing for the screed pour</p>
        <div className="row-btns">
          <button onClick={onExportPng} title="Snapshot of the visible layers">
            <Download size={15} /> PNG
          </button>
          <button onClick={onExportPdf} title="Drawing of the visible layers on A4">
            <FileText size={15} /> PDF
          </button>
          <button onClick={onReset} className="danger" title="Restore the original layout">
            <RefreshCw size={15} />
          </button>
        </div>
        {/* Export used to fail silently: html2canvas tripped on a gradient and just
                did nothing. Now the error is visible. */}
        {exportError && <p className="panel-note error-text">{exportError}</p>}
      </header>

      <nav className="tabs">
        <button className={tab === 'plan' ? 'active' : ''} onClick={() => setTab('plan')}>
          Plan
        </button>
        <button className={tab === 'catalog' ? 'active' : ''} onClick={() => setTab('catalog')}>
          Catalogue
        </button>
        <button className={tab === 'heat' ? 'active' : ''} onClick={() => setTab('heat')}>
          Heat
        </button>
        <button className={tab === 'loops' ? 'active' : ''} onClick={() => setTab('loops')}>
          Loops
        </button>
        <button className={tab === 'boiler' ? 'active' : ''} onClick={() => setTab('boiler')}>
          Boiler room
        </button>
        <button className={tab === 'estimate' ? 'active' : ''} onClick={() => setTab('estimate')}>
          Estimate
        </button>
        <button className={tab === 'view' ? 'active' : ''} onClick={() => setTab('view')}>
          3D
        </button>
        <button className={tab === 'checks' ? 'active' : ''} onClick={() => setTab('checks')}>
          Checks
          {errors > 0 && <span className="pill error">{errors}</span>}
          {errors === 0 && warns > 0 && <span className="pill warn">{warns}</span>}
        </button>
      </nav>

      <div className="sidebar-body">
        {tab === 'plan' && (
          <>
            <section className="panel">
              <div className="panel-head"><span>Layout variant</span></div>
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
              <div className="panel-head"><span>Display</span></div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={showConnections}
                  onChange={(e) => setShowConnections(e.target.checked)}
                />
                Fixture connection points
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={showDrainRoutes}
                  onChange={(e) => setShowDrainRoutes(e.target.checked)}
                />
                Drain routes to the stack
              </label>
            </section>

            <section className="panel">
              <div className="panel-head"><span>Areas and breakdown</span></div>
              <table className="mini-table">
                <tbody>
                  {rooms.map((r) => (
                    <tr key={r.id}>
                      <td>{r.name}</td>
                      <td className="num">{polygonArea(r.polygon).toFixed(2)} m²</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>Total clear area</td>
                    <td className="num">
                      {rooms.reduce((s, r) => s + polygonArea(r.polygon), 0).toFixed(2)} m²
                    </td>
                  </tr>
                </tbody>
              </table>

              <div className="field-grid">
                {project.layout.variant === 'bathLeft' ? (
                  <>
                    <label>
                      Bathroom, width m
                      <input
                        type="number" step="0.05"
                        min={LAYOUT_LIMITS.bathW[0]} max={LAYOUT_LIMITS.bathW[1]}
                        value={project.layout.bathW.toFixed(2)}
                        onChange={(e) => onUpdateLayout({ bathW: Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Bathroom, depth m
                      <input
                        type="number" step="0.05"
                        value={(project.layout.bathBottom - project.layout.bathTop).toFixed(2)}
                        onChange={(e) => onUpdateLayout({
                          bathBottom: project.layout.bathTop + Number(e.target.value)
                        })}
                      />
                    </label>
                    <label>
                      Offset from top wall m
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
                      Bathroom, width m
                      <input
                        type="number" step="0.05"
                        min={INNER_W - LAYOUT_LIMITS.bathX[1]} max={INNER_W - LAYOUT_LIMITS.bathX[0]}
                        value={(INNER_W - project.layout.bathX).toFixed(2)}
                        onChange={(e) => onUpdateLayout({ bathX: INNER_W - Number(e.target.value) })}
                      />
                    </label>
                    <label>
                      Bathroom, depth m
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
                  Hall, width m
                  <input
                    type="number" step="0.05"
                    min={LAYOUT_LIMITS.hallX[0]} max={LAYOUT_LIMITS.hallX[1]}
                    value={project.layout.hallX.toFixed(2)}
                    onChange={(e) => onUpdateLayout({ hallX: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Hall, depth m
                  <input
                    type="number" step="0.05"
                    min={INNER_D - LAYOUT_LIMITS.hallY[1]} max={INNER_D - LAYOUT_LIMITS.hallY[0]}
                    value={(INNER_D - project.layout.hallY).toFixed(2)}
                    onChange={(e) => onUpdateLayout({ hallY: INNER_D - Number(e.target.value) })}
                  />
                </label>
              </div>
              <p className="panel-note">
                Plasterboard partitions — drag them straight on the plan by the blue
                strips. There are no exact dimensions yet, so all four values
                are assumptions.
              </p>
            </section>

            <section className="panel">
              <div className="panel-head"><span>Floor build-up on the ground</span></div>
              <div className="stack-viz">
                {stack.layers.map((l) => (
                  <div
                    key={l.id}
                    className="stack-layer"
                    style={{ height: `${Math.max(6, l.thickness / 3)}px`, background: l.color }}
                    title={`${l.name} — ${l.thickness} mm`}
                  />
                ))}
              </div>
              <table className="mini-table">
                <tbody>
                  {stack.layers.map((l) => (
                    <tr key={l.id}>
                      <td>{l.name}</td>
                      <td className="num">{l.thickness} mm</td>
                    </tr>
                  ))}
                  <tr className="total">
                    <td>Rise from the base</td>
                    <td className="num">{mm(stack.total)}</td>
                  </tr>
                </tbody>
              </table>

              <div className="field-grid">
                <label>
                  XPS, mm
                  <input
                    type="number" step="10" value={project.screed.insulation}
                    onChange={(e) => onUpdateScreed({ insulation: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Screed, mm
                  <input
                    type="number" step="5" value={project.screed.screedTotal}
                    onChange={(e) => onUpdateScreed({ screedTotal: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Crushed stone, mm
                  <input
                    type="number" step="10" value={project.screed.gravel}
                    onChange={(e) => onUpdateScreed({ gravel: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Finish, mm
                  <input
                    type="number" step="1" value={project.screed.finishThickness}
                    onChange={(e) => onUpdateScreed({ finishThickness: Number(e.target.value) })}
                  />
                </label>
              </div>
              <div className="panel-head" style={{ marginTop: 10 }}>
                <span>Choosing the XPS thickness</span>
              </div>
              <table className="mini-table calc-table">
                <tbody>
                  <tr className="head-row">
                    <td>XPS</td>
                    <td className="num">down, W</td>
                    <td className="calc-target">of sand</td>
                  </tr>
                  {insOptions.map((o) => (
                    <tr key={o.insulation} className={o.insulation === project.screed.insulation ? 'calc-current' : ''}>
                      <td>
                        <button className="link-btn" onClick={() => onUpdateScreed({ insulation: o.insulation })}>
                          {o.insulation} mm
                        </button>
                      </td>
                      <td className="num">{o.watts.toFixed(0)}</td>
                      <td className="calc-target">{mm(o.sandNeeded)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="panel-note">
                Downward flux through the floor field, simplified and without the perimeter — the perimeter is covered
                by the edge insulation, where the temperature drop is twice as large. The difference between 75 and 125 mm is
                a few watts for the whole floor, but <b>every 50 mm of insulation is 50 mm of
                sand that does not have to be hauled and compacted</b>.
              </p>
            </section>

            <section className="panel">
              <div className="panel-head"><span>Sub-floor fill and levels</span></div>
              <table className="mini-table">
                <tbody>
                  <tr><td>Floor build-up</td><td className="num">{mm(lv.pie)}</td></tr>
                  <tr><td>Compaction</td><td className="num">{lv.compactLayers} lay.</td></tr>
                  <tr className={Math.abs(lv.floorDelta) > 5 ? 'calc-off' : ''}>
                    <td>Floor will shift by</td>
                    <td className="num">
                      {lv.floorDelta > 0 ? '+' : ''}{mm(lv.floorDelta)}
                    </td>
                  </tr>
                  <tr><td>Room height</td><td className="num">{mm(lv.clearHeight)}</td></tr>
                  <tr className="total">
                    <td>Floor to floor</td>
                    <td className="num">{mm(lv.floorToFloor)}</td>
                  </tr>
                </tbody>
              </table>

              <div className="field-grid">
                <label>
                  Sub-floor depth, mm
                  <input
                    type="number" step="10" value={project.levels.crawlDepth}
                    onChange={(e) => onUpdateLevels({ crawlDepth: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Sand fill, mm
                  <input
                    type="number" step="10" value={project.levels.sandFill}
                    onChange={(e) => onUpdateLevels({ sandFill: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Edge XPS, mm
                  <input
                    type="number" step="10" value={project.levels.edgeInsulation}
                    onChange={(e) => onUpdateLevels({ edgeInsulation: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Edge depth below, mm
                  <input
                    type="number" step="50" value={project.levels.edgeInsulationDepth}
                    onChange={(e) => onUpdateLevels({ edgeInsulationDepth: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Edge top below floor, mm
                  <input
                    type="number" step="5" value={project.levels.edgeTop}
                    onChange={(e) => onUpdateLevels({ edgeTop: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Strip at the screed, mm
                  <input
                    type="number" step="1" value={project.levels.edgeStrip ?? 0}
                    onChange={(e) => onUpdateLevels({ edgeStrip: Number(e.target.value) })}
                  />
                </label>
              </div>

              <p className="panel-note">
                The profile is stepped: the thick board runs only below the screed, where there is
                cold ground behind the wall. At screed height the gap is held by a strip —
                a {project.levels.edgeInsulation} mm board would take the same amount
                off the room on each side, and such a ledge cannot be hidden by a skirting board.
                Porcelain tile is laid on the screed right up to the wall, and the strip is trimmed
                after the tiling.
              </p>

              <EdgeDetail screed={project.screed} levels={project.levels} />
              {!project.levels.edgeInsulation && (
                <button
                  className="link-btn"
                  onClick={() => onUpdateLevels({
                    edgeInsulation: 100, edgeInsulationDepth: 500, edgeTop: 0, edgeStrip: 10
                  })}
                >
                  Fit edge XPS 100 mm, 500 down
                </button>
              )}
              {Math.abs(lv.floorDelta) > 5 && (
                <button
                  className="link-btn"
                  onClick={() => onUpdateLevels({ sandFill: Math.round(lv.sandForNoChange) })}
                >
                  Pick a fill of {mm(lv.sandForNoChange)} — the floor will stay in place
                </button>
              )}
              <p className="panel-note">
                The sub-floor is filled completely, then a continuous screed is poured. The sand is compacted in layers
                no thicker than {project.levels.compactLayer} mm and watered — settlement of the loose
                bottom tears the screed together with the heating pipe. The slab-edge insulation on the inner
                face of the foundation is glued <b>before the fill</b>: you cannot get there afterwards.
              </p>
            </section>

            {sc && (
              <section className="panel">
                <div className="panel-head"><span>Stair along the right wall</span></div>
                <table className="mini-table calc-table">
                  <tbody>
                    <CalcRow
                      label="Slope angle" value={`${sc.angleDeg.toFixed(1)}°`}
                      target={`≤ ${STAIR_NORMS.maxAngleDeg}°`} ok={sc.angleOk}
                    />
                    <CalcRow
                      label="Riser height h" value={mm(sc.risePerStep * 1000)}
                      target={`≤ ${mm(STAIR_NORMS.maxRise * 1000)}`} ok={sc.riseOk}
                    />
                    <CalcRow
                      label="Step width" value={mm(sc.width * 1000)}
                      target={`≥ ${mm(STAIR_NORMS.minWidth * 1000)}`} ok={sc.widthOk}
                    />
                    <CalcRow
                      label="Tread depth s" value={mm(sc.tread * 1000)}
                      target={`≥ ${mm(STAIR_NORMS.minTread * 1000)}`} ok={sc.treadOk}
                    />
                    <CalcRow
                      label="Blondel 2h + s" value={mm(sc.blondel * 1000)}
                      target={`${mm(STAIR_NORMS.blondel[0] * 1000)}…${mm(STAIR_NORMS.blondel[1] * 1000)}`}
                      ok={sc.blondelOk}
                    />
                    <CalcRow
                      label="Comfort h + s" value={mm(sc.comfort * 1000)}
                      target={`≈ ${mm(STAIR_NORMS.comfort * 1000)}`} ok={sc.comfortOk}
                    />
                    <CalcRow
                      label="Flight projection" value={`${sc.actualRun.toFixed(2)} m`}
                      target={`need ${sc.requiredRun.toFixed(2)}`} ok={sc.fits}
                    />
                    <tr className="total">
                      <td>Opening shift</td>
                      <td className="num" colSpan={2}>
                        {mm(Math.max(0, project.stair.existingOpeningTopY - project.stair.y) * 1000)}
                      </td>
                    </tr>
                  </tbody>
                </table>
                <p className="panel-note">
                  The reference norms are assumptions until checked against the current text of the building code.
                  Existing flight: step width {mm(project.stair.existingWidth * 1000)},
                  projection {mm(project.stair.existingRun * 1000)}, tread{' '}
                  {mm((project.stair.existingRun / (project.stair.risers - 1)) * 1000)}.
                </p>

                <div className="panel-head" style={{ marginTop: 10 }}>
                  <span>Options at a projection of {opts.maxRun.toFixed(2)} m</span>
                </div>
                <table className="mini-table calc-table">
                  <tbody>
                    {opts.options.filter((o) => o.risers >= 14 && o.risers <= 18).map((o) => (
                      <tr key={o.risers} className={o.allOk ? '' : 'calc-off'}>
                        <td>{o.risers} steps</td>
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
                    Apply {opts.best.risers} risers
                  </button>
                )}
                <p className="panel-note">
                  Right now the flight meets the floor slab at level{' '}
                  {project.stair.existingOpeningTopY.toFixed(2)} m — the red dashed line
                  on the plan. Drag the stair by its top edge upwards: the tread grows,
                  and the “opening shift” row shows how much of the slab above the bathroom
                  has to be removed.
                </p>
                <div className="field-grid">
                  <label>
                    Risers
                    <input
                      type="number" value={project.stair.risers}
                      onChange={(e) => onUpdateStair({ risers: Math.max(2, Number(e.target.value)) })}
                    />
                  </label>
                  <label>
                    Tread, m
                    <input
                      type="number" step="0.01" value={project.stair.tread}
                      onChange={(e) => onUpdateStair({ tread: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    Flight width, m
                    <input
                      type="number" step="0.05" value={project.stair.width}
                      onChange={(e) => onUpdateStair({ width: Number(e.target.value) })}
                    />
                  </label>
                  <label>
                    Flight length, m
                    <input
                      type="number" step="0.1" value={project.stair.length}
                      onChange={(e) => onUpdateStair({ length: Number(e.target.value) })}
                    />
                  </label>
                </div>
                <p className="panel-note">
                  The orange contours on the plan show the headroom under the flight: low
                  at the bottom step, almost full height towards the top.
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
              Each fixture brings its own connection points. The drain is routed to the stack
              automatically and checked for a 2 cm/m slope within the floor build-up.
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
              <span>Pre-pour checks</span>
              <span className="muted">{warnings.length}</span>
            </div>
            {warnings.length === 0 && <p className="panel-note">No conflicts found.</p>}
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

        {/* Properties of the selected object — shown whenever something is selected */}
        {selected && (
          <section className="panel selected-panel">
            <div className="panel-head">
              <span>Selected</span>
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
                  X, m
                  <input
                    type="number" step="0.05" value={selected.data.x}
                    onChange={(e) => onUpdateStair({ x: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Y, m
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
        {Math.round(size.w * 1000)} × {Math.round(size.d * 1000)} × {Math.round(spec.h * 1000)} mm
        {resized && <> · catalogue {Math.round(spec.w * 1000)} × {Math.round(spec.d * 1000)}</>}
      </div>
      <div className="field-grid">
        <label>
          X, m
          <input type="number" step="0.01" value={item.x.toFixed(2)}
            onChange={(e) => onUpdate({ x: Number(e.target.value) })} />
        </label>
        <label>
          Y, m
          <input type="number" step="0.01" value={item.y.toFixed(2)}
            onChange={(e) => onUpdate({ y: Number(e.target.value) })} />
        </label>
        <label>
          Width, m
          <input type="number" step="0.01" min="0.15" value={size.w.toFixed(2)}
            onChange={(e) => onUpdate({ w: Number(e.target.value) })} />
        </label>
        <label>
          Depth, m
          <input type="number" step="0.01" min="0.15" value={size.d.toFixed(2)}
            onChange={(e) => onUpdate({ d: Number(e.target.value) })} />
        </label>
        <label>
          Rotation, °
          <input type="number" step="15" value={item.rotation || 0}
            onChange={(e) => onUpdate({ rotation: Number(e.target.value) })} />
        </label>
      </div>
      {resized && (
        <button className="link-btn" onClick={() => onUpdate({ w: undefined, d: undefined })}>
          Restore catalogue size
        </button>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={excludes}
          onChange={(e) => onUpdate({ floorExclusion: e.target.checked })}
        />
        Do not lay heating under the fixture
      </label>
      <p className="panel-note" style={{ marginTop: 2 }}>
        {excludes
          ? 'The footprint is subtracted from the heating field: the area is lost but the load stays.'
          : 'The pipe runs under the fixture — fine for furniture on legs with a gap of 50 mm or more.'}
        {spec.exclusionNote && <> {spec.exclusionNote}.</>}
      </p>

      {head !== null && (
        <p className={`headroom ${head < 1.9 ? 'low' : ''}`}>
          Headroom under the flight at this point: <b>{head.toFixed(2)} m</b>
        </p>
      )}
      {spec.connections.length > 0 && (
        <ul className="conn-list">
          {spec.connections.map((c, i) => (
            <li key={i}>
              {c.kind === 'drain' ? `Drain Ø${c.dia}` : c.kind.toUpperCase()}
              {c.critical && <span className="tag">height-critical</span>}
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
      {node.existing && <div className="tag existing">Existing node — do not move</div>}
      {node.confirmed === false && <div className="tag draft">Position not confirmed by measurement</div>}
      <div className="field-grid">
        <label>
          X, m
          <input type="number" step="0.01" value={node.x.toFixed(2)}
            onChange={(e) => onUpdate({ x: Number(e.target.value) })} />
        </label>
        <label>
          Y, m
          <input type="number" step="0.01" value={node.y.toFixed(2)}
            onChange={(e) => onUpdate({ y: Number(e.target.value) })} />
        </label>
      </div>
      {node.type === 'sewer_riser' && (
        <label className="full-field">
          Stack invert level, m (below the finished floor — negative)
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
        Position confirmed by measurement
      </label>
      {node.note && <p className="panel-note">{node.note}</p>}
    </>
  );
}
