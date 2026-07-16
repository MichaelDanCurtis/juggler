//     ▄▄ ▄▄ ▄▄  ▄▄▄▄  ▄▄▄▄ ▄▄    ▄▄▄▄▄ ▄▄▄▄
//     ██ ██ ██ ██ ▄▄ ██ ▄▄ ██    ██▄▄  ██▄█▄   Copyright (c) 2026 Julian Storer
//   ▄▄█▀ ▀███▀ ▀███▀ ▀███▀ ██▄▄▄ ██▄▄▄ ██ ██   AGPL-3.0-or-later - see LICENSE

/**
 * A2UI viz catalog tests (increment 4 of the A2UI design): Chart, Metric,
 * Diagram, and the symbol library — hand-rolled SVG bound to the surface
 * dataModel. Anchors: each chart type's geometry lands in the DOM, data
 * bindings feed charts (the live-update contract), the diagram lays out
 * explicit and auto-positioned nodes with symbols/status/edges, clickable
 * nodes dispatch actions, and bad data degrades to labeled placeholders.
 * @module unit-tests/a2ui-viz
 */

import { assert } from '../utilities/test-helpers.js';
import { renderSurface } from '../../extensions/juggler-a2ui/a2ui/renderer.js';
import { buildSymbol, SYMBOL_NAMES } from '../../extensions/juggler-a2ui/a2ui/symbols.js';

/**
 * @typedef {object} TestResult
 * @property {number} passed - Count of assertions that passed.
 * @property {number} failed - Count of assertions that failed.
 * @property {string[]} errors - Messages from failed assertions.
 */

/**
 * Render a single-component surface.
 * @param {string} type - Component type
 * @param {object} props - Component props
 * @param {object} [dataModel] - Surface data model
 * @param {import('../../extensions/juggler-a2ui/a2ui/renderer.js').SurfaceCallbacks} [callbacks] - Callbacks
 * @returns {HTMLElement} The rendered surface
 */
function renderOne(type, props, dataModel = {}, callbacks = {}) {
  return renderSurface({
    surfaceId: 'viz',
    rootId: 'c',
    components: { c: { id: 'c', type, props } },
    dataModel
  }, callbacks);
}

/**
 * Run all viz catalog tests.
 * @returns {Promise<TestResult>} Test results
 */
export async function runTests() {
  let passed = 0;
  let failed = 0;
  const errors = [];

  const check = (name, fn) => {
    try {
      fn();
      passed++;
    } catch (e) {
      failed++;
      errors.push(`${name}: ${e.message}`);
    }
  };

  // ── Chart ────────────────────────────────────────────────────────────────

  check('line chart draws a polyline whose points track the data', () => {
    const el = renderOne('Chart', { chartType: 'line', data: [1, 5, 3] });
    const line = el.querySelector('polyline[data-series="value"]');
    assert(line, 'polyline rendered');
    const points = line.getAttribute('points').split(' ');
    assert(points.length === 3, `3 points, got ${points.length}`);
    const ys = points.map(p => Number(p.split(',')[1]));
    assert(ys[1] < ys[0] && ys[1] < ys[2], 'peak value has the smallest y (SVG top-down)');
  });

  check('bar chart draws one rect per value per series', () => {
    const el = renderOne('Chart', {
      chartType: 'bar',
      data: [{ x: 'a', cpu: 1, mem: 2 }, { x: 'b', cpu: 3, mem: 4 }],
      series: ['cpu', 'mem'],
      x: 'x'
    });
    assert(el.querySelectorAll('rect[data-series="cpu"]').length === 2, '2 cpu bars');
    assert(el.querySelectorAll('rect[data-series="mem"]').length === 2, '2 mem bars');
  });

  check('pie chart draws one slice per value', () => {
    const el = renderOne('Chart', { chartType: 'pie', data: [3, 1, 2] });
    assert(el.querySelectorAll('path[data-slice-index]').length === 3, '3 slices');
  });

  check('area and scatter render their geometry', () => {
    const area = renderOne('Chart', { chartType: 'area', data: [1, 2] });
    assert(area.querySelector('path') && area.querySelector('polyline'), 'area fill + line');
    const scatter = renderOne('Chart', { chartType: 'scatter', data: [1, 2, 3, 4] });
    assert(scatter.querySelectorAll('circle').length === 4, '4 scatter dots');
  });

  check('sparkline is minimal: a line, no axis text', () => {
    const el = renderOne('Chart', { chartType: 'sparkline', data: [1, 2, 1] });
    assert(el.querySelector('polyline'), 'sparkline line');
    assert(el.querySelectorAll('text').length === 0, 'no axis labels');
  });

  check('chart data binds to the dataModel (the live-feed contract)', () => {
    const el = renderOne('Chart', { chartType: 'line', data: { path: '/readings' } }, { readings: [2, 4] });
    const line = el.querySelector('polyline[data-series="value"]');
    assert(line && line.getAttribute('points').split(' ').length === 2, 'bound data plotted');
  });

  check('chart titles render; invalid data degrades to a placeholder', () => {
    const titled = renderOne('Chart', { chartType: 'line', data: [1], title: 'CPU' });
    assert(titled.querySelector('.a2ui-chart-title')?.textContent === 'CPU', 'title rendered');
    const empty = renderOne('Chart', { chartType: 'line', data: [] });
    assert(empty.querySelector('.a2ui-placeholder'), 'empty data → placeholder');
    const badType = renderOne('Chart', { chartType: 'hologram', data: [1] });
    assert(badType.querySelector('.a2ui-placeholder')?.textContent.includes('hologram'), 'unknown chartType named');
  });

  // ── Metric ───────────────────────────────────────────────────────────────

  check('metric tile renders label, bound value, delta, and sparkline', () => {
    const el = renderOne('Metric', {
      label: 'CPU', value: { path: '/cpu' }, delta: -3, spark: [1, 2, 1]
    }, { cpu: '42%' });
    assert(el.querySelector('.a2ui-metric-label')?.textContent === 'CPU', 'label');
    assert(el.querySelector('.a2ui-metric-value')?.textContent === '42%', 'bound value');
    const delta = el.querySelector('.a2ui-metric-delta');
    assert(delta?.classList.contains('down') && delta.textContent.includes('3'), 'delta arrow + magnitude');
    assert(el.querySelector('.a2ui-chart-sparkline polyline'), 'sparkline attached');
  });

  // ── Symbols ──────────────────────────────────────────────────────────────

  check('every named symbol builds artwork; unknown names get a fallback', () => {
    assert(SYMBOL_NAMES.length >= 16, `symbol set present (${SYMBOL_NAMES.length})`);
    for (const name of SYMBOL_NAMES) {
      const g = buildSymbol(name);
      assert(g.childNodes.length > 0 && g.dataset.symbol === name, `symbol "${name}" builds`);
    }
    const unknown = buildSymbol('teapot');
    assert(unknown.querySelector('text')?.textContent === '?', 'unknown symbol → fallback box');
  });

  // ── Diagram ──────────────────────────────────────────────────────────────

  const NODES = [
    { id: 'net', symbol: 'internet', label: 'Internet', x: 10, y: 50 },
    { id: 'fw', symbol: 'firewall', label: 'FW', status: 'warn', x: 50, y: 50 },
    { id: 'srv', symbol: 'server', label: 'Web', status: 'ok', x: 90, y: 50 }
  ];
  const EDGES = [
    { from: 'net', to: 'fw', flow: true },
    { from: 'fw', to: 'srv', label: 'https' }
  ];

  check('diagram renders symbols, labels, status tint, and edges', () => {
    const el = renderOne('Diagram', { nodes: NODES, edges: EDGES });
    assert(el.querySelectorAll('.a2ui-node').length === 3, '3 nodes');
    assert(el.querySelector('[data-node-id="fw"]')?.classList.contains('a2ui-status-warn'), 'status class');
    assert(el.querySelector('[data-node-id="srv"] [data-symbol="server"]'), 'symbol artwork attached');
    assert(el.querySelectorAll('line.a2ui-edge').length === 2, '2 edges');
    assert(el.querySelector('line.a2ui-edge-flow'), 'flow edge marked');
    const texts = Array.from(el.querySelectorAll('text')).map(t => t.textContent);
    assert(texts.includes('https'), 'edge label rendered');
    assert(texts.includes('Internet'), 'node label rendered');
  });

  check('explicit coordinates position nodes left-to-right', () => {
    const el = renderOne('Diagram', { nodes: NODES, edges: EDGES });
    const x = id => {
      const t = el.querySelector(`[data-node-id="${id}"] g[data-symbol]`).getAttribute('transform');
      return Number(t.match(/translate\(([-\d.]+)/)[1]);
    };
    assert(x('net') < x('fw') && x('fw') < x('srv'), 'x order follows coordinates');
  });

  check('auto-layout gives coordinate-less nodes distinct positions', () => {
    const el = renderOne('Diagram', {
      nodes: [{ id: 'a', symbol: 'router' }, { id: 'b', symbol: 'switch' }, { id: 'c', symbol: 'server' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }]
    });
    const transforms = Array.from(el.querySelectorAll('.a2ui-node g[data-symbol]'))
      .map(g => g.getAttribute('transform'));
    assert(new Set(transforms).size === 3, `distinct positions, got ${transforms.join(' | ')}`);
  });

  check('a diagram node with an action dispatches like a Button', () => {
    /** @type {any[]} */
    const fired = [];
    const el = renderOne('Diagram', {
      nodes: [{ id: 'fw', symbol: 'firewall', action: { event: { name: 'inspect' } } }],
      edges: []
    }, {}, { onAction: info => fired.push(info) });
    const node = /** @type {any} */ (el.querySelector('[data-node-id="fw"]'));
    node.dispatchEvent(new Event('click'));
    assert(fired.length === 1 && fired[0].componentId === 'fw', 'node action dispatched');
    assert(fired[0].action.event.name === 'inspect', 'action payload intact');
  });

  check('diagram with no nodes degrades to a placeholder', () => {
    const el = renderOne('Diagram', { nodes: [], edges: [] });
    assert(el.querySelector('.a2ui-placeholder'), 'placeholder rendered');
  });

  // ── composition ──────────────────────────────────────────────────────────

  check('viz and basic components compose in one surface', () => {
    const el = renderSurface({
      surfaceId: 'mix',
      rootId: 'root',
      components: {
        root: { id: 'root', type: 'Card', children: ['m', 'ch'] },
        m: { id: 'm', type: 'Metric', props: { label: 'CPU', value: '9%' } },
        ch: { id: 'ch', type: 'Chart', props: { chartType: 'bar', data: [1, 2] } }
      },
      dataModel: {}
    });
    assert(el.querySelector('.a2ui-card .a2ui-metric') && el.querySelector('.a2ui-card .a2ui-chart'),
      'Card contains both viz components');
  });

  return { passed, failed, errors };
}
