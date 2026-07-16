//     ▄▄ ▄▄ ▄▄  ▄▄▄▄  ▄▄▄▄ ▄▄    ▄▄▄▄▄ ▄▄▄▄
//     ██ ██ ██ ██ ▄▄ ██ ▄▄ ██    ██▄▄  ██▄█▄   Copyright (c) 2026 Julian Storer
//   ▄▄█▀ ▀███▀ ▀███▀ ▀███▀ ██▄▄▄ ██▄▄▄ ██ ██   Apache-2.0 - see LICENSE
// SPDX-License-Identifier: Apache-2.0

/**
 * The `juggler:viz/1` symbol library — the named vocabulary Diagram nodes
 * draw with. Each symbol is a declarative shape list rendered into a 24×24
 * viewBox `<g>` with `currentColor` strokes, so the node's status tint (set
 * as a CSS color on the ancestor) colors the artwork with no per-symbol
 * logic. The name list is enumerated in the tool schema; an unknown name
 * renders a labeled fallback box, never an error.
 * @module a2ui/symbols
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Shape vocabulary: each entry is `[tag, attributes]`. Strokes inherit
 * `currentColor`; fills default to none (a shape can opt in via `fill`).
 * @type {Record<string, Array<[string, Record<string, string|number>]>>}
 */
const SYMBOLS = {
  router: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M7 10h6M10 7l3 3-3 3' }],
    ['path', { d: 'M17 14h-6M14 11l-3 3 3 3' }]
  ],
  switch: [
    ['rect', { x: 3, y: 7, width: 18, height: 10, rx: 1.5 }],
    ['path', { d: 'M7 11h7M11 8.5L14 11l-3 2.5' }],
    ['path', { d: 'M17 15h-7M13 12.5L10 15l3 2.5' }]
  ],
  firewall: [
    ['rect', { x: 3, y: 5, width: 18, height: 14, rx: 1 }],
    ['path', { d: 'M3 10h18M3 14.5h18M9 5v5M15 5v5M6 10v4.5M12 10v4.5M18 10v4.5M9 14.5V19M15 14.5V19' }]
  ],
  server: [
    ['rect', { x: 5, y: 3, width: 14, height: 18, rx: 1.5 }],
    ['path', { d: 'M5 9h14M5 15h14' }],
    ['circle', { cx: 8.5, cy: 6, r: 0.8, fill: 'currentColor' }],
    ['circle', { cx: 8.5, cy: 12, r: 0.8, fill: 'currentColor' }],
    ['circle', { cx: 8.5, cy: 18, r: 0.8, fill: 'currentColor' }]
  ],
  database: [
    ['ellipse', { cx: 12, cy: 6, rx: 8, ry: 3 }],
    ['path', { d: 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6' }],
    ['path', { d: 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3' }]
  ],
  cloud: [
    ['path', { d: 'M7 18a4 4 0 0 1-.6-7.9A5.5 5.5 0 0 1 17 8.6 4.2 4.2 0 0 1 17.8 17z' }]
  ],
  internet: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['ellipse', { cx: 12, cy: 12, rx: 4, ry: 9 }],
    ['path', { d: 'M3.5 9.5h17M3.5 14.5h17' }]
  ],
  'load-balancer': [
    ['rect', { x: 8, y: 3, width: 8, height: 6, rx: 1 }],
    ['path', { d: 'M12 9v3M12 12L5 15M12 12v6M12 12l7 3' }],
    ['circle', { cx: 5, cy: 17, r: 2 }],
    ['circle', { cx: 12, cy: 20, r: 2 }],
    ['circle', { cx: 19, cy: 17, r: 2 }]
  ],
  'wifi-ap': [
    ['circle', { cx: 12, cy: 17, r: 1.6, fill: 'currentColor' }],
    ['path', { d: 'M8.5 13.5a5 5 0 0 1 7 0' }],
    ['path', { d: 'M5.5 10.5a9.2 9.2 0 0 1 13 0' }]
  ],
  laptop: [
    ['rect', { x: 5, y: 5, width: 14, height: 10, rx: 1 }],
    ['path', { d: 'M3 18h18l-2-3H5z' }]
  ],
  phone: [
    ['rect', { x: 8, y: 3, width: 8, height: 18, rx: 2 }],
    ['circle', { cx: 12, cy: 18, r: 0.9, fill: 'currentColor' }]
  ],
  container: [
    ['rect', { x: 3, y: 7, width: 18, height: 11, rx: 1 }],
    ['path', { d: 'M7 7v11M11 7v11M15 7v11M19 7v11' }]
  ],
  vm: [
    ['rect', { x: 4, y: 4, width: 13, height: 13, rx: 1.5 }],
    ['path', { d: 'M20 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-10' }]
  ],
  user: [
    ['circle', { cx: 12, cy: 8, r: 4 }],
    ['path', { d: 'M4.5 20a7.5 7.5 0 0 1 15 0' }]
  ],
  lock: [
    ['rect', { x: 6, y: 11, width: 12, height: 9, rx: 1.5 }],
    ['path', { d: 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3' }],
    ['circle', { cx: 12, cy: 15.5, r: 1.2, fill: 'currentColor' }]
  ],
  globe: [
    ['circle', { cx: 12, cy: 12, r: 9 }],
    ['path', { d: 'M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18M3 12h18' }]
  ]
};

/** The canonical symbol names, for tool schemas and validation. */
export const SYMBOL_NAMES = Object.keys(SYMBOLS);

/**
 * Create a namespaced SVG element with attributes.
 * @param {string} tag - SVG tag name
 * @param {Record<string, string|number>} attrs - Attributes to set
 * @returns {SVGElement} The element
 */
export function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/**
 * Build a symbol's artwork as a `<g>` sized for a 24×24 viewBox. Unknown
 * names get a fallback box with a question mark — the caller labels the node
 * anyway, so the diagram stays legible.
 * @param {string} name - Symbol name (see SYMBOL_NAMES)
 * @returns {SVGElement} The symbol group
 */
export function buildSymbol(name) {
  const g = svgEl('g', {
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.6,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round'
  });
  g.dataset.symbol = name;
  const shapes = SYMBOLS[name];
  if (!shapes) {
    g.appendChild(svgEl('rect', { x: 4, y: 4, width: 16, height: 16, rx: 2 }));
    const q = svgEl('text', { x: 12, y: 16, 'text-anchor': 'middle', 'font-size': 10, fill: 'currentColor', stroke: 'none' });
    q.textContent = '?';
    g.appendChild(q);
    return g;
  }
  for (const [tag, attrs] of shapes) g.appendChild(svgEl(tag, attrs));
  return g;
}
