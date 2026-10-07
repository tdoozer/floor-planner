import React, { useEffect, useMemo, useState } from 'react';

import { CLEAR_HEIGHT } from '../data/project.js';
import { STYLES, VIEWPOINTS, buildRenderPrompt, renderUrl } from '../calc/renderPrompt.js';
import { floorLevels } from '../calc/geometry.js';

// Фотореалистичный рендер.
//
// Промпт НЕ пишется руками: он собирается из расстановки — из выбранной
// точки съёмки берутся видимые предметы и складываются во фразу. Текст
// при этом остаётся редактируемым: модель не всегда понимает с первого раза,
// и правка формулировки должна быть под рукой.
//
// Картинка идёт через прокси /prompt/ — в проде его отдаёт nginx,
// в dev проксирует Vite. Ключей и токенов в коде нет.
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

  // Пока текст не трогали руками — он следует за расстановкой.
  // Тронули — перестаём его перетирать, иначе правки пропадают.
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
          <span>Точка съёмки</span>
          <span className="pill">{built.visible.length} предметов в кадре</span>
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
          В кадр попадает то, что реально стоит на плане:{' '}
          {built.visible.slice(0, 5).map((s) => s.name.toLowerCase()).join(', ')}
          {built.visible.length > 5 ? ' и дальше' : ''}. Двинули диван — промпт
          пересобрался сам.
        </p>
      </section>

      <section className="panel">
        <div className="panel-head"><span>Стиль и свет</span></div>
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
          Дневной свет (иначе вечер, только искусственный)
        </label>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Промпт</span>
          {edited && (
            <button className="link-btn" onClick={() => { setEdited(false); setText(built.text); }}>
              вернуть собранный
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
          <button onClick={() => generate(seed)}>Сгенерировать</button>
          <button onClick={() => generate(Math.floor(Math.random() * 1e6))}>
            Другой вариант
          </button>
          {url && <button onClick={download}>Скачать</button>}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span>Результат</span>
          {url && <span className="pill">seed {seed}</span>}
        </div>
        {!url && (
          <p className="panel-note">
            Картинка приходит с Pollinations через локальный прокси. Первая
            генерация занимает 10–30 секунд.
          </p>
        )}
        {error && <p className="panel-note error-text">{error}</p>}
        {url && (
          <div className={`render-frame${loading ? ' loading' : ''}`}>
            <img
              src={url}
              alt="Визуализация интерьера"
              onLoad={() => setLoading(false)}
              onError={() => {
                setLoading(false);
                setError(
                  'Сервис не ответил. Обычно это перегрузка бесплатного ' +
                  'Pollinations — попробуйте «Другой вариант» через минуту.'
                );
              }}
            />
          </div>
        )}
        <p className="panel-note">
          <b>Это картинка, а не чертёж.</b> Модель не соблюдает размеры
          и расстановку буквально — она показывает настроение и сочетания.
          Для геометрии есть вкладка 3D.
        </p>
      </section>
    </>
  );
}
