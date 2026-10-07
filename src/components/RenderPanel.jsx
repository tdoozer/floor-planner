import React, { useEffect, useMemo, useState } from 'react';

import { CLEAR_HEIGHT } from '../data/project.js';
import { STYLES, VIEWPOINTS, buildRenderPrompt, renderUrl } from '../calc/renderPrompt.js';
import { floorLevels } from '../calc/geometry.js';

// Photorealistic render.
//
// The prompt is NOT written by hand: it is assembled from the placement — the visible
// items are taken from the chosen viewpoint and folded into a phrase. The text
// stays editable: the model does not always get it right the first time,
// and tweaking the wording must be at hand.
//
// The image goes through the /prompt/ proxy — in production it is served by nginx,
// in dev Vite proxies it. There are no keys or tokens in the code.
export default function RenderPanel({ project }) {
  const [viewpointId, setViewpointId] = useState(VIEWPOINTS[0].id);
  const [styleId, setStyleId] = useState(STYLES[0].id);
  const [daylight, setDaylight] = useState(true);
  const [seed, setSeed] = useState(1);
  const [text, setText] = useState('');
  const [edited, setEdited] = useState(false);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const lv = floorLevels(project.levels, project.screed);
  const clearHeight = lv.clearHeight / 1000;

  const built = useMemo(
    () => buildRenderPrompt({ project, viewpointId, styleId, clearHeight, daylight }),
    [project, viewpointId, styleId, clearHeight, daylight]
  );

  // While the text has not been touched by hand, it follows the placement.
  // Once touched, we stop overwriting it, otherwise edits are lost.
  useEffect(() => {
    if (!edited) setText(built.text);
  }, [built.text, edited]);

  const generate = (nextSeed = seed) => {
    setError('');
    setLoading(true);
    setSeed(nextSeed);
    setUrl(renderUrl(text || built.text, { seed: nextSeed }));
  };

  const download = async () => {
    if (!url) return;
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `floor-planner-${viewpointId}-${seed}.jpg`;
      a.click();
      URL.revokeObjectURL(href);
    } catch {
      window.open(url, '_blank');
    }
  };

  return (
    <>
      <section className="panel">
        <div className="panel-head">
          <span>Viewpoint</span>
          <span className="pill">{built.visible.length} items in frame</span>
        </div>
        <div className="variant-switch vertical">
          {VIEWPOINTS.map((v) => (
            <button
              key={v.id}
              className={v.id === viewpointId ? 'active' : ''}
              onClick={() => setViewpointId(v.id)}
            >
              {v.name}
              <span className="btn-sub">{v.hint}</span>
            </button>
          ))}
        </div>
        <p className="panel-note">
          The frame contains what actually stands on the plan:{' '}
          {built.visible.slice(0, 5).map((s) => s.name.toLowerCase()).join(', ')}
          {built.visible.length > 5 ? ' and more' : ''}. Move the sofa and the prompt
          reassembles itself.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head"><span>Style and light</span></div>
        <div className="variant-switch">
          {STYLES.map((s) => (
            <button
              key={s.id}
              className={s.id === styleId ? 'active' : ''}
              onClick={() => setStyleId(s.id)}
            >
              {s.name}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={daylight} onChange={(e) => setDaylight(e.target.checked)} />
          Daylight (otherwise evening, artificial light only)
        </label>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Prompt</span>
          {edited && (
            <button className="link-btn" onClick={() => { setEdited(false); setText(built.text); }}>
              restore the assembled one
            </button>
          )}
        </div>
        <textarea
          className="prompt-box"
          rows={7}
          value={text}
          onChange={(e) => { setText(e.target.value); setEdited(true); }}
        />
        <div className="row-btns">
          <button onClick={() => generate(seed)}>Generate</button>
          <button onClick={() => generate(Math.floor(Math.random() * 1e6))}>
            Another variant
          </button>
          {url && <button onClick={download}>Download</button>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Result</span>
          {url && <span className="pill">seed {seed}</span>}
        </div>
        {!url && (
          <p className="panel-note">
            The image comes from Pollinations through a proxy. The first
            generation takes 10–30 seconds.
          </p>
        )}
        {error && <p className="panel-note error-text">{error}</p>}
        {url && (
          <div className={`render-frame${loading ? ' loading' : ''}`}>
            <img
              src={url}
              alt="Interior visualisation"
              onLoad={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setError(
                  'The service did not respond. This is usually an overload of the free ' +
                  'Pollinations — try “Another variant” in a minute.'
                );
              }}
            />
          </div>
        )}
        <p className="panel-note">
          <b>This is a picture, not a drawing.</b> The model does not follow dimensions
          and placement literally — it shows mood and combinations.
          For geometry there is the 3D tab.
        </p>
      </section>
    </>
  );
}
