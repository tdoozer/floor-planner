// @vitest-environment jsdom
//
// Smoke test: the app really mounts and draws the plan.
// Catches exactly the class of errors that looks like an empty page in production —
// a broken import, a missing layer, a crash in the calculation core on first render.

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';

import App, { SIDEBAR, clampSidebar } from '../App.jsx';

// Without `globals: true` the testing-library auto-cleanup is not registered,
// and renders pile up between tests. We clean up explicitly.
afterEach(cleanup);

beforeAll(() => {
  // jsdom does not implement ResizeObserver, and App scales the plan to its container.
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  localStorage.clear();
});

describe('The app mounts', () => {
  it('draws the heading and all three rooms', () => {
    render(<App />);
    expect(screen.getByText('Ground floor 5.5 × 5.5')).toBeTruthy();
    expect(screen.getAllByText('Living room (kitchen-living)').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bathroom').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Hall / boiler room').length).toBeGreaterThan(0);
  });

  it('areas add up to 30.25 m² clear', () => {
    render(<App />);
    expect(screen.getByText('30.25 m²')).toBeTruthy();
  });

  it('shows all six layers', () => {
    render(<App />);
    ['Architecture', 'Plumbing', 'Underfloor heating', 'Electrics', 'Equipment', 'Dimensions']
      .forEach((name) => expect(screen.getByText(name)).toBeTruthy());
  });

  it('renders the placed equipment on the plan', () => {
    render(<App />);
    // Fixtures from the starting placement — labels on the plan
    expect(screen.getAllByTitle('Refrigerator').length).toBeGreaterThan(0);
    expect(screen.getAllByTitle('Toilet').length).toBeGreaterThan(0);
    expect(screen.getAllByTitle('Shower cabin 900×900').length).toBeGreaterThan(0);
  });

  it('starts on the “bathroom on the right” variant with the kitchen in a line', () => {
    render(<App />);
    expect(document.querySelector('.variant-switch button.active').textContent).toBe('Bathroom on the right');
    // Kitchen in a line along the top wall plus a branch along the bathroom face.
    // The sink is LINEAR and under the fixed sash of the window — the corner one gave way
    // to the right order of zones.
    expect(screen.getAllByTitle('Worktop / cabinet 600').length).toBe(1);
    expect(screen.getAllByTitle('Sink (600 module)').length).toBe(1);
    expect(screen.getAllByTitle('Washing machine').length).toBe(1);
    // The oven — in a column by the bathroom partition
    expect(screen.getAllByTitle('Oven').length).toBe(1);
  });

  it('shows the full stair calculation with both formulas', () => {
    render(<App />);
    ['Slope angle', 'Riser height h', 'Step width', 'Tread depth s',
      'Blondel 2h + s', 'Comfort h + s'].forEach((label) => {
      expect(screen.getByText(label)).toBeTruthy();
    });
    // Step width — the design 800
    const row = screen.getByText('Step width').closest('tr');
    expect(within(row).getByText('800 mm')).toBeTruthy();
  });

  it('draws the existing nodes, including the stack and both gas inlets', () => {
    render(<App />);
    expect(screen.getAllByTitle('Sewer stack, 100 mm pipe').length).toBeGreaterThan(0);
    expect(screen.getAllByTitle('Gas inlet to the hob').length).toBeGreaterThan(0);
    expect(screen.getAllByTitle('Gas inlet to the boiler').length).toBeGreaterThan(0);
  });
});

describe('Layers', () => {
  it('hiding the “Equipment” layer removes fixtures from the plan', () => {
    render(<App />);
    expect(screen.getAllByTitle('Refrigerator').length).toBeGreaterThan(0);

    const row = screen.getByText('Equipment').closest('.layer-row');
    fireEvent.click(within(row).getByTitle('Hide layer'));

    expect(screen.queryAllByTitle('Refrigerator')).toHaveLength(0);
  });

  it('“Hide all” turns the layers off, pressing again brings them back', () => {
    render(<App />);
    const toggle = screen.getByText('Hide all');
    fireEvent.click(toggle);
    expect(screen.queryAllByTitle('Refrigerator')).toHaveLength(0);

    fireEvent.click(screen.getByText('Show all'));
    expect(screen.getAllByTitle('Refrigerator').length).toBeGreaterThan(0);
  });

  it('layer state survives remounting (localStorage)', () => {
    const first = render(<App />);
    const row = screen.getByText('Equipment').closest('.layer-row');
    fireEvent.click(within(row).getByTitle('Hide layer'));
    first.unmount();

    render(<App />);
    expect(screen.queryAllByTitle('Refrigerator')).toHaveLength(0);
  });
});

describe('Pre-pour checks', () => {
  it('the “Checks” tab shows a warning about unconfirmed references', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Checks/ }));
    expect(screen.getByText(/reference points not confirmed by measurement/)).toBeTruthy();
  });

  it('reducing the screed to 55 mm gives an error about the cover over the pipe', () => {
    render(<App />);
    const input = screen.getByLabelText(/^Screed, mm$/i, { selector: 'input' });
    fireEvent.change(input, { target: { value: '55' } });

    fireEvent.click(screen.getByRole('button', { name: /Checks/ }));
    expect(screen.getByText('Not enough concrete over the heating pipe')).toBeTruthy();
  });
});

describe('Switching layout variants', () => {
  const hallArea = (container) => {
    const row = [...container.querySelectorAll('.mini-table tr')]
      .find((tr) => tr.textContent.startsWith('Hall / boiler room'));
    return parseFloat(row.querySelector('.num').textContent);
  };

  it('switching variants changes the kitchen placement', () => {
    render(<App />);
    // In the right variant the oven moved to the side branch by the bathroom partition,
    // and the dishwasher became NARROW — 450 instead of 600: that is what freed
    // the 150 mm by which the whole front moved left from the corner
    expect(screen.getAllByTitle('Oven').length).toBe(1);
    expect(screen.getAllByTitle('Dishwasher 450').length).toBe(1);
    expect(screen.queryAllByTitle('Dishwasher 600')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Bathroom on the left, corner kitchen' }));
    // The left variant rebuilds the whole kitchen, but the fixtures are the same
    expect(screen.getAllByTitle('Sink (600 module)').length).toBe(1);
    expect(screen.getAllByTitle('Oven').length).toBe(1);
  });

  it('in both variants the sum of areas stays 30.25 m²', () => {
    render(<App />);
    expect(screen.getByText('30.25 m²')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Bathroom on the left, corner kitchen' }));
    expect(screen.getByText('30.25 m²')).toBeTruthy();
  });

  it('the hall does not depend on the variant — it is held by the boiler and the gas inlet', () => {
    const { container } = render(<App />);
    const before = hallArea(container);
    fireEvent.click(screen.getByRole('button', { name: 'Bathroom on the left, corner kitchen' }));
    expect(hallArea(container)).toBeCloseTo(before, 2);
  });

  it('the chosen variant survives remounting', () => {
    const first = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Bathroom on the left, corner kitchen' }));
    first.unmount();

    render(<App />);
    expect(document.querySelector('.variant-switch button.active').textContent)
      .toBe('Bathroom on the left, corner kitchen');
  });
});

describe('Editing with the mouse and fields', () => {
  it('partitions are drawn as drag handles', () => {
    const { container } = render(<App />);
    // Bathroom on the right: its two faces + two faces of the hall
    expect(container.querySelectorAll('.ph-grip').length).toBe(4);

    // On the left the bathroom detaches from the walls, a third face appears
    fireEvent.click(screen.getByRole('button', { name: 'Bathroom on the left, corner kitchen' }));
    expect(container.querySelectorAll('.ph-grip').length).toBe(5);
  });

  it('the stair has a grab area and size handles', () => {
    render(<App />);
    const stair = screen.getByTitle(/Stair to the attic/);
    expect(stair).toBeTruthy();
    fireEvent.mouseDown(stair);
    expect(document.querySelectorAll('.rz').length).toBeGreaterThan(0);
  });

  it('changing the hall width changes its area', () => {
    const { container } = render(<App />);
    // The room name is both on the plan and in the table — take the table row
    const hallArea = () => {
      const row = [...container.querySelectorAll('.mini-table tr')]
        .find((tr) => tr.textContent.startsWith('Hall / boiler room'));
      return parseFloat(row.querySelector('.num').textContent);
    };

    const before = hallArea();
    fireEvent.change(
      screen.getByLabelText(/Hall, width m/i, { selector: 'input' }),
      { target: { value: '2.40' } }
    );
    expect(hallArea()).toBeGreaterThan(before);
  });

  it('a fixture can be stretched through the size fields', () => {
    render(<App />);
    fireEvent.mouseDown(screen.getByTitle('Refrigerator'));

    const widthField = screen.getByLabelText(/^Width, m$/i, { selector: 'input' });
    fireEvent.change(widthField, { target: { value: '0.80' } });

    expect(screen.getByText(/800 × 650/)).toBeTruthy();
    expect(screen.getByText('Restore catalogue size')).toBeTruthy();
  });
});

describe('The “Electrics” layer', () => {
  const hideLayer = (name) => {
    const row = [...document.querySelectorAll('.layer-row')]
      .find((r) => r.textContent.includes(name));
    fireEvent.click(row.querySelector('button'));
  };

  it('sockets and luminaires live on the electrics layer, not on equipment', () => {
    render(<App />);
    expect(screen.getAllByTitle('4-gang socket block').length).toBeGreaterThan(0);
    expect(screen.getAllByTitle('General luminaire (ceiling light)').length).toBeGreaterThan(0);

    hideLayer('Electrics');
    expect(screen.queryAllByTitle('4-gang socket block')).toHaveLength(0);
    expect(screen.queryAllByTitle('General luminaire (ceiling light)')).toHaveLength(0);
    // The furniture stays in place
    expect(screen.getAllByTitle('Refrigerator').length).toBeGreaterThan(0);
  });

  it('hiding equipment does not touch the electrics', () => {
    render(<App />);
    hideLayer('Equipment');
    expect(screen.queryAllByTitle('Refrigerator')).toHaveLength(0);
    expect(screen.getAllByTitle('4-gang socket block').length).toBeGreaterThan(0);
  });
});

describe('Heating routed around furniture', () => {
  it('the sofa and benches stand on legs — the pipe runs under them', () => {
    render(<App />);
    fireEvent.mouseDown(screen.getAllByTitle('Sofa')[0]);
    const box = screen.getByLabelText(/Do not lay heating under the fixture/i);
    expect(box.checked).toBe(false);
  });

  it('kitchen cabinets are excluded from the floor field', () => {
    render(<App />);
    fireEvent.mouseDown(screen.getAllByTitle('Refrigerator')[0]);
    expect(screen.getByLabelText(/Do not lay heating under the fixture/i).checked).toBe(true);
  });

  it('the toggle changes the usable area and the required output', () => {
    const { container } = render(<App />);
    const living = () => {
      fireEvent.click(screen.getByRole('button', { name: /^Loops$/ }));
      const row = [...container.querySelectorAll('.mini-table tr')]
        .find((tr) => tr.textContent.startsWith('Living room'));
      return row.textContent;
    };
    const before = living();

    fireEvent.click(screen.getByRole('button', { name: /^Plan$/ }));
    fireEvent.mouseDown(screen.getAllByTitle('Sofa')[0]);
    fireEvent.click(screen.getByLabelText(/Do not lay heating under the fixture/i));

    expect(living()).not.toBe(before);
  });
});

describe('Catalogue', () => {
  it('adds a fixture to the plan on click', () => {
    render(<App />);
    // Take an item that is not in the starting placement yet
    expect(screen.queryAllByTitle('TV unit')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /^Catalogue$/ }));
    fireEvent.click(screen.getByText('TV unit').closest('button'));

    fireEvent.click(screen.getByRole('button', { name: /^Plan$/ }));
    expect(screen.getAllByTitle('TV unit').length).toBe(1);
  });
});


describe('plan and panel divider', () => {
  it('the panel does not shrink below the minimum — otherwise the two-column fields break', () => {
    expect(clampSidebar(50, 1600)).toBe(SIDEBAR.min);
  });

  it('the panel does not eat the whole plan', () => {
    // At 1100 px the plan minimum beats the absolute panel ceiling
    expect(clampSidebar(5000, 1100)).toBe(1100 - SIDEBAR.planMin);
  });

  it('the absolute ceiling holds even on a wide monitor', () => {
    expect(clampSidebar(5000, 4000)).toBe(SIDEBAR.max);
  });

  it('on a narrow window the panel minimum matters more than the plan minimum', () => {
    // 600 px of width: there is not enough room for both minimums, the panel wins —
    // without it there is nothing to work with, the plan can at least be scrolled
    expect(clampSidebar(400, 600)).toBe(SIDEBAR.min);
  });

  it('the original width passes unchanged', () => {
    expect(clampSidebar(SIDEBAR.default, 1600)).toBe(SIDEBAR.default);
  });

  it('the divider is drawn and reachable from the keyboard', () => {
    render(<App />);
    const sep = document.querySelector('.splitter');
    expect(sep).toBeTruthy();
    expect(sep.getAttribute('role')).toBe('separator');
    expect(sep.getAttribute('tabindex')).toBe('0');
  });

  it('the panel width is restored from localStorage', () => {
    localStorage.setItem('floor_sidebar_w', '520');
    render(<App />);
    const aside = document.querySelector('.sidebar');
    expect(aside.style.width).toBe('520px');
  });
});
