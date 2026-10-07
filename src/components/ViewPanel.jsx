import React, { Suspense, lazy, useState } from 'react';

import RenderPanel from './RenderPanel.jsx';
import { pipeElevation, cableElevation } from '../calc/scene3d.js';

// Three.js is heavy and only needed on this tab — loaded lazily
// so that opening the plan is not slowed down.
const Scene3D = lazy(() => import('./Scene3D.jsx'));

export default function ViewPanel({ project }) {
  const [on, setOn] = useState(false);
  const [mode, setMode] = useState('xray');
  const { screed } = project;

  const pipeMm = -pipeElevation(screed) * 1000;
  const cableMm = -cableElevation(screed) * 1000;

  if (mode === 'render') {
    return (
      <>
        <section className="panel">
          <div className="variant-switch">
            <button onClick={() => setMode('xray')}>Screed X-ray</button>
            <button className="active">Photorealistic render</button>
          </div>
        </section>
        <RenderPanel project={project} />
      </>
    );
  }

  return (
    <>
      <section className="panel">
        <div className="variant-switch">
          <button className="active">Screed X-ray</button>
          <button onClick={() => setMode('render')}>Photorealistic render</button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Screed X-ray</span>
          <span className="pill">3D</span>
        </div>

        {on ? (
          <Suspense fallback={<p className="panel-note">Loading scene…</p>}>
            <Scene3D project={project} />
          </Suspense>
        ) : (
          <>
            <p className="panel-note">
              The 3D model is built from the same numbers as the plan and the section:
              the build-up is shown layer by layer at its levels, the pipe and cable where
              they will actually lie. The screed is translucent, so you can see
              what is embedded in it.
            </p>
            <button className="link-btn" onClick={() => setOn(true)}>
              Build scene
            </button>
          </>
        )}
      </section>

      <section className="panel">
        <div className="panel-head"><span>Levels in the build-up</span></div>
        <table className="mini-table">
          <tbody>
            <tr><td>Finished floor</td><td className="num">0</td></tr>
            <tr><td>Screed bottom</td><td className="num">−{screed.finishThickness + screed.screedTotal} mm</td></tr>
            <tr className="accent"><td>Heating pipe axis</td><td className="num">−{pipeMm.toFixed(0)} mm</td></tr>
            <tr className="accent"><td>Cable axis</td><td className="num">−{cableMm.toFixed(0)} mm</td></tr>
            <tr><td>Insulation bottom</td><td className="num">−{screed.finishThickness + screed.screedTotal + screed.insulation} mm</td></tr>
          </tbody>
        </table>
        <p className="panel-note">
          The cable runs <b>below the pipe, in the insulation layer</b> — {(cableMm - pipeMm).toFixed(0)} mm
          between them. That is exactly why route crossings
          are safe: they physically never meet, and there is nothing to drill into later.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head"><span>What to look at in 3D</span></div>
        <ul className="bullets">
          <li>Pipe against cable — they are at different levels, but the plan does not show it.</li>
          <li>Sockets against openings: the box at its height, the window at its own.</li>
          <li>The flight: 15 risers of 200 — on the plan it is a single strip.</li>
          <li>Wall cabinets over the worktop: they overlap in plan, not in 3D.</li>
        </ul>
        <p className="panel-note">
          The worktop slab is drawn with cut-outs for the sink and the hob — you can see
          what stands under it and what is set into it.
        </p>
      </section>
    </>
  );
}
