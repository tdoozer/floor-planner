import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

import Plan from './components/Plan.jsx';
import Sidebar from './components/Sidebar.jsx';
import {
  DEFAULT_LAYERS,
  CLEAR_HEIGHT,
  applyVariant,
  makeInitialProject,
  normalizeLayout
} from './data/project.js';
import { mergeProject, stampKnownIds } from './data/merge.js';
import { runRules } from './calc/rules.js';
import { heatLoss } from './calc/heatloss.js';
import { layoutLoops } from './calc/loops.js';
import { electricalPlan } from './calc/electrical.js';
import { WORLD } from './viewport.js';
import './App.css';

const LS_PROJECT = 'floor_project';
const LS_LAYERS = 'floor_layers';
const LS_SIDEBAR = 'floor_sidebar_w';

// Width of the right panel. A minimum of 320 — below it the two-column fields
// start to break; the maximum leaves the plan at least 360 px,
// otherwise it shrinks to a stamp.
export const SIDEBAR = { min: 320, max: 900, default: 380, planMin: 360 };

export function clampSidebar(width, viewportW) {
  const roomy = Math.max(SIDEBAR.min, viewportW - SIDEBAR.planMin);
  return Math.round(Math.min(Math.min(SIDEBAR.max, roomy), Math.max(SIDEBAR.min, width)));
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch (e) {
    console.error(`Failed to read ${key} from localStorage`, e);
    return fallback;
  }
}

export default function App() {
  const [project, setProject] = useState(() => {
    const saved = loadJson(LS_PROJECT, null);
    // The layout variant is also the owner's choice, not a code constant.
    // By default the bathroom is on the right, by the stack.
    const base = makeInitialProject(saved?.layout?.variant ?? 'bathRight');
    return mergeProject(base, saved);
  });

  const [layers, setLayers] = useState(() => {
    const saved = loadJson(LS_LAYERS, null);
    if (!saved) return DEFAULT_LAYERS;
    // Add missing layers if the list has grown
    return { ...DEFAULT_LAYERS, ...saved };
  });

  const [selectedId, setSelectedId] = useState(null);
  const [draggingObj, setDraggingObj] = useState(null);
  const [containerSize, setContainerSize] = useState({ width: 900, height: 700 });
  const [showConnections, setShowConnections] = useState(true);
  const [showDrainRoutes, setShowDrainRoutes] = useState(true);
  const [focusPoint, setFocusPoint] = useState(null);

  // The sidebar width is dragged with the mouse: 3D and the piping diagram need room,
  // while the plan is not needed on the Estimate tab at all.
  const [sidebarW, setSidebarW] = useState(() => {
    const saved = Number(loadJson(LS_SIDEBAR, SIDEBAR.default));
    return Number.isFinite(saved) && saved > 0 ? saved : SIDEBAR.default;
  });
  const [resizing, setResizing] = useState(false);

  const planRef = useRef(null);
  const containerRef = useRef(null);

  // ---------- Persistence ----------
  useEffect(() => {
    // Together with the project we write the list of ids known to the code right now: otherwise
    // on the next start we cannot tell what the owner deleted from what I added
    const base = makeInitialProject(project.layout.variant);
    localStorage.setItem(LS_PROJECT, JSON.stringify(stampKnownIds(project, base)));
  }, [project]);

  useEffect(() => {
    localStorage.setItem(LS_LAYERS, JSON.stringify(layers));
  }, [layers]);

  // ---------- Scaling to the window ----------
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        setContainerSize({ width, height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // “Fit to window” scale multiplied by the zoom. Margins are minimal:
  // every extra pixel of padding is a smaller plan.
  const [zoom, setZoom] = useState(1);

  const fitPxPerMeter = useMemo(() => {
    const pad = 8;
    const availW = Math.max(200, containerSize.width - pad * 2);
    const availH = Math.max(200, containerSize.height - pad * 2);
    return Math.min(availW / WORLD.w, availH / WORLD.h);
  }, [containerSize]);

  const pxPerMeter = fitPxPerMeter * zoom;

  // ---------- Dragging the divider ----------
  //
  // Listeners are attached to window, not to the divider itself: it is very easy
  // to move the cursor off a 6 px strip during a quick drag, and then the drag
  // silently breaks off.
  useEffect(() => {
    if (!resizing) return undefined;

    const onMove = (e) => {
      const x = e.touches ? e.touches[0].clientX : e.clientX;
      setSidebarW(clampSidebar(window.innerWidth - x, window.innerWidth));
    };
    const stop = () => setResizing(false);

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stop);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend', stop);
    // While dragging we suppress text selection and hold the cursor, otherwise halfway
    // the whole page gets selected
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', stop);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', stop);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
    };
  }, [resizing]);

  // The window was narrowed — the panel may have gone beyond the allowed limits
  useEffect(() => {
    const onResize = () => setSidebarW((w) => clampSidebar(w, window.innerWidth));
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    localStorage.setItem(LS_SIDEBAR, JSON.stringify(sidebarW));
  }, [sidebarW]);

  // Keyboard: arrows move the divider, Home restores the original width
  const onSplitterKey = useCallback((e) => {
    const step = e.shiftKey ? 48 : 12;
    if (e.key === 'ArrowLeft') {
      setSidebarW((w) => clampSidebar(w + step, window.innerWidth));
    } else if (e.key === 'ArrowRight') {
      setSidebarW((w) => clampSidebar(w - step, window.innerWidth));
    } else if (e.key === 'Home') {
      setSidebarW(clampSidebar(SIDEBAR.default, window.innerWidth));
    } else {
      return;
    }
    e.preventDefault();
  }, []);

  // ---------- Mutations ----------
  const updateEquipment = useCallback((id, updates) => {
    setProject((p) => ({
      ...p,
      equipment: p.equipment.map((e) => (e.id === id ? { ...e, ...updates } : e))
    }));
  }, []);

  const updateNode = useCallback((id, updates) => {
    setProject((p) => ({
      ...p,
      nodes: p.nodes.map((n) => (n.id === id ? { ...n, ...updates } : n))
    }));
  }, []);

  const updateStair = useCallback((updates) => {
    setProject((p) => ({ ...p, stair: { ...p.stair, ...updates } }));
  }, []);

  // A partition was moved — rooms, areas and all checks were recalculated.
  const updateLayout = useCallback((updates) => {
    setProject((p) => ({ ...p, layout: normalizeLayout({ ...p.layout, ...updates }) }));
  }, []);

  // Switching the layout variant. Replaces the breakdown, openings and placement;
  // the stair and the floor build-up are kept — they do not depend on the variant.
  const switchVariant = useCallback((variantId) => {
    setProject((p) => (p.layout.variant === variantId ? p : applyVariant(p, variantId)));
    setSelectedId(null);
  }, []);

  const updateScreed = useCallback((updates) => {
    setProject((p) => ({ ...p, screed: { ...p.screed, ...updates } }));
  }, []);

  const updateLevels = useCallback((updates) => {
    setProject((p) => ({ ...p, levels: { ...p.levels, ...updates } }));
  }, []);

  const updateClimate = useCallback((updates) => {
    setProject((p) => ({ ...p, climate: { ...p.climate, ...updates } }));
  }, []);

  const updateEnvelope = useCallback((updates) => {
    setProject((p) => ({ ...p, envelope: { ...p.envelope, ...updates } }));
  }, []);

  const updateKitchenFrame = useCallback((on) => {
    setProject((p) => ({ ...p, kitchenOnFrame: on }));
  }, []);

  const updateSpacing = useCallback((roomId, spacing) => {
    setProject((p) => ({ ...p, loopSpacings: { ...p.loopSpacings, [roomId]: spacing } }));
  }, []);

  const updateOpening = useCallback((id, updates) => {
    setProject((p) => ({
      ...p,
      openings: p.openings.map((o) => (o.id === id ? { ...o, ...updates } : o))
    }));
  }, []);

  const addEquipment = useCallback((catalogId) => {
    const id = `eq-${catalogId}-${Date.now().toString(36)}`;
    setProject((p) => ({
      ...p,
      equipment: [...p.equipment, { id, catalogId, x: 1.5, y: 2.5, rotation: 0 }]
    }));
    setSelectedId(id);
  }, []);

  const deleteObject = useCallback((id) => {
    setProject((p) => ({
      ...p,
      equipment: p.equipment.filter((e) => e.id !== id)
    }));
    setSelectedId((cur) => (cur === id ? null : cur));
  }, []);

  const handleUpdateLayer = useCallback((layerId, updates) => {
    setLayers((prev) => ({ ...prev, [layerId]: { ...prev[layerId], ...updates } }));
  }, []);

  const handleReset = useCallback(() => {
    if (!window.confirm('Reset the layout to the original? All your edits will be lost.')) return;
    // The current variant is kept — edits within it are reset, not the choice of variant
    setProject((p) => makeInitialProject(p.layout.variant));
    setLayers(DEFAULT_LAYERS);
    setSelectedId(null);
  }, []);

  // ---------- Warnings ----------
  const warnings = useMemo(() => runRules(project, CLEAR_HEIGHT), [project]);

  // ---------- Loop layout for drawing on the “Underfloor heating” layer ----------
  const loops = useMemo(() => {
    const hl = heatLoss({
      layout: project.layout,
      openings: project.openings,
      climate: project.climate,
      envelope: project.envelope,
      screed: project.screed,
      clearHeight: CLEAR_HEIGHT
    });
    return layoutLoops({
      layout: project.layout,
      heatLossByRoom: hl.byRoom,
      manifold: project.nodes.find((n) => n.type === 'manifold'),
      coolant: project.coolant,
      spacings: project.loopSpacings,
      equipment: project.equipment,
      exclusionZones: project.floorExclusionZones,
      mode: project.loopMode,
      kitchenOnFrame: project.kitchenOnFrame
    });
  }, [project]);

  // Electrical routes are recalculated together with the placement of points
  const electrical = useMemo(
    () =>
      electricalPlan({
        equipment: project.equipment,
        entry: project.nodes.find((n) => n.type === 'electrical_panel')
      }),
    [project]
  );

  // ---------- Export ----------
  //
  // html2canvas parses CSS with its own parser and stumbles on anything
  // modern. Any such stumble is an exception inside an async handler,
  // i.e. THE BUTTON SIMPLY DOES NOT WORK and reports nothing. So there are
  // two layers of protection here: cleaning styles in the clone and an explicit error message.
  const [exportError, setExportError] = useState('');

  const captureCanvas = useCallback(async () => {
    const node = planRef.current;
    if (!node) return null;
    setSelectedId(null);
    setDraggingObj(null);
    await new Promise((r) => setTimeout(r, 150));
    return html2canvas(node, {
      scale: 3,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true,
      // The zoom panel is not needed on the drawing
      ignoreElements: (el) => el.classList?.contains('zoom-bar'),
      onclone: (doc) => {
        // Gradients and anything the parser cannot handle are replaced with a flat fill:
        // on a drawing a two-colour icon is not worth a lost export
        doc.querySelectorAll('*').forEach((el) => {
          const bg = el.style?.backgroundImage;
          if (bg && bg !== 'none') {
            const first = bg.match(/#[0-9a-f]{3,8}|rgba?\([^)]+\)/i);
            el.style.backgroundImage = 'none';
            if (first) el.style.backgroundColor = first[0];
          }
        });
      }
    });
  }, []);

  const visibleLayerNames = useMemo(
    () => Object.entries(layers).filter(([, v]) => v.visible).map(([k]) => k),
    [layers]
  );

  const handleExportPng = useCallback(async () => {
    setExportError('');
    try {
      const canvas = await captureCanvas();
      if (!canvas) return;
      const link = document.createElement('a');
      link.download = `plan-1etazh-${visibleLayerNames.join('-')}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (e) {
      console.error('PNG export failed', e);
      setExportError(`PNG was not saved: ${e.message}`);
    }
  }, [captureCanvas, visibleLayerNames]);

  const exportPdf = useCallback(async () => {
    const canvas = await captureCanvas();
    if (!canvas) return;
    const landscape = canvas.width >= canvas.height;
    const pdf = new jsPDF({ orientation: landscape ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 24;
    const maxW = pageW - margin * 2;
    const maxH = pageH - margin * 2 - 28;
    const ratio = Math.min(maxW / canvas.width, maxH / canvas.height);
    const w = canvas.width * ratio;
    const h = canvas.height * ratio;

    pdf.setFontSize(11);
    pdf.text(`Ground floor plan 5.5 x 5.5 m — layers: ${visibleLayerNames.join(', ')}`, margin, margin + 6);
    pdf.addImage(canvas.toDataURL('image/png'), 'PNG', margin, margin + 20, w, h);
    pdf.save(`plan-1etazh-${visibleLayerNames.join('-')}.pdf`);
  }, [captureCanvas, visibleLayerNames]);

  const handleExportPdf = useCallback(async () => {
    setExportError('');
    try {
      await exportPdf();
    } catch (e) {
      console.error('PDF export failed', e);
      setExportError(`PDF was not saved: ${e.message}`);
    }
  }, [exportPdf]);


  const selected = useMemo(() => {
    if (!selectedId) return null;
    const eq = project.equipment.find((e) => e.id === selectedId);
    if (eq) return { kind: 'equipment', data: eq };
    const nd = project.nodes.find((n) => n.id === selectedId);
    if (nd) return { kind: 'node', data: nd };
    if (project.stair && project.stair.id === selectedId) return { kind: 'stair', data: project.stair };
    return null;
  }, [selectedId, project]);

  return (
    <div className="app">
      <div className="plan-column" ref={containerRef}>
        <div className="zoom-bar">
          <button onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))}
            title="Smaller">−</button>
          <button className="zoom-fit" onClick={() => setZoom(1)} title="Fit to window">
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={() => setZoom((z) => Math.min(4, +(z + 0.25).toFixed(2)))}
            title="Larger">+</button>
        </div>
        <Plan
          ref={planRef}
          project={project}
          layers={layers}
          pxPerMeter={pxPerMeter}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onUpdateEquipment={updateEquipment}
          onUpdateNode={updateNode}
          onUpdateStair={updateStair}
          onUpdateLayout={updateLayout}
          draggingObj={draggingObj}
          setDraggingObj={setDraggingObj}
          showConnections={showConnections}
          showDrainRoutes={showDrainRoutes}
          loops={loops}
          electrical={electrical}
          warnings={warnings}
          focusPoint={focusPoint}
        />
      </div>

      <div
        className={`splitter${resizing ? ' active' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="Divider between the plan and the panel"
        aria-valuenow={sidebarW}
        aria-valuemin={SIDEBAR.min}
        aria-valuemax={SIDEBAR.max}
        tabIndex={0}
        title="Drag with the mouse · double-click — original width"
        onMouseDown={(e) => { e.preventDefault(); setResizing(true); }}
        onTouchStart={() => setResizing(true)}
        onDoubleClick={() => setSidebarW(clampSidebar(SIDEBAR.default, window.innerWidth))}
        onKeyDown={onSplitterKey}
      >
        <span className="splitter-grip" />
      </div>

      <Sidebar
        exportError={exportError}
        width={sidebarW}
        project={project}
        layers={layers}
        warnings={warnings}
        selected={selected}
        onUpdateLayer={handleUpdateLayer}
        onAddEquipment={addEquipment}
        onDeleteObject={deleteObject}
        onUpdateEquipment={updateEquipment}
        onUpdateNode={updateNode}
        onUpdateStair={updateStair}
        onUpdateLayout={updateLayout}
        onSwitchVariant={switchVariant}
        onUpdateScreed={updateScreed}
        onUpdateLevels={updateLevels}
        onUpdateClimate={updateClimate}
        onUpdateEnvelope={updateEnvelope}
        onUpdateSpacing={updateSpacing}
        onUpdateKitchenFrame={updateKitchenFrame}
        onUpdateOpening={updateOpening}
        onSelect={setSelectedId}
        onFocus={setFocusPoint}
        onExportPng={handleExportPng}
        onExportPdf={handleExportPdf}
        onReset={handleReset}
        showConnections={showConnections}
        setShowConnections={setShowConnections}
        showDrainRoutes={showDrainRoutes}
        setShowDrainRoutes={setShowDrainRoutes}
      />
    </div>
  );
}
