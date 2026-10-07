// @vitest-environment jsdom
//
// Смоук-тест: приложение действительно монтируется и рисует план.
// Ловит именно тот класс ошибок, который на проде выглядит как пустая страница —
// битый импорт, отсутствующий слой, падение в расчётном ядре при первом рендере.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import App, { SIDEBAR, clampSidebar } from '../App.jsx';

// Без `globals: true` автоочистка testing-library не регистрируется,
// и рендеры накапливаются между тестами. Чистим явно.
afterEach(cleanup);

beforeAll(() => {
  // jsdom не реализует ResizeObserver, а App масштабирует план по контейнеру.
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  localStorage.clear();
});

describe('Приложение монтируется', () => {
  it('рисует заголовок и все три помещения', () => {
    render(<App />);
    expect(screen.getByText('Первый этаж 5,5 × 5,5')).toBeTruthy();
    expect(screen.getAllByText('Зал (кухня-гостиная)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Санузел').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Прихожая-котельная').length).toBeGreaterThan(0);
  });

  it('площади сходятся к 30,25 м² в свету', () => {
    render(<App />);
    expect(screen.getByText('30.25 м²')).toBeTruthy();
  });

  it('выводит все шесть слоёв', () => {
    render(<App />);
    ['Архитектура', 'Сантехника', 'Тёплый пол', 'Электрика', 'Оборудование', 'Размеры']
      .forEach((name) => expect(screen.getByText(name)).toBeTruthy());
  });

  it('рендерит расставленное оборудование на плане', () => {
    render(<App />);
    // Приборы из стартовой расстановки — подписи на плане
    expect(screen.getAllByTitle('Холодильник').length).toBeGreaterThan(0);
    expect(screen.getAllByTitle('Унитаз').length).toBeGreaterThan(0);
    expect(screen.getAllByTitle('Душевая кабина 900×900').length).toBeGreaterThan(0);
  });

  it('стартует на варианте «санузел справа» с угловой кухней', () => {
    render(<App />);
    expect(document.querySelector('.variant-switch button.active').textContent).toBe('Санузел справа');
    // Кухня углом: линия по верхней стене плюс ветка вдоль грани санузла.
    // Мойка ЛИНЕЙНАЯ и под глухой створкой окна — угловая уступила место
    // правильному порядку зон.
    expect(screen.getAllByTitle('Столешница / шкаф 600').length).toBe(1);
    expect(screen.getAllByTitle('Мойка (модуль 600)').length).toBe(1);
    expect(screen.getAllByTitle('Стиральная машина').length).toBe(1);
    // Духовой шкаф — в колонне у перегородки санузла
    expect(screen.getAllByTitle('Духовой шкаф').length).toBe(1);
  });

  it('показывает полный расчёт лестницы с обеими формулами', () => {
    render(<App />);
    ['Угол наклона', 'Высота ступени h', 'Ширина ступени', 'Ширина проступи s',
      'Блонделя 2h + s', 'Удобства h + s'].forEach((label) => {
      expect(screen.getByText(label)).toBeTruthy();
    });
    // Ширина ступени — проектные 800
    const row = screen.getByText('Ширина ступени').closest('tr');
    expect(within(row).getByText('800 мм')).toBeTruthy();
  });

  it('рисует существующие узлы, включая стояк и оба ввода газа', () => {
    render(<App />);
    expect(screen.getAllByTitle('Стояк канализации, 100-я труба').length).toBeGreaterThan(0);
    expect(screen.getAllByTitle('Ввод газа к плите').length).toBeGreaterThan(0);
    expect(screen.getAllByTitle('Ввод газа к котлу').length).toBeGreaterThan(0);
  });
});

describe('Слои', () => {
  it('скрытие слоя «Оборудование» убирает приборы с плана', () => {
    render(<App />);
    expect(screen.getAllByTitle('Холодильник').length).toBeGreaterThan(0);

    const row = screen.getByText('Оборудование').closest('.layer-row');
    fireEvent.click(within(row).getByTitle('Скрыть слой'));

    expect(screen.queryAllByTitle('Холодильник')).toHaveLength(0);
  });

  it('«Скрыть все» гасит слои, повторное нажатие возвращает', () => {
    render(<App />);
    const toggle = screen.getByText('Скрыть все');
    fireEvent.click(toggle);
    expect(screen.queryAllByTitle('Холодильник')).toHaveLength(0);

    fireEvent.click(screen.getByText('Показать все'));
    expect(screen.getAllByTitle('Холодильник').length).toBeGreaterThan(0);
  });

  it('состояние слоёв переживает перемонтирование (localStorage)', () => {
    const first = render(<App />);
    const row = screen.getByText('Оборудование').closest('.layer-row');
    fireEvent.click(within(row).getByTitle('Скрыть слой'));
    first.unmount();

    render(<App />);
    expect(screen.queryAllByTitle('Холодильник')).toHaveLength(0);
  });
});

describe('Проверки перед заливкой', () => {
  it('вкладка «Проверки» показывает предупреждение о неподтверждённых привязках', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Проверки/ }));
    expect(screen.getByText(/привязок не подтверждено замером/)).toBeTruthy();
  });

  it('уменьшение стяжки до 55 мм даёт ошибку по защитному слою над трубой', () => {
    render(<App />);
    const input = screen.getByLabelText(/Стяжка, мм/i, { selector: 'input' });
    fireEvent.change(input, { target: { value: '55' } });

    fireEvent.click(screen.getByRole('button', { name: /Проверки/ }));
    expect(screen.getByText('Мало бетона над трубой тёплого пола')).toBeTruthy();
  });
});

describe('Переключение вариантов планировки', () => {
  const hallArea = (container) => {
    const row = [...container.querySelectorAll('.mini-table tr')]
      .find((tr) => tr.textContent.startsWith('Прихожая-котельная'));
    return parseFloat(row.querySelector('.num').textContent);
  };

  it('переключение вариантов меняет расстановку кухни', () => {
    render(<App />);
    // В правом варианте духовка ушла на боковую ветку у перегородки санузла,
    // а посудомойка стала УЗКОЙ — 450 вместо 600: этим и высвободились
    // те 150 мм, на которые уехал весь фронт влево от угла
    expect(screen.getAllByTitle('Духовой шкаф').length).toBe(1);
    expect(screen.getAllByTitle('Посудомойка 450').length).toBe(1);
    expect(screen.queryAllByTitle('Посудомойка 600')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Санузел слева, кухня углом' }));
    // Левый вариант перестраивает кухню целиком, но приборы те же
    expect(screen.getAllByTitle('Мойка (модуль 600)').length).toBe(1);
    expect(screen.getAllByTitle('Духовой шкаф').length).toBe(1);
  });

  it('в обоих вариантах сумма площадей остаётся 30,25 м²', () => {
    render(<App />);
    expect(screen.getByText('30.25 м²')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Санузел слева, кухня углом' }));
    expect(screen.getByText('30.25 м²')).toBeTruthy();
  });

  it('прихожая не зависит от варианта — её держат котёл и ввод газа', () => {
    const { container } = render(<App />);
    const before = hallArea(container);
    fireEvent.click(screen.getByRole('button', { name: 'Санузел слева, кухня углом' }));
    expect(hallArea(container)).toBeCloseTo(before, 2);
  });

  it('выбор варианта переживает перемонтирование', () => {
    const first = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Санузел слева, кухня углом' }));
    first.unmount();

    render(<App />);
    expect(document.querySelector('.variant-switch button.active').textContent)
      .toBe('Санузел слева, кухня углом');
  });
});

describe('Редактирование мышкой и полями', () => {
  it('перегородки отрисованы как ручки перетаскивания', () => {
    const { container } = render(<App />);
    // Санузел справа: две его грани + две грани прихожей
    expect(container.querySelectorAll('.ph-grip').length).toBe(4);

    // Слева санузел отрывается от стен, появляется третья грань
    fireEvent.click(screen.getByRole('button', { name: 'Санузел слева, кухня углом' }));
    expect(container.querySelectorAll('.ph-grip').length).toBe(5);
  });

  it('лестница имеет область захвата и ручки размера', () => {
    render(<App />);
    const stair = screen.getByTitle(/Лестница на мансарду/);
    expect(stair).toBeTruthy();
    fireEvent.mouseDown(stair);
    expect(document.querySelectorAll('.rz').length).toBeGreaterThan(0);
  });

  it('изменение ширины прихожей меняет её площадь', () => {
    const { container } = render(<App />);
    // Название помещения есть и на плане, и в таблице — берём строку таблицы
    const hallArea = () => {
      const row = [...container.querySelectorAll('.mini-table tr')]
        .find((tr) => tr.textContent.startsWith('Прихожая-котельная'));
      return parseFloat(row.querySelector('.num').textContent);
    };

    const before = hallArea();
    fireEvent.change(
      screen.getByLabelText(/Прихожая, ширина м/i, { selector: 'input' }),
      { target: { value: '2.40' } }
    );
    expect(hallArea()).toBeGreaterThan(before);
  });

  it('прибор можно растянуть через поля размера', () => {
    render(<App />);
    fireEvent.mouseDown(screen.getByTitle('Холодильник'));

    const widthField = screen.getByLabelText(/Ширина, м/i, { selector: 'input' });
    fireEvent.change(widthField, { target: { value: '0.80' } });

    expect(screen.getByText(/800 × 650/)).toBeTruthy();
    expect(screen.getByText('Вернуть каталожный габарит')).toBeTruthy();
  });
});

describe('Слой «Электрика»', () => {
  const hideLayer = (name) => {
    const row = [...document.querySelectorAll('.layer-row')]
      .find((r) => r.textContent.includes(name));
    fireEvent.click(row.querySelector('button'));
  };

  it('розетки и светильники живут на слое электрики, а не оборудования', () => {
    render(<App />);
    expect(screen.getAllByTitle('Блок 4 розетки').length).toBeGreaterThan(0);
    expect(screen.getAllByTitle('Светильник общий (плафон)').length).toBeGreaterThan(0);

    hideLayer('Электрика');
    expect(screen.queryAllByTitle('Блок 4 розетки')).toHaveLength(0);
    expect(screen.queryAllByTitle('Светильник общий (плафон)')).toHaveLength(0);
    // Мебель при этом на месте
    expect(screen.getAllByTitle('Холодильник').length).toBeGreaterThan(0);
  });

  it('скрытие оборудования не трогает электрику', () => {
    render(<App />);
    hideLayer('Оборудование');
    expect(screen.queryAllByTitle('Холодильник')).toHaveLength(0);
    expect(screen.getAllByTitle('Блок 4 розетки').length).toBeGreaterThan(0);
  });
});

describe('Обход мебели тёплым полом', () => {
  it('диван и лавки стоят на ножках — труба идёт под ними', () => {
    render(<App />);
    fireEvent.mouseDown(screen.getAllByTitle('Диван')[0]);
    const box = screen.getByLabelText(/Не класть тёплый пол под прибором/i);
    expect(box.checked).toBe(false);
  });

  it('кухонные шкафы исключены из поля пола', () => {
    render(<App />);
    fireEvent.mouseDown(screen.getAllByTitle('Холодильник')[0]);
    expect(screen.getByLabelText(/Не класть тёплый пол под прибором/i).checked).toBe(true);
  });

  it('переключатель меняет полезную площадь и требуемый съём', () => {
    const { container } = render(<App />);
    const living = () => {
      fireEvent.click(screen.getByRole('button', { name: /^Петли$/ }));
      const row = [...container.querySelectorAll('.mini-table tr')]
        .find((tr) => tr.textContent.startsWith('Зал'));
      return row.textContent;
    };
    const before = living();

    fireEvent.click(screen.getByRole('button', { name: /^План$/ }));
    fireEvent.mouseDown(screen.getAllByTitle('Диван')[0]);
    fireEvent.click(screen.getByLabelText(/Не класть тёплый пол под прибором/i));

    expect(living()).not.toBe(before);
  });
});

describe('Каталог', () => {
  it('добавляет прибор на план по клику', () => {
    render(<App />);
    // Берём позицию, которой ещё нет в стартовой расстановке
    expect(screen.queryAllByTitle('Тумба ТВ')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /^Каталог$/ }));
    fireEvent.click(screen.getByText('Тумба ТВ').closest('button'));

    fireEvent.click(screen.getByRole('button', { name: /^План$/ }));
    expect(screen.getAllByTitle('Тумба ТВ').length).toBe(1);
  });
});


describe('граница плана и панели', () => {
  it('панель не ужимается ниже минимума — иначе ломаются поля в две колонки', () => {
    expect(clampSidebar(50, 1600)).toBe(SIDEBAR.min);
  });

  it('панель не съедает план целиком', () => {
    // На 1100 px минимум плана бьёт абсолютный потолок панели
    expect(clampSidebar(5000, 1100)).toBe(1100 - SIDEBAR.planMin);
  });

  it('абсолютный потолок держится даже на широком мониторе', () => {
    expect(clampSidebar(5000, 4000)).toBe(SIDEBAR.max);
  });

  it('на узком окне минимум панели важнее минимума плана', () => {
    // 600 px ширины: обоим минимумам не хватит места, панель побеждает —
    // без неё пользоваться нечем, план хотя бы прокручивается
    expect(clampSidebar(400, 600)).toBe(SIDEBAR.min);
  });

  it('исходная ширина проходит без изменений', () => {
    expect(clampSidebar(SIDEBAR.default, 1600)).toBe(SIDEBAR.default);
  });

  it('разделитель отрисован и доступен с клавиатуры', () => {
    render(<App />);
    const sep = document.querySelector('.splitter');
    expect(sep).toBeTruthy();
    expect(sep.getAttribute('role')).toBe('separator');
    expect(sep.getAttribute('tabindex')).toBe('0');
  });

  it('ширина панели восстанавливается из localStorage', () => {
    localStorage.setItem('floor_sidebar_w', '520');
    render(<App />);
    const aside = document.querySelector('.sidebar');
    expect(aside.style.width).toBe('520px');
  });
});
