// Copyright (c) 2026 Julian Storer
// Apache-2.0 - see LICENSE
// SPDX-License-Identifier: Apache-2.0

/**
 * The `facet:viz/1` catalog — the visualization payload of Facet's A2UI
 * support: hand-rolled SVG charts, node/edge diagrams drawn with the named
 * symbol library, and metric tiles. No chart library; everything is plain
 * SVG built the way the rest of the extension builds DOM, with theme-aware
 * colors through CSS variables (`--a2ui-series-N`, `--a2ui-status-*`) that
 * fall back to a fixed palette.
 *
 * Data flows like every other component: props are literals or
 * `{path: '/x'}` bindings into the surface's dataModel, so
 * `a2ui_update_data_model` is a live feed — each update repaints the chart
 * on every connected client. A builder that cannot make sense of its data
 * throws; the renderer degrades it to a labeled placeholder.
 * @module a2ui/catalog-viz
 */

import { buildSymbol, svgEl } from './symbols.js';

/**
 * @typedef {import('./renderer.js').ComponentDef} ComponentDef
 * @typedef {import('./renderer.js').RenderContext} RenderContext
 */

/** Series palette: CSS variable with a colorblind-safe fallback. */
const SERIES_COLORS = [
  'var(--a2ui-series-1, #4e79a7)',
  'var(--a2ui-series-2, #f28e2b)',
  'var(--a2ui-series-3, #59a14f)',
  'var(--a2ui-series-4, #e15759)',
  'var(--a2ui-series-5, #b07aa1)',
  'var(--a2ui-series-6, #76b7b2)'
];

/** Status tints for diagram nodes (and anything else that declares status). */
const STATUS_COLORS = {
  ok: 'var(--a2ui-status-ok, #59a14f)',
  warn: 'var(--a2ui-status-warn, #f28e2b)',
  error: 'var(--a2ui-status-error, #e15759)',
  off: 'var(--a2ui-status-off, #9aa0a6)'
};

/** Muted color for axes, edges, and secondary text. */
const MUTED = 'var(--a2ui-muted, #9aa0a6)';

/**
 * Normalize chart data into named series of numbers.
 * Accepted shapes (after binding resolution):
 * - `[1, 2, 3]` — one anonymous series
 * - `[{x: 'Mon', cpu: 10, mem: 20}, ...]` with `series: ['cpu', 'mem']`
 *   (or `series` omitted → every numeric key becomes a series)
 * @param {unknown} data - Resolved `data` prop
 * @param {unknown} seriesProp - Resolved `series` prop (array of keys), if any
 * @param {unknown} xKey - Resolved `x` prop (label key), if any
 * @returns {{labels: string[], series: Array<{key: string, values: number[]}>}} Normalized series
 * @throws {Error} When the data has no usable numeric shape
 */
function normalizeChartData(data, seriesProp, xKey) {
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('Chart data must be a non-empty array (a literal or a {path} binding)');
  }
  if (typeof data[0] === 'number') {
    const values = data.map(v => Number(v)).filter(v => Number.isFinite(v));
    if (!values.length) throw new Error('Chart data has no finite numbers');
    return { labels: values.map((_, i) => String(i)), series: [{ key: 'value', values }] };
  }
  if (typeof data[0] === 'object' && data[0] !== null) {
    const rows = /** @type {Record<string, unknown>[]} */ (data);
    const keys = Array.isArray(seriesProp) && seriesProp.length
      ? seriesProp.map(String)
      : Object.keys(rows[0]).filter(k => typeof rows[0][k] === 'number');
    if (!keys.length) throw new Error('Chart rows carry no numeric series keys');
    const labelKey = typeof xKey === 'string' ? xKey : null;
    return {
      labels: rows.map((r, i) => (labelKey && r[labelKey] !== undefined ? String(r[labelKey]) : String(i))),
      series: keys.map(key => ({ key, values: rows.map(r => Number(r[key]) || 0) }))
    };
  }
  throw new Error('Chart data must be numbers or objects');
}

/**
 * Build the chart's outer SVG with a fixed internal coordinate system.
 * @param {number} width - CSS pixel width
 * @param {number} height - CSS pixel height
 * @returns {SVGElement} The svg element
 */
function chartSvg(width, height) {
  const svg = svgEl('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img' });
  svg.style.width = '100%';
  svg.style.maxWidth = `${width}px`;
  svg.style.height = 'auto';
  svg.style.display = 'block';
  return svg;
}

/**
 * Scale values into plot-area y coordinates (top-left SVG space).
 * @param {number[]} all - Every value being plotted
 * @returns {{min: number, max: number, y: (v: number) => number}} Scale over PLOT_H
 */
function yScale(all) {
  const min = Math.min(...all, 0);
  let max = Math.max(...all);
  if (min === max) {
    max = min + 1;
  }
  const y = (/** @type {number} */ v) => PLOT_Y + PLOT_H - ((v - min) / (max - min)) * PLOT_H;
  return { min, max, y };
}

const W = 320;
const H = 160;
const PLOT_X = 8;
const PLOT_Y = 8;
const PLOT_W = W - 16;
const PLOT_H = H - 34;

/**
 * Min/max labels + baseline — the deliberately minimal axis treatment.
 * @param {SVGElement} svg - The chart svg
 * @param {number} min - Scale minimum
 * @param {number} max - Scale maximum
 * @returns {void}
 */
function drawAxes(svg, min, max) {
  const base = svgEl('line', { x1: PLOT_X, y1: PLOT_Y + PLOT_H, x2: PLOT_X + PLOT_W, y2: PLOT_Y + PLOT_H, stroke: MUTED, 'stroke-width': 1 });
  svg.appendChild(base);
  const maxText = svgEl('text', { x: PLOT_X, y: PLOT_Y + 4, 'font-size': 9, fill: MUTED });
  maxText.textContent = String(max);
  const minText = svgEl('text', { x: PLOT_X, y: PLOT_Y + PLOT_H + 12, 'font-size': 9, fill: MUTED });
  minText.textContent = String(min);
  svg.appendChild(maxText);
  svg.appendChild(minText);
}

/**
 * Series legend along the chart bottom (skipped for single anonymous series).
 * @param {SVGElement} svg - The chart svg
 * @param {Array<{key: string}>} series - The plotted series
 * @returns {void}
 */
function drawLegend(svg, series) {
  if (series.length < 2) return;
  let x = PLOT_X + 30;
  series.forEach((s, i) => {
    const dot = svgEl('circle', { cx: x, cy: H - 8, r: 4, fill: SERIES_COLORS[i % SERIES_COLORS.length] });
    const label = svgEl('text', { x: x + 8, y: H - 5, 'font-size': 9, fill: MUTED });
    label.textContent = s.key;
    svg.appendChild(dot);
    svg.appendChild(label);
    x += 8 + s.key.length * 6 + 18;
  });
}

/**
 * Line/area/scatter share point geometry.
 * @param {number[]} values - One series' values
 * @param {(v: number) => number} y - The y scale
 * @returns {Array<[number, number]>} Plot-space points
 */
function seriesPoints(values, y) {
  const step = values.length > 1 ? PLOT_W / (values.length - 1) : 0;
  return values.map((v, i) => [PLOT_X + (values.length > 1 ? i * step : PLOT_W / 2), y(v)]);
}

/**
 * Draw one chart type into an svg. Split from the builder so sparkline can
 * reuse the line path with its own frame.
 * @param {SVGElement} svg - Target svg
 * @param {string} chartType - line|area|bar|scatter|pie
 * @param {{labels: string[], series: Array<{key: string, values: number[]}>}} norm - Normalized data
 * @returns {void}
 */
function drawChart(svg, chartType, norm) {
  const { series } = norm;
  const all = series.flatMap(s => s.values);

  if (chartType === 'pie') {
    // One series; each value is a slice.
    const values = series[0].values.map(v => Math.max(0, v));
    const total = values.reduce((a, b) => a + b, 0);
    if (total <= 0) throw new Error('Pie chart needs positive values');
    const cx = W / 2;
    const cy = (PLOT_Y + PLOT_H) / 2 + 4;
    const r = Math.min(PLOT_W, PLOT_H) / 2 - 2;
    let angle = -Math.PI / 2;
    values.forEach((v, i) => {
      const sweep = (v / total) * Math.PI * 2;
      const x1 = cx + r * Math.cos(angle);
      const y1 = cy + r * Math.sin(angle);
      angle += sweep;
      const x2 = cx + r * Math.cos(angle);
      const y2 = cy + r * Math.sin(angle);
      const large = sweep > Math.PI ? 1 : 0;
      // A full-circle single slice degenerates in arc form; draw a circle.
      const slice = values.length === 1
        ? svgEl('circle', { cx, cy, r, fill: SERIES_COLORS[0] })
        : svgEl('path', {
          d: `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`,
          fill: SERIES_COLORS[i % SERIES_COLORS.length]
        });
      slice.dataset.sliceIndex = String(i);
      svg.appendChild(slice);
    });
    const labelled = norm.labels.map((l, i) => ({ key: l, values: [values[i]] }));
    drawLegend(svg, labelled.slice(0, 6));
    return;
  }

  const { min, max, y } = yScale(all);
  drawAxes(svg, min, max);

  if (chartType === 'bar') {
    const n = series[0].values.length;
    const groupW = PLOT_W / n;
    const barW = Math.max(2, (groupW * 0.7) / series.length);
    series.forEach((s, si) => {
      s.values.forEach((v, i) => {
        const x = PLOT_X + i * groupW + groupW * 0.15 + si * barW;
        const top = y(v);
        const rect = svgEl('rect', {
          x, y: Math.min(top, y(0)),
          width: barW,
          height: Math.max(1, Math.abs(y(0) - top)),
          fill: SERIES_COLORS[si % SERIES_COLORS.length]
        });
        rect.dataset.series = s.key;
        svg.appendChild(rect);
      });
    });
  } else {
    series.forEach((s, si) => {
      const pts = seriesPoints(s.values, y);
      const color = SERIES_COLORS[si % SERIES_COLORS.length];
      if (chartType === 'scatter') {
        for (const [px, py] of pts) {
          svg.appendChild(svgEl('circle', { cx: px, cy: py, r: 3, fill: color }));
        }
        return;
      }
      if (chartType === 'area') {
        const area = svgEl('path', {
          d: `M ${pts.map(p => p.join(' ')).join(' L ')} L ${pts[pts.length - 1][0]} ${y(Math.max(0, min))} L ${pts[0][0]} ${y(Math.max(0, min))} Z`,
          fill: color,
          opacity: 0.25,
          stroke: 'none'
        });
        svg.appendChild(area);
      }
      const line = svgEl('polyline', {
        points: pts.map(p => p.join(',')).join(' '),
        fill: 'none',
        stroke: color,
        'stroke-width': 2,
        'stroke-linejoin': 'round'
      });
      line.dataset.series = s.key;
      svg.appendChild(line);
    });
  }
  drawLegend(svg, series);
}

/**
 * Grid auto-layout for diagram nodes without coordinates: BFS layering from
 * the roots (nodes nothing points at), each layer a column. Cycles and
 * orphans land in the last-visited layer, so every node gets a position.
 * @param {Array<{id: string}>} nodes - Diagram nodes
 * @param {Array<{from: string, to: string}>} edges - Diagram edges
 * @returns {Map<string, {x: number, y: number}>} Positions in a 0-100 space
 */
function autoLayout(nodes, edges) {
  /** @type {Map<string, string[]>} */
  const out = new Map(nodes.map(n => [n.id, []]));
  const hasIncoming = new Set();
  for (const e of edges) {
    if (out.has(e.from) && out.has(e.to)) {
      /** @type {string[]} */ (out.get(e.from)).push(e.to);
      hasIncoming.add(e.to);
    }
  }
  /** @type {Map<string, number>} */
  const layer = new Map();
  let frontier = nodes.filter(n => !hasIncoming.has(n.id)).map(n => n.id);
  if (!frontier.length && nodes.length) frontier = [nodes[0].id];
  let depth = 0;
  while (frontier.length) {
    /** @type {string[]} */
    const next = [];
    for (const id of frontier) {
      if (layer.has(id)) continue;
      layer.set(id, depth);
      next.push(...(out.get(id) || []));
    }
    frontier = next;
    depth++;
  }
  for (const n of nodes) if (!layer.has(n.id)) layer.set(n.id, depth);

  /** @type {Map<number, string[]>} */
  const byLayer = new Map();
  for (const n of nodes) {
    const l = /** @type {number} */ (layer.get(n.id));
    if (!byLayer.has(l)) byLayer.set(l, []);
    /** @type {string[]} */ (byLayer.get(l)).push(n.id);
  }
  const layers = [...byLayer.keys()].sort((a, b) => a - b);
  /** @type {Map<string, {x: number, y: number}>} */
  const pos = new Map();
  layers.forEach((l, li) => {
    const ids = /** @type {string[]} */ (byLayer.get(l));
    const x = layers.length > 1 ? 10 + (li * 80) / (layers.length - 1) : 50;
    ids.forEach((id, i) => {
      pos.set(id, { x, y: ids.length > 1 ? 12 + (i * 76) / (ids.length - 1) : 50 });
    });
  });
  return pos;
}

/** @type {Record<string, (def: ComponentDef, ctx: RenderContext) => HTMLElement>} */
export const VIZ_CATALOG = {
  /**
   * Chart — line, area, bar, scatter, pie, sparkline over bound data.
   * Props: chartType, data (array or binding), series? (value keys),
   * x? (label key), title?.
   * @param {ComponentDef} def - Normalized component definition
   * @param {RenderContext} ctx - Render context
   * @returns {HTMLElement} The chart element
   */
  Chart(def, ctx) {
    const chartType = String(ctx.resolve(def.props.chartType) || 'line');
    const norm = normalizeChartData(
      ctx.resolve(def.props.data),
      ctx.resolve(def.props.series),
      ctx.resolve(def.props.x)
    );
    const wrap = document.createElement('div');
    wrap.className = `a2ui-chart a2ui-chart-${chartType}`;

    const title = ctx.text(def.props.title);
    if (title) {
      const t = document.createElement('div');
      t.className = 'a2ui-chart-title';
      t.textContent = title;
      t.style.font = '600 12px system-ui, sans-serif';
      wrap.appendChild(t);
    }

    if (chartType === 'sparkline') {
      const svg = chartSvg(120, 28);
      const values = norm.series[0].values;
      const { y } = yScale(values);
      // Sparkline reuses the line geometry compressed into its own frame.
      const pts = seriesPoints(values, v => 2 + ((y(v) - PLOT_Y) / PLOT_H) * 24)
        .map(([px, py]) => [2 + ((px - PLOT_X) / PLOT_W) * 116, py]);
      svg.appendChild(svgEl('polyline', {
        points: pts.map(p => p.join(',')).join(' '),
        fill: 'none',
        stroke: SERIES_COLORS[0],
        'stroke-width': 1.5
      }));
      wrap.appendChild(svg);
      return wrap;
    }

    if (!['line', 'area', 'bar', 'scatter', 'pie'].includes(chartType)) {
      throw new Error(`Unknown chartType "${chartType}"`);
    }
    const svg = chartSvg(W, H);
    drawChart(svg, chartType, norm);
    wrap.appendChild(svg);
    return wrap;
  },

  /**
   * Metric — the dashboard tile: label, big value, optional delta arrow and
   * sparkline. Props: label, value, delta? (number), spark? (number array).
   * @param {ComponentDef} def - Normalized component definition
   * @param {RenderContext} ctx - Render context
   * @returns {HTMLElement} The metric tile
   */
  Metric(def, ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'a2ui-metric';
    wrap.style.display = 'inline-flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '2px';

    const label = document.createElement('div');
    label.className = 'a2ui-metric-label';
    label.textContent = ctx.text(def.props.label);
    label.style.font = '500 11px system-ui, sans-serif';
    label.style.opacity = '0.7';
    wrap.appendChild(label);

    const row = document.createElement('div');
    row.style.display = 'flex';
    row.style.alignItems = 'baseline';
    row.style.gap = '6px';

    const value = document.createElement('div');
    value.className = 'a2ui-metric-value';
    value.textContent = ctx.text(def.props.value);
    value.style.font = '700 22px system-ui, sans-serif';
    row.appendChild(value);

    const delta = ctx.resolve(def.props.delta);
    if (typeof delta === 'number' && delta !== 0) {
      const d = document.createElement('span');
      d.className = `a2ui-metric-delta ${delta > 0 ? 'up' : 'down'}`;
      d.textContent = `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}`;
      d.style.font = '600 11px system-ui, sans-serif';
      d.style.color = delta > 0 ? STATUS_COLORS.ok : STATUS_COLORS.error;
      row.appendChild(d);
    }
    wrap.appendChild(row);

    const spark = ctx.resolve(def.props.spark);
    if (Array.isArray(spark) && spark.length > 1) {
      wrap.appendChild(VIZ_CATALOG.Chart(
        /** @type {ComponentDef} */ ({ id: `${def.id}__spark`, type: 'Chart', props: { chartType: 'sparkline', data: spark }, children: [] }),
        ctx
      ));
    }
    return wrap;
  },

  /**
   * Diagram — a node/edge graph drawn with the symbol library. Props:
   * nodes: [{id, symbol, label?, status?, x?, y?}] (x/y in 0–100 space),
   * edges: [{from, to, label?, style?: 'solid'|'dashed', flow?: bool}].
   * Nodes without coordinates get a layered auto-layout. Nodes may carry an
   * `action` (see Button) — the whole node becomes clickable.
   * @param {ComponentDef} def - Normalized component definition
   * @param {RenderContext} ctx - Render context
   * @returns {HTMLElement} The diagram element
   */
  Diagram(def, ctx) {
    const nodes = /** @type {any[]} */ (ctx.resolve(def.props.nodes));
    const edges = /** @type {any[]} */ (ctx.resolve(def.props.edges) || []);
    if (!Array.isArray(nodes) || nodes.length === 0) {
      throw new Error('Diagram needs a non-empty nodes array');
    }
    const wrap = document.createElement('div');
    wrap.className = 'a2ui-diagram';

    const DW = 360;
    const DH = 220;
    const svg = chartSvg(DW, DH);
    const auto = autoLayout(nodes, edges);
    /** @type {Map<string, {x: number, y: number}>} */
    const pos = new Map();
    for (const n of nodes) {
      const p = (typeof n.x === 'number' && typeof n.y === 'number') ? { x: n.x, y: n.y } : auto.get(n.id) || { x: 50, y: 50 };
      // 0–100 space → pixels, inset so symbols never clip.
      pos.set(n.id, { x: 24 + (p.x / 100) * (DW - 48), y: 24 + (p.y / 100) * (DH - 48) });
    }

    for (const e of edges) {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) continue;
      const line = svgEl('line', {
        x1: a.x, y1: a.y, x2: b.x, y2: b.y,
        stroke: MUTED,
        'stroke-width': 1.5,
        ...(e.style === 'dashed' || e.flow ? { 'stroke-dasharray': '6 4' } : {})
      });
      line.classList.add('a2ui-edge');
      if (e.flow) line.classList.add('a2ui-edge-flow');
      svg.appendChild(line);
      if (e.label) {
        const label = svgEl('text', {
          x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 4,
          'font-size': 8.5, fill: MUTED, 'text-anchor': 'middle'
        });
        label.textContent = String(e.label);
        svg.appendChild(label);
      }
    }

    for (const n of nodes) {
      const p = /** @type {{x: number, y: number}} */ (pos.get(n.id));
      const g = svgEl('g');
      g.classList.add('a2ui-node');
      g.dataset.nodeId = String(n.id);
      const status = typeof n.status === 'string' && STATUS_COLORS[/** @type {keyof STATUS_COLORS} */ (n.status)] ? n.status : null;
      if (status) g.classList.add(`a2ui-status-${status}`);
      g.setAttribute('style', `color: ${status ? STATUS_COLORS[/** @type {keyof STATUS_COLORS} */ (status)] : 'currentColor'}`);

      // Symbol artwork centered on the node position (24×24 viewBox → 28px box).
      const art = buildSymbol(typeof n.symbol === 'string' ? n.symbol : '');
      art.setAttribute('transform', `translate(${p.x - 14} ${p.y - 16}) scale(1.15)`);
      g.appendChild(art);

      if (n.label) {
        const label = svgEl('text', { x: p.x, y: p.y + 22, 'font-size': 9, 'text-anchor': 'middle', fill: 'currentColor', stroke: 'none' });
        label.textContent = String(n.label);
        g.appendChild(label);
      }

      if (n.action && typeof n.action === 'object') {
        g.style.cursor = 'pointer';
        g.addEventListener('click', () => ctx.dispatchAction(
          /** @type {ComponentDef} */ ({ id: n.id, type: 'DiagramNode', props: {}, children: [], action: n.action }),
          /** @type {HTMLElement} */ (/** @type {unknown} */ (g))
        ));
      }
      svg.appendChild(g);
    }

    wrap.appendChild(svg);
    return wrap;
  }
};
