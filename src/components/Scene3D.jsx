import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

import { CLEAR_HEIGHT, INNER_D, INNER_W } from '../data/project.js';
import { buildScene } from '../calc/scene3d.js';
import { electricalPlan } from '../calc/electrical.js';
import { heatLoss } from '../calc/heatloss.js';
import { layoutLoops } from '../calc/loops.js';

// Three-dimensional “screed X-ray”.
//
// The point is not a pretty picture but what cannot be seen on the plan:
// at what level the pipe lies relative to the cable, whether a socket falls
// into an opening, whether a head clears the flight. So the screed is translucent,
// and everything embedded in it is solid.
//
// Three.js axes: y is up. Plan (x, y) → scene (x, elev, y).

const CUT_EPS = 0.001;

function toVec(p, elev) {
  return new THREE.Vector3(p.x, elev, p.y);
}

// The pipe follows an orthogonal polyline. Corners are rounded, otherwise a bend
// gets a kink that a real pipe cannot have:
// PEX 16 has a minimum bend radius of about five diameters.
function tubeFromPoints(points, elev, radius, color) {
  const pts = points.map((p) => toVec(p, elev));
  if (pts.length < 2) return null;
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.02);
  const segments = Math.min(2000, Math.max(24, pts.length * 4));
  const geo = new THREE.TubeGeometry(curve, segments, radius, 6, false);
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.05 });
  return new THREE.Mesh(geo, mat);
}

function boxMesh({ w, h, d, color, opacity = 1, transparent = false }) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({
    color,
    transparent: transparent || opacity < 1,
    opacity,
    roughness: 0.85,
    depthWrite: opacity > 0.9
  });
  return new THREE.Mesh(geo, mat);
}

export default function Scene3D({ project }) {
  const mountRef = useRef(null);
  const groupsRef = useRef({});
  const [visible, setVisible] = useState({
    architecture: true,
    pie: true,
    heating: true,
    electrical: true,
    equipment: true
  });
  const [cut, setCut] = useState(INNER_D);

  const scene = useMemo(() => {
    const hl = heatLoss({
      layout: project.layout,
      openings: project.openings,
      climate: project.climate,
      envelope: project.envelope,
      screed: project.screed,
      clearHeight: CLEAR_HEIGHT
    });
    const loops = layoutLoops({
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
    const electrical = electricalPlan({
      equipment: project.equipment,
      entry: project.nodes.find((n) => n.type === 'electrical_panel')
    });
    return buildScene({ project, loops, electrical });
  }, [project]);

  // --- Building the scene ---
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const width = mount.clientWidth || 600;
    const height = mount.clientHeight || 460;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(width, height);
    renderer.localClippingEnabled = true;
    mount.appendChild(renderer.domElement);

    const three = new THREE.Scene();
    three.background = new THREE.Color('#f8fafc');

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 100);
    camera.position.set(INNER_W * 1.35, 5.4, INNER_D * 1.55);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(INNER_W / 2, 0.2, INNER_D / 2);
    controls.enableDamping = true;
    controls.maxPolarAngle = Math.PI / 2 - 0.02; // do not fall below the floor
    controls.update();

    three.add(new THREE.AmbientLight(0xffffff, 0.75));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(6, 9, 4);
    three.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.35);
    fill.position.set(-5, 4, -6);
    three.add(fill);

    // Clipping plane — a “section” of the model. Without it you cannot look inside.
    const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), INNER_D);
    renderer.clippingPlanes = [clip];

    const groups = {
      architecture: new THREE.Group(),
      pie: new THREE.Group(),
      heating: new THREE.Group(),
      electrical: new THREE.Group(),
      equipment: new THREE.Group()
    };
    Object.values(groups).forEach((g) => three.add(g));
    groupsRef.current = { groups, clip, renderer, camera, controls, three };

    // --- Floor build-up: slabs at their levels ---
    scene.slabs.forEach((s) => {
      const m = boxMesh({
        w: INNER_W, h: s.thickness, d: INNER_D,
        color: s.color, opacity: s.opacity, transparent: s.opacity < 1
      });
      m.position.set(INNER_W / 2, (s.top + s.bottom) / 2, INNER_D / 2);
      m.renderOrder = s.id === 'screed' ? 2 : 1;
      groups.pie.add(m);
    });

    // --- Walls ---
    scene.walls.forEach((w) => {
      const dx = w.b.x - w.a.x;
      const dy = w.b.y - w.a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return;
      const m = boxMesh({
        w: len, h: w.top - w.bottom, d: w.thickness,
        color: w.kind === 'outer' ? '#e2e8f0' : '#f1f5f9',
        opacity: w.kind === 'outer' ? 0.35 : 0.55,
        transparent: true
      });
      // Outer walls stand OUTSIDE the 5500 envelope — it is the inner one
      const outward = w.kind === 'outer' ? w.thickness / 2 : 0;
      const nx = -dy / len;
      const ny = dx / len;
      m.position.set(
        (w.a.x + w.b.x) / 2 - nx * outward,
        (w.top + w.bottom) / 2,
        (w.a.y + w.b.y) / 2 - ny * outward
      );
      m.rotation.y = -Math.atan2(dy, dx);
      groups.architecture.add(m);
    });

    // --- Openings: coloured panels in the wall body ---
    scene.openings.forEach((o) => {
      const dx = o.b.x - o.a.x;
      const dy = o.b.y - o.a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) return;
      const m = boxMesh({
        w: len, h: o.height, d: o.thickness * 1.05,
        color: o.kind === 'window' ? (o.blind ? '#94a3b8' : '#38bdf8') : '#a16207',
        opacity: o.confirmed ? 0.55 : 0.3,
        transparent: true
      });
      const nx = -dy / len;
      const ny = dx / len;
      m.position.set(
        (o.a.x + o.b.x) / 2 - nx * (o.thickness / 2),
        o.bottom + o.height / 2,
        (o.a.y + o.b.y) / 2 - ny * (o.thickness / 2)
      );
      m.rotation.y = -Math.atan2(dy, dx);
      groups.architecture.add(m);
    });

    // --- Stair ---
    scene.steps.forEach((s) => {
      const m = boxMesh({ w: s.w, h: s.height, d: s.d, color: '#d6d3d1' });
      m.position.set(s.x + s.w / 2, s.bottom + s.height / 2, s.y + s.d / 2);
      groups.architecture.add(m);
    });

    // --- Heating pipe: solid, inside the translucent screed ---
    scene.pipes.forEach((p) => {
      const m = tubeFromPoints(p.points, p.elev, p.radius, p.color);
      if (m) {
        m.renderOrder = 3;
        groups.heating.add(m);
      }
    });

    // --- Cable: below the pipe, in the insulation ---
    scene.cables.forEach((c) => {
      const m = tubeFromPoints(c.points, c.elev, c.radius, c.color);
      if (m) {
        m.renderOrder = 3;
        groups.electrical.add(m);
      }
    });

    // --- Worktop: a slab with cut-outs for the sink and the hob ---
    if (scene.worktop) {
      const wt = scene.worktop;
      const shape = new THREE.Shape(wt.polygon.map((p) => new THREE.Vector2(p.x, p.y)));
      wt.cutouts.forEach((c) => {
        const rad = (c.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const corners = [
          [-c.w / 2, -c.d / 2], [c.w / 2, -c.d / 2],
          [c.w / 2, c.d / 2], [-c.w / 2, c.d / 2]
        ].map(([dx, dy]) => new THREE.Vector2(
          c.cx + dx * cos - dy * sin,
          c.cy + dx * sin + dy * cos
        ));
        shape.holes.push(new THREE.Path(corners));
      });

      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: wt.thickness,
        bevelEnabled: false
      });
      // The shape is built in the XY plane, but we need a horizontal slab
      geo.rotateX(Math.PI / 2);
      const mesh = new THREE.Mesh(
        geo,
        new THREE.MeshStandardMaterial({ color: wt.color, roughness: 0.75 })
      );
      mesh.position.y = wt.top;
      groups.equipment.add(mesh);
    }

    // --- Equipment and electrical points ---
    scene.boxes.forEach((b) => {
      const m = boxMesh({
        w: b.w, h: b.height, d: b.d,
        color: b.color,
        opacity: b.layer === 'electrical' ? 1 : 0.8,
        transparent: b.layer !== 'electrical'
      });
      m.position.set(b.cx, b.bottom + b.height / 2, b.cy);
      m.rotation.y = -(b.rotation * Math.PI) / 180;
      groups[b.layer === 'electrical' ? 'electrical' : 'equipment'].add(m);
    });

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(three, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    const onResize = () => {
      const w = mount.clientWidth || 600;
      const h = mount.clientHeight || 460;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    // Listening to window is not enough: the panel border is dragged with the mouse, and the window
    // does not change — no resize event arrives, and the canvas stays stale.
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', onResize);
      controls.dispose();
      three.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [scene]);

  // --- Layers ---
  useEffect(() => {
    const g = groupsRef.current.groups;
    if (!g) return;
    Object.entries(visible).forEach(([k, on]) => {
      if (g[k]) g[k].visible = on;
    });
  }, [visible]);

  // --- Section ---
  useEffect(() => {
    const c = groupsRef.current.clip;
    if (c) c.constant = cut + CUT_EPS;
  }, [cut]);

  const toggle = (k) => setVisible((v) => ({ ...v, [k]: !v[k] }));

  return (
    <div className="scene3d">
      <div className="scene3d-canvas" ref={mountRef} />

      <div className="scene3d-controls">
        {[
          ['pie', 'Floor build-up'],
          ['heating', 'Heating pipe'],
          ['electrical', 'Cable and points'],
          ['equipment', 'Furniture'],
          ['architecture', 'Walls and stair']
        ].map(([k, label]) => (
          <label key={k} className="check">
            <input type="checkbox" checked={visible[k]} onChange={() => toggle(k)} />
            {label}
          </label>
        ))}

        <label className="scene3d-cut">
          Section depth: <b>{cut.toFixed(2)} m</b>
          <input
            type="range" min="0.4" max={INNER_D} step="0.05"
            value={cut}
            onChange={(e) => setCut(Number(e.target.value))}
          />
        </label>
      </div>
    </div>
  );
}
