import React, { Suspense, lazy, useState } from 'react';

import RenderPanel from './RenderPanel.jsx';
import { pipeElevation, cableElevation } from '../calc/scene3d.js';

// Three.js весит немало и нужен только на этой вкладке — грузим лениво,
// чтобы не тормозить открытие плана.
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
            <button onClick={() => setMode('xray')}>Рентген стяжки</button>
            <button className="active">Фотореалистичный рендер</button>
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
          <button className="active">Рентген стяжки</button>
          <button onClick={() => setMode('render')}>Фотореалистичный рендер</button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Рентген стяжки</span>
          <span className="pill">3D</span>
        </div>

        {on ? (
          <Suspense fallback={<p className="panel-note">Загружается сцена…</p>}>
            <Scene3D project={project} />
          </Suspense>
        ) : (
          <>
            <p className="panel-note">
              Объёмная модель собирается из тех же чисел, что план и разрез:
              пирог показан послойно на своих отметках, труба и кабель — там,
              где они реально лягут. Стяжка полупрозрачная, поэтому видно,
              что в неё замуровывается.
            </p>
            <button className="link-btn" onClick={() => setOn(true)}>
              Построить сцену
            </button>
          </>
        )}
      </section>

      <section className="panel">
        <div className="panel-head"><span>Отметки в пироге</span></div>
        <table className="mini-table">
          <tbody>
            <tr><td>Чистый пол</td><td className="num">0</td></tr>
            <tr><td>Низ стяжки</td><td className="num">−{screed.finishThickness + screed.screedTotal} мм</td></tr>
            <tr className="accent"><td>Ось трубы ТП</td><td className="num">−{pipeMm.toFixed(0)} мм</td></tr>
            <tr className="accent"><td>Ось кабеля</td><td className="num">−{cableMm.toFixed(0)} мм</td></tr>
            <tr><td>Низ утеплителя</td><td className="num">−{screed.finishThickness + screed.screedTotal + screed.insulation} мм</td></tr>
          </tbody>
        </table>
        <p className="panel-note">
          Кабель идёт <b>ниже трубы, в слое утеплителя</b> — между ними{' '}
          {(cableMm - pipeMm).toFixed(0)} мм. Именно поэтому пересечения трасс
          безопасны: они физически не встречаются, и сверлить потом нечего.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head"><span>Что смотреть в объёме</span></div>
        <ul className="bullets">
          <li>Труба против кабеля — они на разных отметках, но на плане это не видно.</li>
          <li>Розетки против проёмов: коробка на своей высоте, окно на своей.</li>
          <li>Марш: 15 подступенков по 200 — на плане это одна полоса.</li>
          <li>Навесные шкафы над столешницей: в плане они накладываются, в объёме нет.</li>
        </ul>
        <p className="panel-note">
          Плита столешницы нарисована с вырезами под мойку и панель — видно,
          что стоит под ней, а что врезано в неё.
        </p>
      </section>
    </>
  );
}
